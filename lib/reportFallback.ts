import {
  buildMatrixAnalysis,
  computeScore,
} from "./analyze.ts";
import type {
  AnalysisResult,
  ChecklistItem,
  Dimension,
  Finding,
  Source,
  Claim,
} from "./types.ts";

export type ReportInput = {
  question: string;
  dimensions: Dimension[];
  sources: Source[];
  claims: Claim[];
  droppedClaimCount?: number;
};

function urgency(finding: Finding, dimension?: Dimension): number {
  const text = `${dimension?.label ?? ""} ${finding.summary}`.toLowerCase();
  const urgencyBoost =
    /\b(deadline|fee|cost|eligib|renew|mandatory|document|amount|award)\b/.test(text)
      ? 2
      : 0;
  return Math.min(10, finding.severity * 2 + urgencyBoost);
}

function officialHint(finding: Finding, sources: Source[]): string | undefined {
  const official = sources.find((source) => source.tier === "official");
  if (official) return official.title || official.url;
  const relatedSourceIds = new Set(finding.evidence.map((item) => item.sourceId));
  const related = sources.find((source) => relatedSourceIds.has(source.id));
  if (related) return `Check the official authority linked from ${related.title}.`;
  return "Check the relevant official authority or program website.";
}

export function createRuleBasedChecklist(
  findings: Finding[],
  dimensions: Dimension[],
  sources: Source[],
): ChecklistItem[] {
  const dimensionByKey = new Map(dimensions.map((dimension) => [dimension.key, dimension]));
  const checklist = findings
    .slice()
    .sort(
      (left, right) =>
        urgency(right, dimensionByKey.get(right.dimensionKey)) -
        urgency(left, dimensionByKey.get(left.dimensionKey)),
    )
    .map((finding, index) => {
      const dimension = dimensionByKey.get(finding.dimensionKey);
      let action: string;
      if (finding.kind === "conflict") {
        action = `Confirm the ${dimension?.label.toLowerCase() ?? "reported detail"} with an official source.`;
      } else if (finding.kind === "outdated") {
        action = `Check whether the ${dimension?.label.toLowerCase() ?? "information"} is current.`;
      } else if (finding.kind === "unanswered") {
        action = `Find an official source for ${dimension?.label.toLowerCase() ?? "this detail"}.`;
      } else {
        action = `Look for ${dimension?.label.toLowerCase() ?? "this information"} in an official source.`;
      }

      return {
        id: `check-${index + 1}-${encodeURIComponent(finding.id)}`,
        priority: urgency(finding, dimension),
        action,
        reason: finding.summary,
        relatedFindingIds: [finding.id],
        officialSourceHint: officialHint(finding, sources),
      };
    });

  if (checklist.length === 0) {
    return [
      {
        id: "check-1-confirm-official",
        priority: 1,
        action: "Confirm the key details with an official source before acting.",
        reason: "No unresolved signals were identified, but the reviewed sources may not cover every detail.",
        relatedFindingIds: [],
        officialSourceHint: "Check the relevant official authority or program website.",
      },
    ];
  }
  return checklist;
}

export function createFallbackEmailDraft(
  findings: Finding[],
  sources: Source[],
): string {
  const questions =
    findings.length > 0
      ? findings
          .slice(0, 8)
          .map((finding, index) => {
            const evidence =
              finding.evidence.length > 0
                ? ` One reviewed source states “${finding.evidence[0].quote}”.`
                : "";
            return `${index + 1}. Could you please clarify ${finding.summary.toLowerCase()}?${evidence}`;
          })
          .join("\n")
      : "1. Could you please confirm the current official requirements and where they are published?";

  const recipient = sources.find((source) => source.tier === "official")?.title;
  const subject = findings[0]?.dimensionKey.replace(/_/g, " ") ?? "current requirements";
  return `Subject: Clarification requested about ${subject}\n\nDear ${recipient ? `${recipient} team` : "official support team"},\n\nI am reviewing information about “${subject}.” Could you please help clarify the following?\n\n${questions}\n\nThank you for your time.\n`;
}

export function buildFallbackReport(input: ReportInput): AnalysisResult {
  const analysis = buildMatrixAnalysis(
    input.dimensions,
    input.sources,
    input.claims,
  );
  const score = computeScore(
    input.dimensions,
    input.sources,
    input.claims,
    analysis.findings,
  );
  return {
    question: input.question,
    dimensions: input.dimensions,
    sources: input.sources,
    claims: input.claims.filter((claim) => claim.quoteVerified),
    cells: analysis.cells,
    findings: analysis.findings,
    checklist: createRuleBasedChecklist(
      analysis.findings,
      input.dimensions,
      input.sources,
    ),
    completenessScore: score.completenessScore,
    scoreExplanation: score.scoreExplanation,
    droppedClaimCount: input.droppedClaimCount ?? 0,
    emailDraft: createFallbackEmailDraft(analysis.findings, input.sources),
    modelUsed: "Rule-based fallback",
    generatedAt: new Date().toISOString(),
  };
}
