import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type LLMResult = {
  data: unknown;
  modelUsed: string;
  fallbackNotice?: string;
};

type CacheEntry = LLMResult;
type CallLLMInput = {
  system: string;
  prompt: string;
  signal?: AbortSignal;
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

class ProviderError extends Error {
  readonly status?: number;

  constructor(
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

async function providerResponseError(
  response: Response,
): Promise<ProviderError> {
  let detail = "";
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      detail = `: ${body.error.message}`;
    }
  } catch {
    detail = "";
  }
  return new ProviderError(
    `HTTP ${response.status}${detail}`,
    response.status,
  );
}

function parseJSON(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`The model returned invalid JSON: ${detail}`);
  }
}

async function requestWithRetry(
  request: () => Promise<LLMResult>,
  providerName: string,
): Promise<LLMResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (
        error instanceof ProviderError ||
        (error instanceof Error && error.name === "TimeoutError")
      ) {
        break;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : "Unknown provider error";
  if (lastError instanceof ProviderError) {
    throw new ProviderError(`${providerName} failed: ${detail}`, lastError.status);
  }
  throw new Error(`${providerName} failed: ${detail}`);
}

async function callGemini(
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<LLMResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const model = GEMINI_MODEL;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw await providerResponseError(response);
  }

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("candidates" in body) ||
    !Array.isArray(body.candidates)
  ) {
    throw new Error("Gemini response did not contain candidates");
  }

  const candidate = body.candidates[0];
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("content" in candidate) ||
    typeof candidate.content !== "object" ||
    candidate.content === null ||
    !("parts" in candidate.content) ||
    !Array.isArray(candidate.content.parts)
  ) {
    throw new Error("Gemini response did not contain generated text");
  }

  const text = candidate.content.parts
    .map((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return { data: parseJSON(text), modelUsed: `Gemini: ${model}` };
}

async function callGroq(
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<LLMResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const model = GROQ_MODEL;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw await providerResponseError(response);
  }

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("choices" in body) ||
    !Array.isArray(body.choices)
  ) {
    throw new Error("Groq response did not contain choices");
  }

  const choice = body.choices[0];
  if (
    typeof choice !== "object" ||
    choice === null ||
    !("message" in choice) ||
    typeof choice.message !== "object" ||
    choice.message === null ||
    !("content" in choice.message) ||
    typeof choice.message.content !== "string"
  ) {
    throw new Error("Groq response did not contain generated text");
  }

  return {
    data: parseJSON(choice.message.content),
    modelUsed: `Groq: ${model}`,
  };
}

async function readCache(filePath: string): Promise<CacheEntry | null> {
  try {
    const text = await readFile(filePath, "utf8");
    const value: unknown = JSON.parse(text);
    if (
      typeof value !== "object" ||
      value === null ||
      !("data" in value) ||
      !("modelUsed" in value) ||
      typeof value.modelUsed !== "string"
    ) {
      throw new Error(`Invalid LLM cache entry at ${filePath}`);
    }
    return {
      data: value.data,
      modelUsed: value.modelUsed,
      ...("fallbackNotice" in value && typeof value.fallbackNotice === "string"
        ? { fallbackNotice: value.fallbackNotice }
        : {}),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function callLLM({
  system,
  prompt,
  signal,
}: CallLLMInput): Promise<LLMResult> {
  const hash = createHash("sha256").update(system + prompt).digest("hex");
  const cacheDirectory =
    process.env.BLINDSPOT_CACHE_DIRECTORY ||
    (process.env.VERCEL
      ? path.join(tmpdir(), "blindspot-cache")
      : path.join(process.cwd(), ".cache"));
  const cacheFile = path.join(cacheDirectory, `${hash}.json`);
  const temporaryDirectory = path.join(tmpdir(), "blindspot-cache");
  const fallbackDirectory =
    path.resolve(cacheDirectory) === path.resolve(temporaryDirectory)
      ? path.join(tmpdir(), "blindspot-cache-fallback")
      : temporaryDirectory;
  const fallbackFile = path.join(fallbackDirectory, `${hash}.json`);
  for (const candidatePath of [...new Set([cacheFile, fallbackFile])]) {
    let cached: CacheEntry | null;
    try {
      cached = await readCache(candidatePath);
    } catch (error) {
      console.warn("[BlindSpot] Could not read an LLM cache entry; trying the next cache location.", error);
      continue;
    }
    if (
      cached &&
      (cached.modelUsed === `Gemini: ${GEMINI_MODEL}` ||
        cached.modelUsed === `Groq: ${GROQ_MODEL}`)
    ) {
      return cached.modelUsed.startsWith("Groq:") && !cached.fallbackNotice
        ? { ...cached, fallbackNotice: "Using the cached Groq result." }
        : cached;
    }
  }

  const errors: string[] = [];
  let result: LLMResult | undefined;
  let fallbackNotice: string | undefined;

  try {
    result = await requestWithRetry(
      () => callGemini(system, prompt, signal),
      "Gemini",
    );
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Gemini failed");
    if (error instanceof ProviderError && error.status === 429) {
      fallbackNotice = "Gemini rate limit (HTTP 429); switched to Groq.";
    } else {
      fallbackNotice = "Gemini was unavailable; switched to Groq.";
    }
  }

  if (!result) {
    try {
      result = await requestWithRetry(
        () => callGroq(system, prompt, signal),
        "Groq",
      );
      if (fallbackNotice) result.fallbackNotice = fallbackNotice;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Groq failed");
    }
  }

  if (!result) {
    throw new Error(`No LLM provider succeeded. ${errors.join("; ")}`);
  }

  try {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result), "utf8");
  } catch (primaryError) {
    try {
      await mkdir(fallbackDirectory, { recursive: true });
      await writeFile(fallbackFile, JSON.stringify(result), "utf8");
      console.warn(
        "[BlindSpot] Primary LLM cache is not writable; cached the result in the temporary directory.",
        primaryError,
      );
    } catch (fallbackError) {
      console.warn(
        "[BlindSpot] Could not write the LLM cache in either location; returning the generated result without caching.",
        fallbackError,
      );
    }
  }
  return result;
}
