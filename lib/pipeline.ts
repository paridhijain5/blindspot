import type {
  AnalysisResult,
  Claim,
  Dimension,
  Source,
} from "./types.ts";
import { buildMatrixAnalysis, computeScore } from "./analyze.ts";
import { getFallbackDimensions } from "./fallbackDimensions.ts";
import { buildFallbackReport, type ReportInput } from "./reportFallback.ts";
import { friendlyAnalysisError } from "./errorMessages.ts";

const MAX_SOURCES = 8;
const MAX_RUN_MS = 45_000;

export type PipelineStep = "schema" | "fetch" | "extract" | "analyze" | "report";

export type PipelineProgress = {
  step: PipelineStep;
  done: number;
  total: number;
  message: string;
};

type PipelineOptions = {
  fetcher?: typeof fetch;
};

async function readError(response: Response, stage: string): Promise<Error> {
  let detail = `HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      detail = body.error;
    }
  } catch {
    detail = `HTTP ${response.status}`;
  }
  return new Error(`${stage} failed: ${detail}`);
}

export async function runPipeline(
  question: string,
  urls: string[],
  onProgress: (progress: PipelineProgress) => void = () => undefined,
  options: PipelineOptions = {},
): Promise<AnalysisResult> {
  const request = options.fetcher ?? fetch;
  const deadline = Date.now() + MAX_RUN_MS;
  const sourceURLs = urls.slice(0, MAX_SOURCES);
  let droppedClaimCount = 0;
  const claims: Claim[] = [];
  const notifiedFallbacks = new Set<string>();

  if (urls.length > MAX_SOURCES) {
    onProgress({
      step: "fetch",
      done: 0,
      total: MAX_SOURCES,
      message: `This run is limited to ${MAX_SOURCES} sources; the remaining URLs were not included.`,
    });
  }

  async function post(
    path: string,
    body: unknown,
    stageLimitMs: number,
  ): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("The 45-second survey limit was reached.");
    }
    return request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, Math.min(remaining, stageLimitMs))),
    });
  }

  function logProviderFallback(response: Response) {
    const message = response.headers.get("x-blindspot-fallback-notice");
    if (message && !notifiedFallbacks.has(message)) {
      notifiedFallbacks.add(message);
      onProgress({
        step: "extract",
        done: claims.length,
        total: sourceURLs.length,
        message,
      });
    }
  }

  onProgress({
    step: "schema",
    done: 0,
    total: 1,
    message: "Mapping the information dimensions for your question.",
  });
  let dimensions: Dimension[];
  try {
    const schemaResponse = await post("/api/schema", { question }, 30_000);
    if (!schemaResponse.ok) {
      throw await readError(schemaResponse, "Schema generation");
    }
    logProviderFallback(schemaResponse);
    dimensions = (await schemaResponse.json()) as Dimension[];
  } catch (error) {
    dimensions = getFallbackDimensions(question);
    onProgress({
      step: "schema",
      done: 1,
      total: 1,
      message: `Using fallback dimensions because schema generation was unavailable${error instanceof Error && !/45-second/.test(error.message) ? `: ${error.message}` : "."}`,
    });
  }
  onProgress({
    step: "schema",
    done: 1,
    total: 1,
    message: `${dimensions.length} information dimensions ready.`,
  });

  let completedFetches = 0;
  onProgress({
    step: "fetch",
    done: 0,
    total: sourceURLs.length,
    message: `Retrieving ${sourceURLs.length} source${sourceURLs.length === 1 ? "" : "s"}.`,
  });
  const sources = await Promise.all(
    sourceURLs.map(async (url, sourceIndex): Promise<Source> => {
      onProgress({
        step: "fetch",
        done: completedFetches,
        total: sourceURLs.length,
        message: `Fetching source ${sourceIndex + 1} of ${sourceURLs.length}`,
      });
      try {
        const response = await post("/api/fetch", { url }, 24_000);
        if (!response.ok) throw await readError(response, "Source retrieval");
        return (await response.json()) as Source;
      } catch (error) {
        return {
          id: `fetch-error-${sourceIndex}-${encodeURIComponent(url)}`,
          url,
          title: url,
          text: "",
          fetchedAt: new Date().toISOString(),
          tier: "unknown",
          isPdf: false,
          error:
            error instanceof Error && /45-second/.test(error.message)
              ? "The survey time limit was reached before this source could be fetched."
              : error instanceof Error
                ? error.message
                : "Source retrieval failed.",
        };
      } finally {
        completedFetches += 1;
        onProgress({
          step: "fetch",
          done: completedFetches,
          total: sourceURLs.length,
          message: `Retrieved ${completedFetches} of ${sourceURLs.length} sources.`,
        });
      }
    }),
  );
  sources.forEach((source, index) => {
    if (!source.error) return;
    onProgress({
      step: "fetch",
      done: index + 1,
      total: sources.length,
      message: `Source ${index + 1} failed: ${friendlySourceError(source.error)}`,
    });
    source.error = friendlySourceError(source.error);
  });

  onProgress({
    step: "extract",
    done: 0,
    total: sources.length,
    message: "Checking each source for quoted claims.",
  });
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (Date.now() >= deadline) {
      onProgress({
        step: "extract",
        done: index,
        total: sources.length,
        message: "The 45-second survey limit was reached; keeping verified partial results.",
      });
      break;
    }
    if (source.error || source.text.length < 1) {
      onProgress({
        step: "extract",
        done: index + 1,
        total: sources.length,
        message: `Skipped claim extraction for source ${index + 1}: retrieval was incomplete.`,
      });
      continue;
    }

    try {
      const response = await post("/api/extract", { question, dimensions, source }, 30_000);
      if (!response.ok) throw await readError(response, "Claim extraction");
      logProviderFallback(response);
      const extraction = (await response.json()) as {
        claims: Claim[];
        droppedCount: number;
      };
      claims.push(...extraction.claims);
      droppedClaimCount += extraction.droppedCount;
      onProgress({
        step: "extract",
        done: index + 1,
        total: sources.length,
        message: extraction.droppedCount > 0
          ? `Verifying ${extraction.claims.length + extraction.droppedCount} quotes. ${extraction.droppedCount} AI statements removed: quote not found in source.`
          : `Verifying ${extraction.claims.length} quotes from source ${index + 1} of ${sources.length}.`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Claim extraction failed.";
      const friendlyError = friendlyAnalysisError(errorMessage);
      source.error = [
        source.error,
        error instanceof Error && /45-second/.test(error.message)
          ? "The survey time limit was reached before quote verification finished."
          : friendlyError,
      ]
        .filter(Boolean)
        .join(" ");
      onProgress({
        step: "extract",
        done: index + 1,
        total: sources.length,
        message: `Claim extraction failed for source ${index + 1}: ${friendlyError} Continuing with the others.`,
      });
    }
  }

  if (Date.now() >= deadline) {
    onProgress({
      step: "analyze",
      done: 0,
      total: 1,
      message: "The 45-second survey limit was reached; analyzing the verified partial results.",
    });
  }
  onProgress({
    step: "analyze",
    done: 0,
    total: 1,
    message: "Cross-checking dates and amounts; mapping missing information.",
  });
  const analysis = buildMatrixAnalysis(dimensions, sources, claims);
  const score = computeScore(dimensions, sources, claims, analysis.findings);
  onProgress({
    step: "analyze",
    done: 1,
    total: 1,
    message: "Evidence matrix and preliminary findings are ready.",
  });

  const reportInput: ReportInput = {
    question,
    dimensions,
    sources,
    claims,
    droppedClaimCount,
  };
  onProgress({
    step: "report",
    done: 0,
    total: 1,
    message: "Preparing cautious verification steps.",
  });

  let result: AnalysisResult;
  try {
    const remaining = deadline - Date.now();
    if (remaining <= 100) {
      throw new Error("Survey time limit reached; using the rule-based report.");
    }
    const response = await post(
      "/api/report",
      {
        ...reportInput,
        cells: analysis.cells,
        findings: analysis.findings,
        completenessScore: score.completenessScore,
        scoreExplanation: score.scoreExplanation,
      },
      Math.min(remaining, 12_000),
    );
    if (!response.ok) throw await readError(response, "Report generation");
    logProviderFallback(response);
    result = (await response.json()) as AnalysisResult;
  } catch {
    onProgress({
      step: "report",
      done: 0,
      total: 1,
      message: "Report service unavailable; using rule-based verification steps.",
    });
    result = buildFallbackReport(reportInput);
  }

  onProgress({
    step: "report",
    done: 1,
    total: 1,
    message: "Survey report is ready.",
  });
  return result;
}

function friendlySourceError(error: string): string {
  if (/private|reserved|internal|localhost|not allowed|blocked for safety/i.test(error)) {
    return "Blocked for safety: this URL points to a local, private, or internal address.";
  }
  if (/12\s*mb|download limit|exceeds the/i.test(error)) {
    return "This source exceeds the 12 MB download limit. Try a smaller PDF or an official HTML page.";
  }
  if (/timeout|timed out|aborted/i.test(error)) {
    return "The site did not respond in time. You can continue with the other sources.";
  }
  return error;
}
