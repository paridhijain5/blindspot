import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchSource } from "@/lib/fetchSource";

export const maxDuration = 60;

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
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
      { error: "Provide a valid source URL.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  return NextResponse.json(await fetchSource(parsed.data.url));
}
