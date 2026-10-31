import assert from "node:assert/strict";
import {
  buildMatrix,
  buildMatrixAnalysis,
  computeScore,
  detectConflicts,
  detectGaps,
  detectOutdated,
} from "../lib/analyze.ts";
import { extractDeadlineDateClaims } from "../lib/extract.ts";
import { buildFallbackReport } from "../lib/reportFallback.ts";
import type { Claim, Dimension, Source } from "../lib/types.ts";

const dimensions: Dimension[] = [
  {
    key: "deadline",
    label: "Application deadline",
    importance: 5,
    why: "Missing it could prevent an application.",
  },
  {
    key: "current_cycle",
    label: "Current cycle",
    importance: 4,
    why: "The cycle determines current requirements.",
  },
  {
    key: "contact_route",
    label: "Contact route",
    importance: 2,
    why: "Find where to direct questions.",
  },
];

const sources: Source[] = [
  {
    id: "official",
    url: "https://agency.gov.example/deadline",
    title: "Official agency",
    text: "",
    publishedDate: "2026-10-01",
    fetchedAt: "2026-10-31T00:00:00.000Z",
    tier: "official",
    isPdf: false,
  },
  {
    id: "news",
    url: "https://news.example/deadline",
    title: "News report",
    text: "",
    publishedDate: "2026-10-02",
    fetchedAt: "2026-10-31T00:00:00.000Z",
    tier: "news",
    isPdf: false,
  },
  {
    id: "blog",
    url: "https://writer.example/cycle",
    title: "Program notes",
    text: "",
    publishedDate: "2026-10-03",
    fetchedAt: "2026-10-31T00:00:00.000Z",
    tier: "blog",
    isPdf: false,
  },
];

const claims: Claim[] = [
  {
    id: "deadline-official",
    sourceId: "official",
    dimensionKey: "deadline",
    statement: "Applications close June 1.",
    quote: "Applications close June 1.",
    valueType: "date",
    rawValue: "June 1, 2027",
    normalizedValue: "2027-06-01",
    quoteVerified: true,
  },
  {
    id: "deadline-news",
    sourceId: "news",
    dimensionKey: "deadline",
    statement: "Applications close June 30.",
    quote: "Applications close June 30.",
    valueType: "date",
    rawValue: "June 30, 2027",
    normalizedValue: "2027-06-30",
    quoteVerified: true,
  },
  {
    id: "cycle-blog",
    sourceId: "blog",
    dimensionKey: "current_cycle",
    statement: "This page describes the 2024-25 cycle.",
    quote: "This page describes the 2024-25 cycle.",
    valueType: "text",
    mentionedCycle: "2024-25",
    quoteVerified: true,
  },
];

const originalTodayOverride = process.env.TODAY_OVERRIDE;
process.env.TODAY_OVERRIDE = "2026-10-31";

