"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  AnalysisResult,
  Cell,
  CellStatus,
  Claim,
  Finding,
  Source,
} from "@/lib/types";

type DrawerTarget = {
  dimensionKey: string;
  sourceId: string;
};

const findingGroups: { kind: Finding["kind"]; label: string }[] = [
  { kind: "conflict", label: "Conflicts" },
  { kind: "gap", label: "Gaps" },
  { kind: "outdated", label: "Outdated" },
  { kind: "unanswered", label: "Unanswered" },
];

const statusNames: Record<CellStatus, string> = {
  covered: "covered",
  missing: "unsurveyed",
  conflicting: "conflicting",
  outdated: "outdated",
};

function tierLabel(tier: Source["tier"]): string {
  return tier.toUpperCase();
}

function sourceErrorLabel(source: Source): string | undefined {
  if (!source.error) return undefined;
  return source.text.length > 0 && source.error.startsWith("Claim extraction unavailable:")
    ? `Claim analysis incomplete: ${source.error.replace("Claim extraction unavailable: ", "")}`
    : source.error;
}

function SignalTag({ label }: { label: Finding["label"] }) {
  const text = label === "sourced" ? "SOURCED" : label === "ai-inferred" ? "AI SIGNAL" : "UNKNOWN";
  return (
    <span className={`signal-tag signal-tag--${label}`}>
      <span className="signal-tag-icon" aria-hidden="true">
        {label === "sourced" ? (
          <svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3" fill="currentColor" /></svg>
        ) : label === "ai-inferred" ? (
          <svg viewBox="0 0 12 12"><path d="M6 1.5 10.5 6 6 10.5 1.5 6 6 1.5Z" fill="none" stroke="currentColor" /></svg>
        ) : (
          <svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.5" fill="none" stroke="currentColor" /></svg>
        )}
      </span>
      {text}
    </span>
  );
}

function TierBadge({ tier }: { tier: Source["tier"] }) {
  return <span className={`tier-badge tier-badge--${tier}`}>{tierLabel(tier)}</span>;
}

function StatusMark({ status }: { status: CellStatus }) {
  if (status === "covered") return <span className="cell-covered-mark" aria-hidden="true"><i /></span>;
  if (status === "missing") return <span className="cell-missing-mark" aria-hidden="true" />;
  if (status === "conflicting") return <span className="cell-conflict-mark" aria-hidden="true">≠</span>;
  return (
    <svg className="cell-outdated-mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" fill="currentColor" />
      <circle cx="10" cy="10" r="5.2" fill="none" stroke="var(--paper)" strokeWidth="1.2" />
      <path d="M10 6.5V10l2.2 1.4" fill="none" stroke="var(--paper)" strokeWidth="1.2" />
    </svg>
  );
}

function StatusText({ status }: { status: CellStatus }) {
  return statusNames[status];
}

function contextSnippet(text: string, quote: string): { before: string; match: string; after: string } | null {
  const index = text.toLowerCase().indexOf(quote.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 150);
  const end = Math.min(text.length, index + quote.length + 150);
  return {
    before: `${start > 0 ? "…" : ""}${text.slice(start, index)}`,
    match: text.slice(index, index + quote.length),
    after: `${text.slice(index + quote.length, end)}${end < text.length ? "…" : ""}`,
  };
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (typeof value !== "object" || value === null) return false;
  return (
    "question" in value &&
    typeof value.question === "string" &&
    "dimensions" in value &&
    Array.isArray(value.dimensions) &&
    "sources" in value &&
    Array.isArray(value.sources) &&
    "claims" in value &&
    Array.isArray(value.claims) &&
    "cells" in value &&
    Array.isArray(value.cells) &&
    "findings" in value &&
    Array.isArray(value.findings) &&
    "checklist" in value &&
    Array.isArray(value.checklist) &&
    "completenessScore" in value &&
    typeof value.completenessScore === "number" &&
    "scoreExplanation" in value &&
    typeof value.scoreExplanation === "string" &&
    "droppedClaimCount" in value &&
    typeof value.droppedClaimCount === "number" &&
    "generatedAt" in value &&
    typeof value.generatedAt === "string" &&
    "modelUsed" in value &&
    typeof value.modelUsed === "string"
  );
}

