import { NextResponse } from "next/server";
import { z } from "zod";
import { runReport } from "@/lib/report";

export const maxDuration = 60;

const dimensionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
  label: z.string().trim().min(1).max(120),
  importance: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  why: z.string().trim().min(1).max(500),
});

const sourceSchema = z.object({
  id: z.string().min(1).max(200),
  url: z.string().url().max(2048),
  title: z.string().max(1000),
  text: z.string().max(30_000),
  publishedDate: z.string().optional(),
  fetchedAt: z.string().min(1).max(100),
  retrievalMethod: z.enum(["direct", "jina"]).optional(),
  tier: z.enum(["official", "news", "blog", "unknown"]),
  isPdf: z.boolean(),
  error: z.string().max(2000).optional(),
});

const claimSchema = z.object({
  id: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200),
  dimensionKey: z.string().min(1).max(100),
  statement: z.string().min(1).max(2000),
  quote: z.string().min(1).max(300),
  valueType: z.enum(["date", "amount", "number", "text", "list", "boolean"]),
  rawValue: z.string().max(500).optional(),
  normalizedValue: z.string().max(500).optional(),
  mentionedCycle: z.string().max(100).optional(),
  quoteVerified: z.boolean(),
});

const cellSchema = z.object({
  dimensionKey: z.string().min(1).max(100),
  sourceId: z.string().min(1).max(200),
  status: z.enum(["covered", "missing", "conflicting", "outdated"]),
  claimIds: z.array(z.string().max(200)).max(200),
});

const findingSchema = z.object({
  id: z.string().min(1).max(1000),
  kind: z.enum(["gap", "conflict", "outdated", "unanswered"]),
  dimensionKey: z.string().min(1).max(100),
  severity: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  summary: z.string().max(2000),
  evidence: z
    .array(z.object({ sourceId: z.string().max(200), quote: z.string().max(300) }))
    .max(100),
  label: z.enum(["sourced", "ai-inferred", "unknown"]),
  suggestedTiebreaker: z.string().max(200).optional(),
});

const requestSchema = z.object({
  question: z.string().trim().min(1).max(5000),
  dimensions: z.array(dimensionSchema).min(1).max(10),
  sources: z.array(sourceSchema).min(1).max(8),
  claims: z.array(claimSchema).max(1600),
  droppedClaimCount: z.number().int().min(0).optional(),
  cells: z.array(cellSchema).max(80).optional(),
  findings: z.array(findingSchema).max(1600).optional(),
  completenessScore: z.number().min(0).max(100).optional(),
  scoreExplanation: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid report request.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    let fallbackNotice: string | undefined;
    const report = await runReport(parsed.data, {
      signal: request.signal,
      onFallbackNotice: (message) => {
        fallbackNotice = message;
      },
    });
    const headers = new Headers();
    if (fallbackNotice) {
      headers.set("x-blindspot-fallback-notice", fallbackNotice);
    }
    return NextResponse.json(report, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