try {
  const matrix = buildMatrix(dimensions, sources, claims);
  assert.equal(
    matrix.find((cell) => cell.dimensionKey === "deadline" && cell.sourceId === "official")
      ?.status,
    "covered",
  );
  assert.equal(
    matrix.find((cell) => cell.dimensionKey === "contact_route" && cell.sourceId === "blog")
      ?.status,
    "missing",
  );

  const conflictResult = detectConflicts(dimensions, sources, claims);
  assert.equal(conflictResult.findings.length, 1);
  assert.equal(conflictResult.findings[0].kind, "conflict");
  assert.equal(conflictResult.findings[0].suggestedTiebreaker, "official");
  assert.deepEqual(conflictResult.findings[0].evidence.map((item) => item.sourceId), [
    "official",
    "news",
  ]);

  const deadlineListClaims: Claim[] = [
    {
      ...claims[0],
      id: "deadline-list",
      valueType: "list",
      rawValue: "Application dates include 31 October 2026 and 31 August 2026.",
      normalizedValue:
        "application dates include 31 october 2026 and 31 august 2026.",
      statement: "The listed application dates include two closing dates.",
      quote: "Application dates include 31 October 2026 and 31 August 2026.",
    },
    {
      ...claims[1],
      id: "deadline-text",
      valueType: "text",
      rawValue: "31 August 2026",
      normalizedValue: "applications close on 31 august 2026.",
      statement: "Applications close on 31 August 2026.",
      quote: "Applications close on 31 August 2026.",
    },
  ];
  const listedDateConflict = buildMatrixAnalysis(
    dimensions,
    sources,
    deadlineListClaims,
  );
  const listedConflict = listedDateConflict.findings.find(
    (finding) => finding.kind === "conflict",
  );
  assert.ok(listedConflict, "date differences in text and lists must conflict");
  assert.deepEqual(
    listedConflict.evidence.map((item) => item.sourceId),
    ["official", "news"],
  );
  assert.ok(
    listedDateConflict.cells
      .filter(
        (cell) =>
          cell.dimensionKey === "deadline" &&
          ["official", "news"].includes(cell.sourceId),
      )
      .every((cell) => cell.status === "conflicting"),
  );
  assert.ok(
    listedConflict.evidence.some((item) => item.quote.includes("31 October 2026")),
  );
  assert.ok(
    listedConflict.evidence.some((item) => item.quote.includes("31 August 2026")),
  );

  const dateListSources = [
    {
      ...sources[0],
      text: "The application deadline is 31 October 2026.",
    },
    {
      ...sources[1],
      text: "There is no single application deadline. As checked on 8 August 2026, the scheme list shows 31 August 2026 and 31 October 2026. The portal is open from 1 June 2026. Institute verification deadline is 15 November 2026.",
    },
  ];
  const dateListClaims = dateListSources.flatMap((source) =>
    extractDeadlineDateClaims(dimensions, source),
  );
  assert.deepEqual(
    dateListClaims
      .filter((claim) => claim.sourceId === "news")
      .map((claim) => claim.normalizedValue),
    ["2026-08-31", "2026-10-31"],
  );
  const textDateConflict = buildMatrixAnalysis(
    dimensions,
    dateListSources,
    dateListClaims,
  ).findings.find((finding) => finding.kind === "conflict");
  assert.ok(textDateConflict, "dates parsed from source text must be compared");
  assert.ok(
    textDateConflict.evidence.some((item) =>
      item.quote.includes("31 August 2026"),
    ),
  );

  const outdatedResult = detectOutdated(dimensions, sources, claims);
  assert.equal(outdatedResult.findings.length, 1);
  assert.equal(outdatedResult.findings[0].dimensionKey, "current_cycle");
  assert.equal(outdatedResult.findings[0].label, "sourced");

  const oldCycleResult = detectOutdated(
    dimensions,
    sources,
    [
      {
        ...claims[2],
        mentionedCycle: "2023-24",
      },
    ],
  );
  assert.equal(oldCycleResult.findings[0].kind, "outdated");
  assert.equal(oldCycleResult.findings[0].label, "sourced");
  assert.ok(oldCycleResult.outdatedCells.has("current_cycle\u0000blog"));

  const undatedSource = { ...sources[2], publishedDate: undefined };
  const undatedResult = detectOutdated(
    dimensions,
    [undatedSource],
    [claims[2]],
  );
  assert.equal(undatedResult.findings[0].label, "unknown");
  assert.equal(undatedResult.findings[0].summary, "date not available");

  const gaps = detectGaps(dimensions, sources, claims);
  assert.ok(
    gaps.some(
      (finding) =>
        finding.kind === "gap" &&
        finding.dimensionKey === "contact_route" &&
        finding.summary === "Not found in the 3 sources reviewed",
    ),
  );
  assert.ok(
    gaps.some(
      (finding) =>
        finding.kind === "unanswered" &&
        finding.dimensionKey === "current_cycle" &&
        finding.summary === "no official source covers this",
    ),
  );

  const analysis = buildMatrixAnalysis(dimensions, sources, claims);
  const score = computeScore(dimensions, sources, claims, analysis.findings);
  assert.equal(score.completenessScore, 59);
  assert.match(score.scoreExplanation, /1 of 3 research dimensions are covered by an official, dated source/);
  assert.match(score.scoreExplanation, /1 more have partial evidence only from non-official and\/or undated sources/);
  assert.match(score.scoreExplanation, /gives partial evidence half credit/);
  const undatedOfficialScore = computeScore(
    dimensions,
    sources.map((source) =>
      source.id === "official" ? { ...source, publishedDate: undefined } : source,
    ),
    claims,
    analysis.findings,
  );
  assert.match(
    undatedOfficialScore.scoreExplanation,
    /0 of 3 research dimensions are covered by an official, dated source; 2 more have partial evidence/,
  );
  assert.equal(
    analysis.cells.find(
      (cell) => cell.dimensionKey === "deadline" && cell.sourceId === "official",
    )?.status,
    "conflicting",
  );
  const fallbackReport = buildFallbackReport({
    question: "When is the deadline?",
    dimensions,
    sources,
    claims,
  });
  assert.ok(fallbackReport.checklist.length > 0);
  assert.match(fallbackReport.emailDraft ?? "", /Subject:/);

  console.log("Analysis engine fixture tests passed.");
} finally {
  if (originalTodayOverride === undefined) {
    delete process.env.TODAY_OVERRIDE;
  } else {
    process.env.TODAY_OVERRIDE = originalTodayOverride;
  }
}