function MarkdownExport({ result }: { result: AnalysisResult }) {
  const markdown = useMemo(() => {
    const sourceById = new Map(result.sources.map((source) => [source.id, source]));
    const findings = result.findings
      .map((finding) => {
        const evidence = finding.evidence
          .map((item) => {
            const source = sourceById.get(item.sourceId);
            return `  - ${source?.title ?? item.sourceId}: “${item.quote}”`;
          })
          .join("\n");
        return `### ${finding.kind.toUpperCase()} · ${finding.summary}\n\n- Signal: ${finding.label}\n- Severity: ${finding.severity}/5\n${evidence}`;
      })
      .join("\n\n");
    const checklist = result.checklist
      .map((item, index) => `${index + 1}. [ ] ${item.action} (priority ${item.priority}/10)\n   - ${item.reason}`)
      .join("\n");
    const gridHeader = `| Dimension | ${result.sources.map((source) => source.title.replace(/\|/g, "\\|")).join(" | ")} |\n| --- | ${result.sources.map(() => "---").join(" | ")} |`;
    const gridRows = result.dimensions
      .map((dimension) => {
        const values = result.sources.map((source) => {
          const cell = result.cells.find((item) => item.dimensionKey === dimension.key && item.sourceId === source.id);
          return cell?.status ?? "missing";
        });
        return `| ${dimension.label} | ${values.join(" | ")} |`;
      })
      .join("\n");

    return `# BlindSpot Field Survey\n\n> ${result.question}\n\n## Coverage\n\n${result.completenessScore}% — ${result.scoreExplanation}\n\nBased on ${result.sources.length} sources reviewed. An estimate, not a guarantee.\n\n## Survey grid\n\n${gridHeader}\n${gridRows}\n\n## The Ledger\n\n${findings || "No unresolved signals identified."}\n\n## Verify next\n\n${checklist || "No checklist items."}\n\n## Sources\n\n${result.sources.map((source) => `- [${source.title}](${source.url}) — ${source.publishedDate ?? "undated"} (${source.tier})`).join("\n")}\n\n## Transparency\n\n${result.droppedClaimCount} AI statements removed because their quotes could not be verified in the source.\n\nModel: ${result.modelUsed}\nGenerated: ${result.generatedAt}\n\nAI findings are potential signals. Verify with the official source.\n`;
  }, [result]);

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const address = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = address;
    link.download = "blindspot-survey-report.md";
    link.click();
    URL.revokeObjectURL(address);
  }

  return <button className="text-button" onClick={download} type="button">Download report (.md)</button>;
}

