import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseApplicationDeadlineDates } from "./deadlineDates.ts";
import { normalizeValue } from "./normalize.ts";
import { verifyQuote } from "./verifyQuote.ts";
import type { Claim, Dimension, Source } from "./types.ts";
import { callLLM } from "./llm.ts";

const llmClaimSchema = z.object({
  dimensionKey: z.string().min(1).max(100),
  statement: z.string().trim().min(1).max(2000),
  quote: z.string().min(1).max(300),
  valueType: z.enum(["date", "amount", "number", "text", "list", "boolean"]),
  rawValue: z.string().max(500).optional(),
  mentionedCycle: z.string().max(100).nullable().optional(),
});

const claimsResponseSchema = z.object({
  claims: z.array(z.unknown()).max(200),
});

const extractionSystem =
  "You extract claims from ONE source text. For each provided dimension, find statements in the text that address it. Return JSON {claims:[{dimensionKey,statement,quote,valueType,rawValue,mentionedCycle}]}. Rules: use only the text, no outside knowledge; quote must be copied EXACTLY, max 300 chars; if a dimension is not addressed, do not invent a claim; mentionedCycle is the academic year/cycle the text refers to (e.g. 2024-25) or null. For deadline dimensions, extract each distinct application closing date you can find, including dates in tables and lists, and include its exact surrounding source text in the quote. JSON only.";

export function extractDeadlineDateClaims(
  dimensions: Dimension[],
  source: Source,
): Claim[] {
  const deadlineDimensions = dimensions.filter((dimension) =>
    /deadline|closing date|due date/i.test(
      `${dimension.key} ${dimension.label}`,
    ),
  );
  if (!deadlineDimensions.length || !source.text) return [];

  const claims: Claim[] = [];
  for (const parsed of parseApplicationDeadlineDates(source.text)) {
    const context = source.text.slice(
      Math.max(0, parsed.index - 140),
      Math.min(source.text.length, parsed.index + parsed.text.length + 140),
    );
    const quote = context.trim().slice(0, 300);
    if (!verifyQuote(source.text, quote)) continue;
    claims.push({
      id: randomUUID(),
      sourceId: source.id,
      dimensionKey: deadlineDimensions[0].key,
      statement: `The source lists ${parsed.text} in its deadline information.`,
      quote,
      valueType: "date",
      rawValue: parsed.text,
      normalizedValue: parsed.date,
      quoteVerified: true,
    });
  }
  return claims;
}

export async function extractSourceClaims(
  question: string,
  dimensions: Dimension[],
  source: Source,
  signal?: AbortSignal,
): Promise<{
  claims: Claim[];
  droppedCount: number;
  modelUsed: string;
  fallbackNotice?: string;
}> {
  const result = await callLLM({
    system: extractionSystem,
    prompt: JSON.stringify({
      question,
      dimensions: dimensions.map(({ key, label, why }) => ({ key, label, why })),
      source: { title: source.title, url: source.url, text: source.text },
    }),
    signal,
  });
  const parsedResponse = claimsResponseSchema.safeParse(result.data);
  if (!parsedResponse.success) {
    throw new Error(
      `The model returned an invalid claims response: ${parsedResponse.error.message}`,
    );
  }

  const dimensionKeys = new Set(dimensions.map((dimension) => dimension.key));
  const claims: Claim[] = [];
  let droppedCount = 0;

  for (const candidate of parsedResponse.data.claims) {
    const parsedClaim = llmClaimSchema.safeParse(candidate);
    if (!parsedClaim.success || !dimensionKeys.has(parsedClaim.data.dimensionKey)) {
      droppedCount += 1;
      continue;
    }

    const claim = parsedClaim.data;
    if (!verifyQuote(source.text, claim.quote)) {
      droppedCount += 1;
      continue;
    }

    const rawValue = claim.rawValue ?? undefined;
    const normalizedValue = normalizeValue(
      claim.valueType,
      rawValue ?? claim.statement,
    );
    claims.push({
      id: randomUUID(),
      sourceId: source.id,
      dimensionKey: claim.dimensionKey,
      statement: claim.statement,
      quote: claim.quote,
      valueType: claim.valueType,
      ...(rawValue ? { rawValue } : {}),
      ...(normalizedValue ? { normalizedValue } : {}),
      ...(claim.mentionedCycle ? { mentionedCycle: claim.mentionedCycle } : {}),
      quoteVerified: true,
    });
  }

  const extractedDates = extractDeadlineDateClaims(dimensions, source);
  for (const dateClaim of extractedDates) {
    if (
      claims.some(
        (claim) =>
          claim.dimensionKey === dateClaim.dimensionKey &&
          claim.valueType === "date" &&
          claim.normalizedValue === dateClaim.normalizedValue,
      )
    ) {
      continue;
    }
    claims.push(dateClaim);
  }

  return {
    claims,
    droppedCount,
    modelUsed: result.modelUsed,
    ...(result.fallbackNotice ? { fallbackNotice: result.fallbackNotice } : {}),
  };
}
