import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalFetch = globalThis.fetch;
const originalCacheDirectory = process.env.BLINDSPOT_CACHE_DIRECTORY;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const testId = randomUUID();
const system = "Return JSON only.";
const prompt = `Cache fallback test ${testId}`;
const cacheName = `${createHash("sha256").update(system + prompt).digest("hex")}.json`;
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "blindspot-cache-test-"),
);
const blockedCacheFile = path.join(temporaryDirectory, "cache-file");
const fallbackCacheFile = path.join(
  os.tmpdir(),
  "blindspot-cache",
  cacheName,
);

try {
  await writeFile(blockedCacheFile, "this path cannot be a directory", "utf8");
  process.env.BLINDSPOT_CACHE_DIRECTORY = blockedCacheFile;
  process.env.GEMINI_API_KEY = "test-key";
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
    });
  };

  const { callLLM } = await import("../lib/llm.ts");
  const first = await callLLM({ system, prompt });
  assert.deepEqual(first.data, { ok: true });
  const cached = await callLLM({ system, prompt });
  assert.deepEqual(cached.data, { ok: true });
  assert.equal(providerCalls, 1, "the fallback cache should be reused");

  console.log("Read-only cache fallback tests passed.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalCacheDirectory === undefined) {
    delete process.env.BLINDSPOT_CACHE_DIRECTORY;
  } else {
    process.env.BLINDSPOT_CACHE_DIRECTORY = originalCacheDirectory;
  }
  if (originalGeminiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalGeminiKey;
  }
  await Promise.all([
    rm(fallbackCacheFile, { force: true }),
    rm(temporaryDirectory, { recursive: true, force: true }),
  ]);
}
