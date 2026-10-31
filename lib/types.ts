export type Source = {
  id: string;
  url: string;
  title: string;
  text: string;
  publishedDate?: string;
  fetchedAt: string;
  retrievalMethod?: "direct" | "jina";
  tier: "official" | "news" | "blog" | "unknown";
  isPdf: boolean;
  error?: string;
};

export type Dimension = {
  key: string;
  label: string;
  importance: 1 | 2 | 3 | 4 | 5;
  why: string;
};

export type Claim = {
  id: string;
  sourceId: string;
  dimensionKey: string;
  statement: string;
  quote: string;
  valueType: "date" | "amount" | "number" | "text" | "list" | "boolean";
  rawValue?: string;
  normalizedValue?: string;
  mentionedCycle?: string;
  quoteVerified: boolean;
};

export type CellStatus = "covered" | "missing" | "conflicting" | "outdated";

export type Cell = {
  dimensionKey: string;
  sourceId: string;
  status: CellStatus;
  claimIds: string[];
};

export type Evidence = {
  sourceId: string;
  quote: string;
};

export type Finding = {
  id: string;
  kind: "gap" | "conflict" | "outdated" | "unanswered";
  dimensionKey: string;
  severity: 1 | 2 | 3 | 4 | 5;
  summary: string;
  evidence: Evidence[];
  label: "sourced" | "ai-inferred" | "unknown";
  suggestedTiebreaker?: string;
};

export type ChecklistItem = {
  id: string;
  priority: number;
  action: string;
  reason: string;
  relatedFindingIds: string[];
  officialSourceHint?: string;
};

export type AnalysisResult = {
  question: string;
  dimensions: Dimension[];
  sources: Source[];
  claims: Claim[];
  cells: Cell[];
  findings: Finding[];
  checklist: ChecklistItem[];
  completenessScore: number;
  scoreExplanation: string;
  droppedClaimCount: number;
  emailDraft?: string;
  modelUsed: string;
  generatedAt: string;
};
