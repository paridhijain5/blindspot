import { NextResponse } from "next/server";
import { z } from "zod";
import { extractSourceClaims } from "@/lib/extract";

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

const requestSchema = z.object({
  question: z.string().trim().min(1).max(5000),
  dimensions: z.array(dimensionSchema).min(1).max(10),
  source: sourceSchema,
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Invalid extraction request.", details: parsedRequest.error.issues },
      { status: 400 },
    );
  }

  const { question, dimensions, source } = parsedRequest.data;
  try {
    const result = await extractSourceClaims(
      question,
      dimensions,
      source,
      request.signal,
    );
    const headers = new Headers();
    if (result.fallbackNotice) {
      headers.set("x-blindspot-fallback-notice", result.fallbackNotice);
    }
    return NextResponse.json(
      { claims: result.claims, droppedCount: result.droppedCount },
      { headers },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Claim extraction failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
