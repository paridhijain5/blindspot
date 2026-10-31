import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult, Claim, Source } from "../lib/types.ts";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

type DemoSource = Pick<
  Source,
  "url" | "title" | "text" | "publishedDate" | "tier"
>;

type DemoConfig = {
  question: string;
  urls: string[];
};

function isDemoConfig(value: unknown): value is DemoConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "question" in value &&
    typeof value.question === "string" &&
    "urls" in value &&
    Array.isArray(value.urls) &&
    value.urls.every((url) => typeof url === "string")
  );
}

function sanitizeString(value: string): string {
  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        sanitized += value.slice(index, index + 2);
        index += 1;
      } else {
        sanitized += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      sanitized += "\ufffd";
    } else {
      sanitized += value[index];
    }
  }
  return sanitized;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        sanitizeString(key),
        sanitizeJsonValue(entry),
      ]),
    );
  }
  return value;
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(sanitizeJsonValue(value), null, 2);
  if (serialized === undefined) {
    throw new Error("Could not serialize demo data as JSON.");
  }
  return `${serialized}\n`;
}

function sourceExcerpt(source: Source, claims: Claim[]): string {
  const excerpts = claims
    .filter((claim) => claim.sourceId === source.id && claim.quoteVerified)
    .map((claim) => {
      const start = source.text
        .toLowerCase()
        .indexOf(claim.quote.toLowerCase());
      if (start < 0) return claim.quote;
      const excerptStart = Math.max(0, start - 100);
      const excerptEnd = Math.min(
        source.text.length,
        start + claim.quote.length + 100,
      );
      return source.text.slice(excerptStart, excerptEnd).trim();
    });

  const uniqueExcerpts = [...new Set(excerpts)].slice(0, 10);
  if (uniqueExcerpts.length > 0) {
    return uniqueExcerpts.join("\n\n[...]\n\n");
  }
  if (source.text.length > 200) {
    return source.text.slice(0, 500).trim();
  }
  return "No source excerpt was available when this sample was built.";
}

function sourceFilename(source: Source, index: number): string {
  const host = new URL(source.url).hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${String(index + 1).padStart(2, "0")}-${host}.json`;
}

async function main() {
  loadEnvConfig(process.cwd());
  process.env.BLINDSPOT_CACHE_DIRECTORY = path.join(
    process.cwd(),
    ".cache",
    "demo",
  );

  const configPath = path.join(process.cwd(), "demo", "urls.json");
  const configValue: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (!isDemoConfig(configValue) || configValue.urls.length === 0) {
    throw new Error("demo/urls.json must contain a question and at least one URL.");
  }
  if (configValue.urls.length > 8) {
    throw new Error("The demo can contain no more than eight source URLs.");
  }

  const { runServerPipeline } = await import("../lib/serverPipeline.ts");
  const result = await runServerPipeline(
    configValue.question,
    configValue.urls,
    (progress) => {
      process.stdout.write(`[${progress.step}] ${progress.message}\n`);
    },
  );

  const demoDirectory = path.join(process.cwd(), "demo");
  const sourcesDirectory = path.join(demoDirectory, "sources");
  await mkdir(sourcesDirectory, { recursive: true });

  const safeSources = result.sources.map((source, index) => {
    const demoSource: DemoSource = {
      url: source.url,
      title: source.title,
      text: sourceExcerpt(source, result.claims),
      ...(source.publishedDate ? { publishedDate: source.publishedDate } : {}),
      tier: source.tier,
    };
    const filename = sourceFilename(source, index);
    return { source, demoSource, filename };
  });

  for (const { demoSource, filename } of safeSources) {
    await writeFile(
      path.join(sourcesDirectory, filename),
      serializeJson(demoSource),
      "utf8",
    );
  }

  const safeResult: AnalysisResult = {
    ...result,
    sources: result.sources.map((source) => ({
      ...source,
      text:
        safeSources.find((item) => item.source.id === source.id)?.demoSource
          .text ?? "",
    })),
  };
  await writeFile(
    path.join(demoDirectory, "analysis.json"),
    serializeJson(safeResult),
    "utf8",
  );

  process.stdout.write(
    `Saved ${safeSources.length} cited source excerpts and ${result.claims.length} verified claims to demo/. LLM cache entries are in .cache/demo/.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Demo build failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
