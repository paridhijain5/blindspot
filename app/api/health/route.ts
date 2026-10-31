import { NextResponse } from "next/server";
import { callLLM } from "@/lib/llm";

export const maxDuration = 60;

export async function GET() {
  try {
    const result = await callLLM({
      system: "Return a JSON object and nothing else.",
      prompt: 'Return exactly this JSON object: {"status":"ok"}.',
    });

    const headers = new Headers();
    if (result.fallbackNotice) {
      headers.set("x-blindspot-fallback-notice", result.fallbackNotice);
    }
    return NextResponse.json({
      ok: true,
      modelUsed: result.modelUsed,
      data: result.data,
      ...(result.fallbackNotice ? { fallbackNotice: result.fallbackNotice } : {}),
    }, { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown LLM health-check error";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
