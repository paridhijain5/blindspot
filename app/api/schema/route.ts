import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDimensions } from "@/lib/schema";

export const maxDuration = 60;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(5000),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a research question.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await generateDimensions(parsed.data.question, request.signal);
    const headers = new Headers();
    if (result.fallbackNotice) {
      headers.set("x-blindspot-fallback-notice", result.fallbackNotice);
    }
    return NextResponse.json(result.dimensions, { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dimension generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
