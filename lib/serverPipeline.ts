import { fetchSource } from "./fetchSource.ts";
import { buildMatrixAnalysis } from "./analyze.ts";
import { extractSourceClaims } from "./extract.ts";
import { generateDimensions } from "./schema.ts";
import { getFallbackDimensions } from "./fallbackDimensions.ts";
import { friendlyAnalysisError } from "./errorMessages.ts";
import { buildFallbackReport } from "./reportFallback.ts";
import { runReport } from "./report.ts";
import type {
  AnalysisResult,
  Claim,
  Dimension,
  Source,
} from "./types.ts";

export type ServerPipelineProgress = {
  step: "schema" | "fetch" | "extract" | "analyze" | "report";
  done: number;
  total: number;
  message: string;
};

export async function runServerPipeline(
  question: string,
  urls: string[],
  onProgress: (progress: ServerPipelineProgress) => void = () => undefined,
): Promise<AnalysisResult> {
  const sourceURLs = urls.slice(0, 8);
  const claims: Claim[] = [];
  let droppedClaimCount = 0;
  let dimensions: Dimension[];

  onProgress({
    step: "schema",
    done: 0,
    total: 1,
    message: "Mapping the information dimensions for your question.",
  });
  try {
    const schema = await generateDimensions(question);
    dimensions = schema.dimensions;
    if (schema.fallbackNotice) {
      onProgress({
        step: "schema",
        done: 1,
        total: 1,
        message: schema.fallbackNotice,
      });
    } else {
      onProgress({
        step: "schema",
        done: 1,
        total: 1,
        message: `${dimensions.length} information dimensions mapped.`,
      });
    }
  } catch (error) {
    dimensions = getFallbackDimensions(question);
    onProgress({
      step: "schema",
      done: 1,
      total: 1,
      message: `Schema generation failed; using broad fallback dimensions. ${error instanceof Error ? error.message : ""}`.trim(),
    });
  }

  onProgress({
    step: "fetch",
    done: 0,
    total: sourceURLs.length,
    message: `Retrieving ${sourceURLs.length} source${sourceURLs.length === 1 ? "" : "s"}.`,
  });
  const sources = await Promise.all(
    sourceURLs.map(async (url, index): Promise<Source> => {
      onProgress({
        step: "fetch",
        done: index,
        total: sourceURLs.length,
        message: `Fetching source ${index + 1} of ${sourceURLs.length}`,
      });
      try {
        return await fetchSource(url);
      } catch (error) {
        return {
          id: `fetch-error-${index}`,
          url,
          title: url,
          text: "",
          fetchedAt: new Date().toISOString(),
          tier: "unknown",
          isPdf: false,
          error:
            error instanceof Error ? error.message : "Source retrieval failed.",
        };
      }
    }),
  );
  sources.forEach((source, index) => {
    onProgress({
      step: "fetch",
      done: index + 1,
      total: sources.length,
      message: source.error
        ? `Source ${index + 1} failed: ${source.error}`
        : `Retrieved source ${index + 1} of ${sources.length}: ${source.title}`,
    });
  });

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (source.error || source.text.length === 0) continue;

    try {
      const extraction = await extractSourceClaims(question, dimensions, source);
      claims.push(...extraction.claims);
      droppedClaimCount += extraction.droppedCount;
      onProgress({
        step: "extract",
        done: index + 1,
        total: sources.length,
        message: `Source ${index + 1}: verified ${extraction.claims.length} quotes; removed ${extraction.droppedCount} unverified statements.`,
      });
    } catch (error) {
      const message = friendlyAnalysisError(
        error instanceof Error ? error.message : "Claim extraction failed.",
      );
      source.error = `Claim extraction unavailable: ${message}`;
      onProgress({
        step: "extract",
        done: index + 1,
        total: sources.length,
        message: `Claim extraction failed for source ${index + 1}: ${message} Continuing with the others.`,
      });
    }
  }

  onProgress({
    step: "analyze",
    done: 0,
    total: 1,
    message: "Cross-checking verified quotes and mapping information gaps.",
  });
  const matrix = buildMatrixAnalysis(dimensions, sources, claims);
  onProgress({
    step: "analyze",
    done: 1,
    total: 1,
    message: "Evidence matrix and preliminary findings are ready.",
  });

  onProgress({
    step: "report",
    done: 0,
    total: 1,
    message: "Preparing cautious verification steps.",
  });
  const input = {
    question,
    dimensions,
    sources,
    claims,
    droppedClaimCount,
  };
  let result: AnalysisResult;
  try {
    result = await runReport(input);
  } catch {
    result = buildFallbackReport(input);
  }
  onProgress({
    step: "report",
    done: 1,
    total: 1,
    message: "Survey report is ready.",
  });
  return {
    ...result,
    cells: matrix.cells.map((cell) => {
      const reportedCell = result.cells.find(
        (candidate) =>
          candidate.dimensionKey === cell.dimensionKey &&
          candidate.sourceId === cell.sourceId,
      );
      return reportedCell ?? cell;
    }),
  };
}
