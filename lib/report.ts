import { callLLM } from "./llm.ts";
import {
  buildMatrixAnalysis,
  computeScore,
  type SemanticCheckPair,
} from "./analyze.ts";
import type {
  AnalysisResult,
  ChecklistItem,
  Dimension,
  Finding,
} from "./types.ts";
import {
  createFallbackEmailDraft,
  createRuleBasedChecklist,
  type ReportInput,
} from "./reportFallback.ts";

type SemanticDecision = {
  pairId: string;
  decision: "consistent" | "possible_conflict" | "unclear";
};

type ChecklistDraft = {
  action: string;
  reason: string;
  relatedFindingIds: string[];
  priority: number;
  officialSourceHint?: string;
};

function pairId(pair: SemanticCheckPair): string {
  return [pair.dimensionKey, pair.firstClaim.id, pair.secondClaim.id]
    .map(encodeURIComponent)
    .join(":");
}

function semanticFinding(
  pair: SemanticCheckPair,
  dimension: Dimension,
): Finding {
  return {
    id: `semantic:${pairId(pair)}`,
    kind: "conflict",
    dimensionKey: pair.dimensionKey,
    severity: dimension.importance,
    summary: "These quoted statements may differ in meaning; verify both sources.",
    evidence: [
      { sourceId: pair.firstClaim.sourceId, quote: pair.firstClaim.quote },
      { sourceId: pair.secondClaim.sourceId, quote: pair.secondClaim.quote },
    ],
    label: "ai-inferred",
  };
}

function parseSemanticDecisions(value: unknown): SemanticDecision[] {
  if (typeof value !== "object" || value === null || !("decisions" in value)) {
    throw new Error("Semantic review response must contain decisions.");
  }
  const decisions = value.decisions;
  if (!Array.isArray(decisions)) {
    throw new Error("Semantic review decisions must be an array.");
  }
  return decisions.map((decision): SemanticDecision => {
    if (
      typeof decision !== "object" ||
      decision === null ||
      !("pairId" in decision) ||
      typeof decision.pairId !== "string" ||
      !("decision" in decision) ||
      !["consistent", "possible_conflict", "unclear"].includes(
        String(decision.decision),
      )
    ) {
      throw new Error("Semantic review returned an invalid decision.");
    }
    return {
      pairId: decision.pairId,
      decision: decision.decision as SemanticDecision["decision"],
    };
  });
}

function parseChecklist(value: unknown): {
  checklist: ChecklistDraft[];
  emailDraft: { subject: string; body: string };
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("checklist" in value) ||
    !Array.isArray(value.checklist) ||
    !("emailDraft" in value) ||
    typeof value.emailDraft !== "object" ||
    value.emailDraft === null ||
    !("subject" in value.emailDraft) ||
    typeof value.emailDraft.subject !== "string" ||
    !("body" in value.emailDraft) ||
    typeof value.emailDraft.body !== "string"
  ) {
    throw new Error("Report response has an invalid checklist or email draft.");
  }

  const checklist = value.checklist.map((item): ChecklistDraft => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("action" in item) ||
      typeof item.action !== "string" ||
      !("reason" in item) ||
      typeof item.reason !== "string" ||
      !("relatedFindingIds" in item) ||
      !Array.isArray(item.relatedFindingIds) ||
      !item.relatedFindingIds.every((id: unknown) => typeof id === "string") ||
      !("priority" in item) ||
      typeof item.priority !== "number" ||
      item.priority < 1 ||
      item.priority > 10
    ) {
      throw new Error("Report response contains an invalid checklist item.");
    }

    return {
      action: item.action,
      reason: item.reason,
      relatedFindingIds: item.relatedFindingIds,
      priority: Math.round(item.priority),
      ...("officialSourceHint" in item &&
      typeof item.officialSourceHint === "string"
        ? { officialSourceHint: item.officialSourceHint }
        : {}),
    };
  });
  return {
    checklist,
    emailDraft: {
      subject: value.emailDraft.subject,
      body: value.emailDraft.body,
    },
  };
}

