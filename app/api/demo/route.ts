import demoAnalysis from "../../../demo/analysis.json";

export const maxDuration = 60;

export async function GET() {
  const analysis: unknown = demoAnalysis;
  if (
    typeof analysis !== "object" ||
    analysis === null ||
    !("question" in analysis) ||
    typeof analysis.question !== "string" ||
    !("generatedAt" in analysis) ||
    typeof analysis.generatedAt !== "string"
  ) {
    throw new Error("The precomputed demo report has an invalid structure.");
  }

  return Response.json(
    { analysis, savedOn: analysis.generatedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