function SpecimenDrawer({
  result,
  target,
  onClose,
  closeButtonRef,
}: {
  result: AnalysisResult;
  target: DrawerTarget | null;
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const dimension = target ? result.dimensions.find((item) => item.key === target.dimensionKey) : undefined;
  const source = target ? result.sources.find((item) => item.id === target.sourceId) : undefined;
  if (!target || !dimension || !source) return null;

  const cell = result.cells.find((item) => item.dimensionKey === target.dimensionKey && item.sourceId === target.sourceId);
  const claimIds = new Set(cell?.claimIds ?? []);
  const selectedClaims = result.claims.filter((claim) => claimIds.has(claim.id));
  const conflictFindings = result.findings.filter(
    (finding) =>
      finding.dimensionKey === target.dimensionKey &&
      finding.kind === "conflict" &&
      finding.evidence.some((item) => item.sourceId === target.sourceId),
  );
  const conflictingClaims = conflictFindings
    .flatMap((finding) => finding.evidence)
    .map((evidence) =>
      result.claims.find(
        (claim) =>
          claim.dimensionKey === target.dimensionKey &&
          claim.sourceId === evidence.sourceId &&
          claim.quote === evidence.quote,
      ),
    )
    .filter((claim): claim is Claim => Boolean(claim));
  const claims = cell?.status === "conflicting" && conflictingClaims.length > 0
    ? [...new Map(conflictingClaims.map((claim) => [claim.id, claim])).values()]
    : selectedClaims;
  const otherCoveringSources = result.sources.filter(
    (candidate) =>
      candidate.id !== source.id &&
      result.cells.some(
        (item) =>
          item.dimensionKey === target.dimensionKey &&
          item.sourceId === candidate.id &&
          item.claimIds.length > 0,
      ),
  );
  const associatedFinding = result.findings.find(
    (finding) =>
      finding.dimensionKey === target.dimensionKey &&
      finding.evidence.some((item) => item.sourceId === source.id),
  );

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        className="specimen-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="specimen-title"
      >
        <div className="drawer-head">
          <div>
            <p className="micro-label">Evidence specimen</p>
            <h2 id="specimen-title">{dimension.label}</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button" onClick={onClose} type="button" aria-label="Close specimen">
            <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 14 14" width="14">
              <path d="m2 2 10 10m0-10L2 12" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>

        <div className="drawer-status">
          <StatusMark status={cell?.status ?? "missing"} />
          <span>{cell ? <StatusText status={cell.status} /> : "unsurveyed"}</span>
          {associatedFinding ? <SignalTag label={associatedFinding.label} /> : null}
        </div>

        {cell?.status === "missing" || !cell ? (
          <section className="drawer-section">
            {source.error && source.text.length === 0 ? (
              <>
                <h3>Source unavailable</h3>
                <p>{sourceErrorLabel(source)}</p>
              </>
            ) : (
              <>
                <h3>{source.error ? "Claim analysis incomplete" : "Not found in this source"}</h3>
                {source.error ? <p>{sourceErrorLabel(source)}</p> : null}
                {otherCoveringSources.length > 0 ? (
                  <p>Other sources that do cover this dimension: {otherCoveringSources.map((item) => item.title).join(", ")}.</p>
                ) : (
                  <p>No other reviewed source currently covers this dimension.</p>
                )}
              </>
            )}
          </section>
        ) : claims.length > 0 ? (
          <section className={`drawer-claims ${claims.length > 1 ? "drawer-claims--conflict" : ""}`}>
            {claims.map((claim, index) => {
              const claimSource = result.sources.find((item) => item.id === claim.sourceId);
              const snippet = contextSnippet(claimSource?.text ?? source.text, claim.quote);
              return (
                <article className="specimen-claim" key={claim.id}>
                  {claims.length > 1 ? <span className="claim-source">{claimSource?.title ?? "Source"} / {index + 1}</span> : null}
                  <h3>{claim.statement}</h3>
                  <blockquote className="specimen-quote">
                    <mark>{claim.quote}</mark>
                  </blockquote>
                  {snippet ? (
                    <div className="context-block">
                      <span className="micro-label">Context in source</span>
                      <p>{snippet.before}<mark>{snippet.match}</mark>{snippet.after}</p>
                    </div>
                  ) : null}
                  <div className="specimen-source">
                    <strong>{claimSource?.title ?? source.title}</strong>
                    <a href={claimSource?.url ?? source.url} target="_blank" rel="noopener noreferrer">
                      Open original source
                      <svg aria-hidden="true" fill="none" height="12" viewBox="0 0 12 12" width="12">
                        <path d="M3 9 9 3M4 3h5v5" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                    </a>
                    <span>{claimSource?.publishedDate ?? "undated"}</span>
                    <TierBadge tier={claimSource?.tier ?? source.tier} />
                  </div>
                </article>
              );
            })}
            {claims.length > 1 ? <span className="drawer-not-equal" aria-label="claims may conflict">≠</span> : null}
          </section>
        ) : (
          <section className="drawer-section"><h3>No verified claim in this cell</h3><p>Quotes that could not be verified were excluded from the survey.</p></section>
        )}

        {conflictFindings.some((finding) => finding.suggestedTiebreaker) ? (
          <p className="tiebreaker-note">Suggestion: the official source may be the more reliable one. Verify.</p>
        ) : null}
        <div className="drawer-source-meta">
          <span>Surveyed source</span>
          <strong>{source.title}</strong>
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-url">{source.url}</a>
          <span>{source.publishedDate ?? "undated"} · {tierLabel(source.tier)}</span>
          {source.error ? <p className="source-error">{sourceErrorLabel(source)}</p> : null}
        </div>
      </aside>
    </div>
  );
}

