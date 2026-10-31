import { parseApplicationDeadlineDates } from "./deadlineDates.ts";
import type {
  Cell,
  Claim,
  Dimension,
  Finding,
  Source,
} from "./types.ts";

export type SemanticCheckPair = {
  dimensionKey: string;
  firstClaim: Claim;
  secondClaim: Claim;
};

export type MatrixAnalysis = {
  cells: Cell[];
  findings: Finding[];
  needsSemanticCheck: SemanticCheckPair[];
};

export type Score = {
  completenessScore: number;
  scoreExplanation: string;
};

function isVerifiedFor(
  claim: Claim,
  dimensionKey: string,
  sourceId?: string,
): boolean {
  return (
    claim.quoteVerified &&
    claim.dimensionKey === dimensionKey &&
    (!sourceId || claim.sourceId === sourceId)
  );
}

function makeFindingId(parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

export function buildMatrix(
  dimensions: Dimension[],
  sources: Source[],
  claims: Claim[],
): Cell[] {
  return dimensions.flatMap((dimension) =>
    sources.map((source) => ({
      dimensionKey: dimension.key,
      sourceId: source.id,
      status: claims.some(
        (claim) =>
          isVerifiedFor(claim, dimension.key, source.id),
      )
        ? ("covered" as const)
        : ("missing" as const),
      claimIds: claims
        .filter((claim) => isVerifiedFor(claim, dimension.key, source.id))
        .map((claim) => claim.id),
    })),
  );
}

function numericValue(claim: Claim): number | undefined {
  if (!claim.normalizedValue) return undefined;
  const parsed = Number(claim.normalizedValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isDeadlineDimension(dimension: Dimension): boolean {
  return /deadline|closing date|due date/i.test(
    `${dimension.key} ${dimension.label}`,
  );
}

function deadlineDates(claim: Claim, today: Date): Set<string> {
  const text = [claim.statement, claim.quote, claim.rawValue]
    .filter(Boolean)
    .join(" ");
  const parsedDates = parseApplicationDeadlineDates(text, today);
  if (claim.valueType === "date" && claim.normalizedValue) {
    const normalized = new Date(claim.normalizedValue);
    if (!Number.isNaN(normalized.getTime())) {
      const date = normalized.toISOString().slice(0, 10);
      if (parsedDates.some((parsed) => parsed.date === date)) {
        return new Set([date]);
      }
    }
  }
  return new Set(parsedDates.map((parsed) => parsed.date));
}

function dateSetsDisagree(first: Set<string>, second: Set<string>): boolean {
  return [...first].some((date) => !second.has(date)) ||
    [...second].some((date) => !first.has(date));
}

function claimsDisagree(
  first: Claim,
  second: Claim,
  dimension: Dimension,
  today: Date,
): boolean {
  const firstValue = first.normalizedValue?.trim();
  const secondValue = second.normalizedValue?.trim();
  const compareDeadlineDates =
    isDeadlineDimension(dimension) &&
    (first.valueType === "date" ||
      second.valueType === "date" ||
      first.valueType === "list" ||
      second.valueType === "list" ||
      first.valueType === "text" ||
      second.valueType === "text");
  if (compareDeadlineDates) {
    const firstDates = deadlineDates(first, today);
    const secondDates = deadlineDates(second, today);
    if (firstDates.size > 0 && secondDates.size > 0) {
      return dateSetsDisagree(firstDates, secondDates);
    }
    if (first.valueType === "date" || second.valueType === "date") {
      return false;
    }
  }
  if (!firstValue || !secondValue || firstValue === secondValue) return false;

  if (first.valueType === "date" && second.valueType === "date") {
    return firstValue !== secondValue;
  }
  if (
    (first.valueType === "amount" || first.valueType === "number") &&
    first.valueType === second.valueType
  ) {
    const firstNumber = numericValue(first);
    const secondNumber = numericValue(second);
    if (firstNumber === undefined || secondNumber === undefined) {
      return firstValue !== secondValue;
    }
    if (firstNumber === secondNumber) return false;
    const largestMagnitude = Math.max(Math.abs(firstNumber), Math.abs(secondNumber));
    if (largestMagnitude === 0) return false;
    return Math.abs(firstNumber - secondNumber) / largestMagnitude > 0.01;
  }
  return false;
}

function officialTiebreaker(
  first: Claim,
  second: Claim,
  sourceById: Map<string, Source>,
): string | undefined {
  const firstOfficial = sourceById.get(first.sourceId)?.tier === "official";
  const secondOfficial = sourceById.get(second.sourceId)?.tier === "official";
  if (firstOfficial === secondOfficial) return undefined;
  return firstOfficial ? first.sourceId : second.sourceId;
}

export function detectConflicts(
  dimensions: Dimension[],
  sources: Source[],
  claims: Claim[],
): {
  findings: Finding[];
  conflictingCells: Set<string>;
  needsSemanticCheck: SemanticCheckPair[];
} {
  const dimensionByKey = new Map(dimensions.map((dimension) => [dimension.key, dimension]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const relevantClaims = claims.filter(
    (claim) => claim.quoteVerified && sourceById.has(claim.sourceId),
  );
  const today = getToday();
  const findings: Finding[] = [];
  const conflictingCells = new Set<string>();
  const needsSemanticCheck: SemanticCheckPair[] = [];
  const seenSemanticPairs = new Set<string>();

  for (let firstIndex = 0; firstIndex < relevantClaims.length; firstIndex += 1) {
    const first = relevantClaims[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < relevantClaims.length; secondIndex += 1) {
      const second = relevantClaims[secondIndex];
      if (
        first.dimensionKey !== second.dimensionKey ||
        first.sourceId === second.sourceId
      ) {
        continue;
      }

      const dimension = dimensionByKey.get(first.dimensionKey);
      if (!dimension) continue;

      if (claimsDisagree(first, second, dimension, today)) {
        findings.push({
          id: makeFindingId(["conflict", first.dimensionKey, first.id, second.id]),
          kind: "conflict",
          dimensionKey: first.dimensionKey,
          severity: dimension.importance,
          summary: `${
            first.valueType === "date" || second.valueType === "date" ||
            (isDeadlineDimension(dimension) &&
              deadlineDates(first, today).size > 0 &&
              deadlineDates(second, today).size > 0)
              ? "Dates"
              : "Values"
          } differ across sources.`,
          evidence: [
            { sourceId: first.sourceId, quote: first.quote },
            { sourceId: second.sourceId, quote: second.quote },
          ],
          label: "sourced",
          ...(officialTiebreaker(first, second, sourceById)
            ? {
                suggestedTiebreaker: officialTiebreaker(
                  first,
                  second,
                  sourceById,
                ),
              }
            : {}),
        });
        conflictingCells.add(`${first.dimensionKey}\u0000${first.sourceId}`);
        conflictingCells.add(`${second.dimensionKey}\u0000${second.sourceId}`);
        continue;
      }

      if (
        isDeadlineDimension(dimension) &&
        deadlineDates(first, today).size > 0 &&
        deadlineDates(second, today).size > 0
      ) {
        continue;
      }

      const semanticTypes = ["text", "list"];
      if (
        semanticTypes.includes(first.valueType) &&
        first.valueType === second.valueType
      ) {
        const pairKey = [first.id, second.id].sort().join("\u0000");
        if (!seenSemanticPairs.has(pairKey)) {
          seenSemanticPairs.add(pairKey);
          needsSemanticCheck.push({
            dimensionKey: first.dimensionKey,
            firstClaim: first,
            secondClaim: second,
          });
        }
      }
    }
  }

  return { findings, conflictingCells, needsSemanticCheck };
}

function parseCycleStart(cycle: string | undefined): number | undefined {
  if (!cycle) return undefined;
  const match = cycle.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : undefined;
}

function currentAcademicCycle(today: Date): string {
  const startYear = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function getToday(override?: Date | string): Date {
  const configured = override ?? process.env.TODAY_OVERRIDE;
  const today = configured ? new Date(configured) : new Date();
  if (Number.isNaN(today.getTime())) {
    throw new Error("TODAY_OVERRIDE must be a valid date.");
  }
  return today;
}

export function detectOutdated(
  dimensions: Dimension[],
  sources: Source[],
  claims: Claim[],
  todayOverride?: Date | string,
): { findings: Finding[]; outdatedCells: Set<string> } {
  const dimensionByKey = new Map(dimensions.map((dimension) => [dimension.key, dimension]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const today = getToday(todayOverride);
  const currentCycleStart = parseCycleStart(currentAcademicCycle(today))!;
  const findings: Finding[] = [];
  const outdatedCells = new Set<string>();
  const seen = new Set<string>();

  for (const claim of claims) {
    if (!claim.quoteVerified || !sourceById.has(claim.sourceId)) continue;
    const source = sourceById.get(claim.sourceId)!;
    const dimension = dimensionByKey.get(claim.dimensionKey);
    if (!dimension) continue;

    const sourceDate = source.publishedDate ? new Date(source.publishedDate) : undefined;
    const hasValidSourceDate = sourceDate && !Number.isNaN(sourceDate.getTime());
    const cutoff = new Date(today);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    const publishedTooOld =
      hasValidSourceDate && sourceDate.getTime() < cutoff.getTime();
    const claimCycleStart = parseCycleStart(claim.mentionedCycle);
    const cycleTooOld =
      claimCycleStart !== undefined && claimCycleStart < currentCycleStart;
    const dateUnavailable = !hasValidSourceDate;

    if (!dateUnavailable && !publishedTooOld && !cycleTooOld) continue;

    const findingKey = `${claim.dimensionKey}\u0000${claim.sourceId}\u0000${dateUnavailable ? "unknown" : "outdated"}`;
    if (!seen.has(findingKey)) {
      seen.add(findingKey);
      findings.push({
        id: makeFindingId([
          "outdated",
          claim.dimensionKey,
          claim.sourceId,
          dateUnavailable ? "date-unavailable" : "stale",
        ]),
        kind: "outdated",
        dimensionKey: claim.dimensionKey,
        severity: dimension.importance,
        summary: dateUnavailable
          ? "date not available"
          : cycleTooOld
            ? `Claim refers to an earlier cycle (${claim.mentionedCycle}).`
            : `Source was published more than 12 months ago (${source.publishedDate}).`,
        evidence: [{ sourceId: claim.sourceId, quote: claim.quote }],
        label: dateUnavailable ? "unknown" : "sourced",
      });
    }
    outdatedCells.add(`${claim.dimensionKey}\u0000${claim.sourceId}`);
  }

  return { findings, outdatedCells };
}

export function detectGaps(
  dimensions: Dimension[],
  sources: Source[],
  claims: Claim[],
): Finding[] {
  const findings: Finding[] = [];
  for (const dimension of dimensions) {
    const coveredSourceIds = new Set(
      claims
        .filter((claim) => isVerifiedFor(claim, dimension.key))
        .map((claim) => claim.sourceId),
    );
    if (coveredSourceIds.size === 0) {
      findings.push({
        id: makeFindingId(["gap", dimension.key]),
        kind: "gap",
        dimensionKey: dimension.key,
        severity: dimension.importance,
        summary: `Not found in the ${sources.length} sources reviewed`,
        evidence: [],
        label: "unknown",
      });
      continue;
    }

    const officialCovers = sources.some(
      (source) =>
        source.tier === "official" && coveredSourceIds.has(source.id),
    );
    if (!officialCovers) {
      findings.push({
        id: makeFindingId(["unanswered", dimension.key]),
        kind: "unanswered",
        dimensionKey: dimension.key,
        severity: Math.max(1, dimension.importance - 1) as Finding["severity"],
        summary: "no official source covers this",
        evidence: claims
          .filter(
            (claim) =>
              isVerifiedFor(claim, dimension.key) &&
              coveredSourceIds.has(claim.sourceId),
          )
          .map((claim) => ({ sourceId: claim.sourceId, quote: claim.quote })),
        label: "unknown",
      });
    }
  }
  return findings;
}

export function buildMatrixAnalysis(
  dimensions: Dimension[],
  sources: Source[],
  claims: Claim[],
  todayOverride?: Date | string,
): MatrixAnalysis {
  const cells = buildMatrix(dimensions, sources, claims);
  const conflicts = detectConflicts(dimensions, sources, claims);
  const outdated = detectOutdated(dimensions, sources, claims, todayOverride);
  const findings = [
    ...conflicts.findings,
    ...outdated.findings,
    ...detectGaps(dimensions, sources, claims),
  ];

  const updatedCells = cells.map((cell) => {
    const key = `${cell.dimensionKey}\u0000${cell.sourceId}`;
    if (conflicts.conflictingCells.has(key)) {
      return { ...cell, status: "conflicting" as const };
    }
    if (outdated.outdatedCells.has(key)) {
      return { ...cell, status: "outdated" as const };
    }
    return cell;
  });

  return {
    cells: updatedCells,
    findings,
    needsSemanticCheck: conflicts.needsSemanticCheck,
  };
}

export function computeScore(
  dimensions: Dimension[],
  sources: Source[],
  claims: Claim[],
  findings: Finding[],
): Score {
  const totalImportance = dimensions.reduce(
    (total, dimension) => total + dimension.importance,
    0,
  );
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const supportByDimension = dimensions.map((dimension) => {
    const dimensionClaims = claims.filter((claim) =>
      isVerifiedFor(claim, dimension.key),
    );
    const fullySupported = dimensionClaims.some((claim) => {
      const source = sourceById.get(claim.sourceId);
      return (
        source?.tier === "official" &&
        Boolean(source.publishedDate) &&
        !Number.isNaN(new Date(source.publishedDate ?? "").getTime())
      );
    });
    const partiallySupported = dimensionClaims.length > 0;
    return {
      dimension,
      full: fullySupported,
      partial: !fullySupported && partiallySupported,
    };
  });
  const coveredImportance = supportByDimension.reduce(
    (total, support) =>
      total +
      support.dimension.importance *
        (support.full ? 1 : support.partial ? 0.5 : 0),
    0,
  );
  const baseScore =
    totalImportance === 0 ? 0 : (coveredImportance / totalImportance) * 100;
  const conflictCount = findings.filter((finding) => finding.kind === "conflict").length;
  const penalty = conflictCount * 5;
  const completenessScore = Math.max(
    0,
    Math.min(100, Math.round(baseScore - penalty)),
  );
  const fullySupportedCount = supportByDimension.filter(
    (support) => support.full,
  ).length;
  const partiallySupportedCount = supportByDimension.filter(
    (support) => support.partial,
  ).length;
  const uncoveredCount =
    dimensions.length - fullySupportedCount - partiallySupportedCount;
  const scoreExplanation = `${fullySupportedCount} of ${dimensions.length} research dimensions are covered by an official, dated source; ${partiallySupportedCount} more have partial evidence only from non-official and/or undated sources; ${uncoveredCount} are not covered. The importance-weighted score gives partial evidence half credit. ${conflictCount} unresolved conflict${conflictCount === 1 ? "" : "s"} reduce${conflictCount === 1 ? "s" : ""} it by ${penalty} points.`;

  return { completenessScore, scoreExplanation };
}