export async function runReport(
  input: ReportInput,
  options: {
    signal?: AbortSignal;
    onFallbackNotice?: (message: string) => void;
  } = {},
): Promise<AnalysisResult> {
  const analysis = buildMatrixAnalysis(
    input.dimensions,
    input.sources,
    input.claims,
  );
  const dimensionByKey = new Map(input.dimensions.map((dimension) => [dimension.key, dimension]));
  const findings = [...analysis.findings];
  const modelNames: string[] = [];

  if (analysis.needsSemanticCheck.length > 0) {
    try {
      const semanticResult = await callLLM({
        system:
          "Compare each pair of claims based ONLY on their provided quotes. Decide whether the claims are consistent, a possible_conflict, or unclear in meaning. Do not use outside knowledge. Return JSON {decisions:[{pairId,decision}]}. JSON only.",
        prompt: JSON.stringify({
          pairs: analysis.needsSemanticCheck.map((pair) => ({
            pairId: pairId(pair),
            dimensionKey: pair.dimensionKey,
            firstQuote: pair.firstClaim.quote,
            secondQuote: pair.secondClaim.quote,
          })),
        }),
        signal: options.signal,
      });
      if (semanticResult.fallbackNotice) {
        options.onFallbackNotice?.(semanticResult.fallbackNotice);
      }
      modelNames.push(semanticResult.modelUsed);
      const decisions = parseSemanticDecisions(semanticResult.data);
      const decisionsById = new Map(
        decisions.map((decision) => [decision.pairId, decision.decision]),
      );

      for (const pair of analysis.needsSemanticCheck) {
        if (decisionsById.get(pairId(pair)) !== "possible_conflict") continue;
        const dimension = dimensionByKey.get(pair.dimensionKey);
        if (!dimension) continue;
        findings.push(semanticFinding(pair, dimension));
        for (const sourceId of [pair.firstClaim.sourceId, pair.secondClaim.sourceId]) {
          const cell = analysis.cells.find(
            (candidate) =>
              candidate.dimensionKey === pair.dimensionKey &&
              candidate.sourceId === sourceId,
          );
          if (cell && cell.status !== "conflicting") cell.status = "conflicting";
        }
      }
    } catch {
      modelNames.push("semantic review unavailable");
    }
  }

  let checklist: ChecklistItem[];
  let emailDraft: string;
  try {
    const reportResult = await callLLM({
      system:
        "You help a user decide what to verify before acting on researched information. Given findings with source quotes, return JSON {checklist: [{action,reason,relatedFindingIds,priority 1-10,officialSourceHint}], emailDraft: {subject,body}}. Priority = impact x risk (deadlines, fees, eligibility, mandatory documents rank above contact details). Use cautious wording ('could not find', 'sources disagree', 'appears outdated'). Never state anything as fact unless it is in a provided quote. The email politely asks the official body the unresolved questions as a numbered list. JSON only.",
      prompt: JSON.stringify({
        question: input.question,
        findings: findings.map((finding) => ({
          id: finding.id,
          kind: finding.kind,
          dimensionKey: finding.dimensionKey,
          severity: finding.severity,
          summary: finding.summary,
          evidence: finding.evidence,
          label: finding.label,
          suggestedTiebreaker: finding.suggestedTiebreaker,
        })),
        sources: input.sources
          .filter((source) => source.tier === "official")
          .map(({ id, title, url }) => ({ id, title, url })),
      }),
      signal: options.signal,
    });
    if (reportResult.fallbackNotice) {
      options.onFallbackNotice?.(reportResult.fallbackNotice);
    }
    modelNames.push(reportResult.modelUsed);
    const parsed = parseChecklist(reportResult.data);
    const validFindingIds = new Set(findings.map((finding) => finding.id));
    const safeDrafts = parsed.checklist
      .map((item) => ({
        ...item,
        relatedFindingIds: item.relatedFindingIds.filter((id) =>
          validFindingIds.has(id),
        ),
      }))
      .filter(
        (item) =>
          item.action.trim() &&
          item.reason.trim() &&
          item.relatedFindingIds.length > 0,
      );
    if (safeDrafts.length === 0) throw new Error("The generated checklist was empty.");
    checklist = safeDrafts.map((item, index) => ({
      id: `check-${index + 1}`,
      ...item,
    }));
    emailDraft = `Subject: ${parsed.emailDraft.subject.trim()}\n\n${parsed.emailDraft.body.trim()}`;
    if (!parsed.emailDraft.subject.trim() || !parsed.emailDraft.body.trim()) {
      throw new Error("The generated email draft was empty.");
    }
  } catch {
    checklist = createRuleBasedChecklist(findings, input.dimensions, input.sources);
    emailDraft = createFallbackEmailDraft(findings, input.sources);
    modelNames.push("rule-based checklist fallback");
  }

  const score = computeScore(
    input.dimensions,
    input.sources,
    input.claims,
    findings,
  );
  return {
    question: input.question,
    dimensions: input.dimensions,
    sources: input.sources,
    claims: input.claims.filter((claim) => claim.quoteVerified),
    cells: analysis.cells,
    findings,
    checklist,
    completenessScore: score.completenessScore,
    scoreExplanation: score.scoreExplanation,
    droppedClaimCount: input.droppedClaimCount ?? 0,
    emailDraft,
    modelUsed: modelNames.join(" + ") || "Rule-based fallback",
    generatedAt: new Date().toISOString(),
  };
}