export default function ResultsExperience({
  demoMode = false,
}: {
  demoMode?: boolean;
}) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [ready, setReady] = useState(false);
  const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null);
  const [demoSavedOn, setDemoSavedOn] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [checksLoaded, setChecksLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (demoMode) {
      const controller = new AbortController();
      async function loadDemo() {
        try {
          const response = await fetch("/api/demo", {
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error("The precomputed scholarship demo could not be loaded.");
          }
          const payload: unknown = await response.json();
          if (
            typeof payload !== "object" ||
            payload === null ||
            !("analysis" in payload) ||
            !isAnalysisResult(payload.analysis) ||
            !("savedOn" in payload) ||
            typeof payload.savedOn !== "string"
          ) {
            throw new Error("The saved scholarship demo has an unexpected format.");
          }
          setResult(payload.analysis);
          setDraft(payload.analysis.emailDraft ?? "");
          setDemoSavedOn(payload.savedOn);
        } catch (error) {
          if (controller.signal.aborted) return;
          setNotice(
            error instanceof Error
              ? error.message
              : "The precomputed scholarship demo could not be loaded.",
          );
        } finally {
          if (!controller.signal.aborted) setReady(true);
        }
      }
      void loadDemo();
      return () => controller.abort();
    }

    let active = true;
    let parsedResult: AnalysisResult | null = null;
    let loadNotice = "";
    try {
      const saved = sessionStorage.getItem("blindspot:analysis");
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isAnalysisResult(parsed)) {
          parsedResult = parsed;
        } else {
          loadNotice = "The saved survey has an unexpected format.";
        }
      }
    } catch {
      loadNotice = "The saved survey could not be read from this browser session.";
    }
    const timer = window.setTimeout(() => {
      if (!active) return;
      if (parsedResult) {
        setResult(parsedResult);
        setDraft(parsedResult.emailDraft ?? "");
      }
      if (loadNotice) setNotice(loadNotice);
      setReady(true);
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [demoMode]);

  const storageKey = result ? `blindspot:checks:${result.generatedAt}` : "";
  const checklistIdKey = result?.checklist.map((item) => item.id).join("|") ?? "";
  useEffect(() => {
    if (!storageKey) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      try {
        const saved = localStorage.getItem(storageKey);
        const parsed: unknown = saved ? JSON.parse(saved) : [];
        const validIds = new Set(checklistIdKey ? checklistIdKey.split("|") : []);
        setChecked(
          Array.isArray(parsed)
            ? parsed.filter(
                (id): id is string => typeof id === "string" && validIds.has(id),
              )
            : [],
        );
      } catch {
        setChecked([]);
        setNotice("Checklist progress could not be loaded from local storage.");
      } finally {
        setChecksLoaded(true);
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [checklistIdKey, storageKey]);

  useEffect(() => {
    if (!storageKey || !checksLoaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(checked));
    } catch {
      window.setTimeout(() => {
        setNotice("Checklist progress could not be saved in this browser.");
      }, 0);
    }
  }, [checked, checksLoaded, storageKey]);

  const openCell = useCallback((dimensionKey: string, sourceId: string) => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDrawerTarget({ dimensionKey, sourceId });
  }, []);

  useEffect(() => {
    if (!drawerTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerTarget(null);
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = document.querySelector(".specimen-drawer");
      const focusable = drawer?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [drawerTarget]);

  if (!ready) {
    return (
      <main className="results-loading" aria-label="Loading saved survey">
        <div className="skeleton-line skeleton-line--short" />
        <div className="skeleton-line skeleton-line--large" />
        <div className="skeleton-grid">{Array.from({ length: 28 }, (_, i) => <span key={i} />)}</div>
        <p>Opening your field notes…</p>
      </main>
    );
  }

  if (!result) {
    return (
      <main className="results-empty">
        <p className="eyebrow">No survey in this session</p>
        <h1>Your field sheet is still blank.</h1>
        <p>Start a survey to see quoted evidence, potential gaps, and what to verify next.</p>
        {notice ? <p role="status">{notice}</p> : null}
        <Link className="run-button" href="/">Start a survey</Link>
      </main>
    );
  }

  const orderedDimensions = [...result.dimensions].sort((a, b) => b.importance - a.importance);
  const count = (kind: Finding["kind"]) => result.findings.filter((finding) => finding.kind === kind).length;
  const checklistIds = new Set(result.checklist.map((item) => item.id));
  const verifiedCount = checked.filter((id) => checklistIds.has(id)).length;
  const progressPercent = result.checklist.length ? (verifiedCount / result.checklist.length) * 100 : 0;
  const sourceById = new Map(result.sources.map((source) => [source.id, source]));
  function toggleChecklist(id: string) {
    setChecked((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function findCell(dimensionKey: string, sourceId: string): Cell {
    return result!.cells.find((cell) => cell.dimensionKey === dimensionKey && cell.sourceId === sourceId) ?? {
      dimensionKey,
      sourceId,
      status: "missing",
      claimIds: [],
    };
  }

  function handleCopy() {
    void (async () => {
      try {
        if (!navigator.clipboard) throw new Error("Clipboard is unavailable.");
        await navigator.clipboard.writeText(draft);
        setNotice("Draft copied to clipboard.");
      } catch {
        setNotice("Clipboard access was unavailable. Select and copy the draft manually.");
      }
    })();
  }

  function handleMailto() {
    const subjectMatch = draft.match(/^Subject:\s*(.+)$/mi);
    const body = draft.replace(/^Subject:\s*.+\r?\n*/mi, "").trim();
    const mailto = `mailto:?subject=${encodeURIComponent(subjectMatch?.[1] ?? "Research clarification")}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  return (
    <main className="results-shell">
      {demoMode ? (
        <div className="demo-banner" role="status">
          Demo: sample sources saved on {demoSavedOn ? new Date(demoSavedOn).toLocaleDateString() : "the saved date"}, analysis pre-computed.
        </div>
      ) : null}
      <aside className="results-rail">
        <p className="eyebrow">Survey no. 001 / Results</p>
        <h1>{result.question}</h1>
        <section className="coverage-gauge" aria-label={`Completeness estimate ${result.completenessScore} percent`}>
          <div className="gauge-ruler" aria-hidden="true">
            {Array.from({ length: 21 }, (_, index) => (
              <span className={index * 5 <= result.completenessScore ? "is-filled" : ""} key={index} />
            ))}
          </div>
          <div className="gauge-score"><strong>{result.completenessScore}</strong><span>%</span></div>
          <p>{result.scoreExplanation}</p>
          <span className="gauge-footnote">Based on {result.sources.length} sources reviewed. An estimate, not a guarantee.</span>
        </section>

        <div className="rail-counters">
          <div><strong>{count("gap")}</strong><span>Gaps</span></div>
          <div><strong>{count("conflict")}</strong><span>Conflicts</span></div>
          <div><strong>{count("outdated")}</strong><span>Outdated</span></div>
        </div>

        <section className="rail-sources">
          <h2>Sources <span>{result.sources.length}</span></h2>
          {result.sources.map((source) => (
            <article className="rail-source" key={source.id}>
              <strong>{source.title || source.url}</strong>
              <div><TierBadge tier={source.tier} /><span>{source.publishedDate ?? "undated"}</span></div>
              {source.error ? <p className="source-error">{sourceErrorLabel(source)}</p> : null}
            </article>
          ))}
        </section>
      </aside>

      <div className="results-main">
        <header className="results-heading">
          <div><p className="micro-label">Survey record / 001</p><h2>The Survey Grid</h2></div>
          <div className="export-actions">
            <MarkdownExport result={result} />
            <button className="text-button" onClick={() => window.print()} type="button">Print / save as PDF</button>
          </div>
        </header>

        <section className="survey-grid-section" aria-label="Evidence survey grid">
          {result.sources.length === 0 || orderedDimensions.length === 0 ? (
            <div className="empty-panel"><h3>No matrix to plot yet</h3><p>Add sources and research dimensions to create a survey grid.</p></div>
          ) : (
            <div className="grid-scroll">
              <table className="survey-grid-table">
                <thead>
                  <tr>
                    <th scope="col" className="grid-corner">Dimension</th>
                    {result.sources.map((source, index) => (
                      <th scope="col" className="source-column" key={source.id}>
                        <button className="source-column-button" onClick={() => openCell(orderedDimensions[0]?.key ?? "", source.id)} type="button" aria-label={`Open ${source.title}`}>
                          <span className="source-column-title">{source.title || `Source ${index + 1}`}</span>
                          <TierBadge tier={source.tier} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderedDimensions.map((dimension, rowIndex) => (
                    <tr key={dimension.key}>
                      <th scope="row" className="dimension-heading">
                        <span className="importance-dots" role="img" aria-label={`Importance ${dimension.importance} of 5`}>
                          {Array.from({ length: 5 }, (_, i) => <i className={i < dimension.importance ? "is-on" : ""} key={i} />)}
                        </span>
                        <span>{dimension.label}</span>
                      </th>
                      {result.sources.map((source, columnIndex) => {
                        const cell = findCell(dimension.key, source.id);
                        return (
                          <td key={source.id}>
                            <button
                              className={`heat-cell heat-cell--${cell.status}`}
                              onClick={() => openCell(dimension.key, source.id)}
                              aria-label={`${dimension.label}, Source ${columnIndex + 1}: ${statusNames[cell.status]}`}
                              style={{ animationDelay: `${(rowIndex * result.sources.length + columnIndex) * 35}ms` }}
                              type="button"
                            >
                              <StatusMark status={cell.status} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid-legend" aria-label="Survey grid legend">
            {(["covered", "missing", "conflicting", "outdated"] as CellStatus[]).map((status) => (
              <span key={status}><StatusMark status={status} /><span>{statusNames[status]}</span></span>
            ))}
          </div>
        </section>

        <section className="ledger-section" aria-labelledby="ledger-title">
          <div className="section-title-row"><div><p className="micro-label">Evidence register</p><h2 id="ledger-title">The Ledger</h2></div><span>{result.findings.length} signals</span></div>
          {result.findings.length === 0 ? (
            <div className="empty-panel"><h3>No unresolved signals surfaced</h3><p>This is not a guarantee of completeness. Verify important details with the official source.</p></div>
          ) : (
            <div className="ledger-groups">
              {findingGroups.map((group) => {
                const findings = result.findings.filter((finding) => finding.kind === group.kind);
                if (!findings.length) return null;
                return (
                  <section className="ledger-group" key={group.kind}>
                    <h3>{group.label} <span>{findings.length}</span></h3>
                    <div className="ledger-cards">
                      {findings.map((finding) => {
                        const dimension = result.dimensions.find((item) => item.key === finding.dimensionKey);
                        return (
                          <article className="finding-card" key={finding.id}>
                            <div className="finding-card-top"><SignalTag label={finding.label} /><span className="severity-marks" role="img" aria-label={`Severity ${finding.severity} of 5`}>{Array.from({ length: 5 }, (_, i) => <i className={i < finding.severity ? "is-on" : ""} key={i} />)}</span></div>
                            <h4>{dimension?.label ?? finding.dimensionKey}</h4>
                            <p>{finding.summary}</p>
                            {finding.suggestedTiebreaker ? <p className="suggestion-note">Suggestion: the official source may be the more reliable one. Verify.</p> : null}
                            {finding.evidence.length ? (
                              <div className="evidence-chips">
                                {finding.evidence.map((evidence, index) => {
                                  const source = sourceById.get(evidence.sourceId);
                                  return (
                                    <button key={`${evidence.sourceId}-${index}`} onClick={() => openCell(finding.dimensionKey, evidence.sourceId)} type="button">
                                      {source?.title ?? "Source"} · quote {index + 1}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>

        <section className="field-notes-section" aria-labelledby="field-notes-title">
          <div className="section-title-row"><div><p className="micro-label">Action register</p><h2 id="field-notes-title">Field Notes</h2></div><span>{verifiedCount} of {result.checklist.length} verified</span></div>
          <div className="check-progress" role="progressbar" aria-label="Verification checklist progress" aria-valuemin={0} aria-valuemax={Math.max(1, result.checklist.length)} aria-valuenow={verifiedCount}><span style={{ width: `${progressPercent}%` }} /></div>
          <ol className="checklist">
            {result.checklist.map((item, index) => (
              <li className={checked.includes(item.id) ? "is-checked" : ""} key={item.id}>
                <label>
                  <input checked={checked.includes(item.id)} onChange={() => toggleChecklist(item.id)} type="checkbox" />
                  <span className="check-box" aria-hidden="true" />
                  <span className="check-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="check-action"><strong>{item.action}</strong><small>{item.reason}</small>{item.officialSourceHint ? <small className="official-hint">Official source: {item.officialSourceHint}</small> : null}</span>
                  <span className="priority-label">P{item.priority}</span>
                </label>
              </li>
            ))}
          </ol>
        </section>

        <section className="draft-section" aria-labelledby="draft-title">
          <div className="section-title-row"><div><p className="micro-label">Ready to ask</p><h2 id="draft-title">Draft to the official</h2></div></div>
          <textarea aria-label="Editable email draft" onChange={(event) => setDraft(event.target.value)} value={draft} rows={10} />
          <div className="draft-actions"><button className="text-button" onClick={handleCopy} type="button">Copy</button><button className="run-button" onClick={handleMailto} type="button">Open in mail</button>{notice ? <span role="status">{notice}</span> : null}</div>
        </section>

        <details className="transparency-panel">
          <summary><span>Transparency</span><span className="micro-label">How to read this survey</span></summary>
          <p>{result.droppedClaimCount} AI statements removed because their quotes could not be verified in the source.</p>
          <p>Model used: {result.modelUsed}</p>
          <p>Generated: {new Date(result.generatedAt).toLocaleString()}</p>
          <strong>AI findings are potential signals. Verify with the official source.</strong>
        </details>
      </div>

      <SpecimenDrawer
        result={result}
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
        closeButtonRef={closeButtonRef}
      />
    </main>
  );
}
