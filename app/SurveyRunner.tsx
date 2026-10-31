"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { runPipeline, type PipelineProgress } from "@/lib/pipeline";

type SurveyURL = {
  id: number;
  value: string;
};

const dotCount = 9;
const unlitDots = new Set([3, 10, 11, 18, 27, 35, 44, 53, 61, 70, 76]);

type ProgressLog = PipelineProgress & { id: number };

function SurveyIllustration() {
  return (
    <svg
      className="survey-illustration"
      viewBox="0 0 390 360"
      role="img"
      aria-label="Survey grid showing mapped and unsurveyed points"
    >
      <defs>
        <pattern id="survey-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <path d="M0 0v7" stroke="#D6361F" strokeOpacity=".42" strokeWidth="1.2" />
        </pattern>
      </defs>
      <path d="M36 28h300v286H36z" fill="#F3EEE4" fillOpacity=".42" stroke="#CFC6B2" />
      <path d="M36 68h300M36 108h300M36 148h300M36 188h300M36 228h300M36 268h300M76 28v286M116 28v286M156 28v286M196 28v286M236 28v286M276 28v286M316 28v286" stroke="#CFC6B2" strokeOpacity=".48" strokeWidth=".7" />
      <rect x="76" y="108" width="38" height="38" fill="url(#survey-hatch)" stroke="#D6361F" strokeDasharray="3 3" />
      <rect x="236" y="188" width="38" height="38" fill="url(#survey-hatch)" stroke="#D6361F" strokeDasharray="3 3" />
      <rect x="276" y="68" width="38" height="38" fill="url(#survey-hatch)" stroke="#D6361F" strokeDasharray="3 3" />
      {Array.from({ length: dotCount * dotCount }, (_, index) => {
        const row = Math.floor(index / dotCount);
        const column = index % dotCount;
        const isUnlit = unlitDots.has(index);
        return (
          <circle
            key={index}
            cx={56 + column * 32}
            cy={48 + row * 32}
            r={isUnlit ? 4.2 : 3.2}
            fill={isUnlit ? "#F3EEE4" : "#2F5D46"}
            stroke={isUnlit ? "#4A453C" : "none"}
            strokeDasharray={isUnlit ? "2 2" : undefined}
            strokeWidth="1.2"
          />
        );
      })}
      <circle cx="196" cy="176" r="13" fill="none" stroke="#D6361F" strokeWidth="1.2" />
      <path d="M196 157v38M177 176h38" stroke="#D6361F" strokeWidth=".8" />
      <path d="M29 28h7M36 21v7M336 28h7M336 21v7M29 314h7M36 314v7M336 314h7M336 314v7" stroke="#14120F" strokeWidth="1.2" />
      <text x="37" y="337" fill="#4A453C" fontFamily="monospace" fontSize="8" letterSpacing="1.2">FIELD GRID / 09 × 09</text>
      <text x="274" y="337" fill="#4A453C" fontFamily="monospace" fontSize="8" letterSpacing="1.2">N 04° 12′</text>
    </svg>
  );
}

function SurveyingView({ logs }: { logs: ProgressLog[] }) {
  const completedSteps = logs.filter(
    (entry) => entry.done >= entry.total && entry.total > 0,
  ).length;
  const litCount = Math.min(81, completedSteps * 12 + logs.length);

  return (
    <main className="surveying-screen">
      <div className="surveying-inner">
        <p className="eyebrow">Survey no. 001 / In progress</p>
        <h1>Reading the field.</h1>
        <p className="surveying-intro">
          BlindSpot is collecting and cross-checking text. This can take a moment.
        </p>
        <div className="surveying-map" aria-hidden="true">
          {Array.from({ length: 81 }, (_, index) => (
            <span
              className={`surveying-dot ${index < litCount ? "is-lit" : ""} ${unlitDots.has(index) ? "is-hollow" : ""}`}
              key={index}
              style={{ animationDelay: `${index * 18}ms` }}
            />
          ))}
        </div>
        <div className="survey-log" aria-label="Survey progress log" role="log" aria-live="polite" aria-relevant="additions">
          {logs.length === 0 ? (
            <p className="log-line">Preparing the survey sheet…</p>
          ) : (
            logs.slice(-10).map((entry) => (
              <p
                className={`log-line ${entry.message.toLowerCase().includes("failed") || entry.message.toLowerCase().includes("error") ? "is-error" : ""}`}
                key={entry.id}
              >
                <span aria-hidden="true">/</span> {entry.message}
              </p>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

export default function SurveyRunner() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [urls, setUrls] = useState<SurveyURL[]>([{ id: 1, value: "" }]);
  const [nextUrlId, setNextUrlId] = useState(2);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<ProgressLog[]>([]);
  const [error, setError] = useState("");

  function addURL() {
    if (urls.length >= 8) return;
    setUrls((current) => [...current, { id: nextUrlId, value: "" }]);
    setNextUrlId((current) => current + 1);
  }

  function updateURL(id: number, value: string) {
    setUrls((current) =>
      current.map((source) => (source.id === id ? { ...source, value } : source)),
    );
  }

  function removeURL(id: number) {
    setUrls((current) => current.filter((source) => source.id !== id));
  }

  async function runSurvey() {
    setError("");
    const sources = urls.map((source) => source.value.trim()).filter(Boolean);
    if (!question.trim()) {
      setError("Add a research question before starting the survey.");
      return;
    }
    if (sources.length === 0) {
      setError("Add at least one source URL to survey.");
      return;
    }

    setIsRunning(true);
    setLogs([]);
    let logId = 0;
    try {
      const result = await runPipeline(question.trim(), sources, (progress) => {
        setLogs((current) => [
          ...current,
          { ...progress, id: logId++ },
        ]);
      });
      try {
        sessionStorage.setItem("blindspot:analysis", JSON.stringify(result));
      } catch {
        setError(
          "Survey completed, but this browser could not save the result. Check storage settings and try again.",
        );
        setIsRunning(false);
        return;
      }
      router.push("/results");
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "The survey could not be completed. Please try again.",
      );
      setIsRunning(false);
    }
  }

  if (isRunning) return <SurveyingView logs={logs} />;

  return (
    <main className="landing-main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Survey no. 001</p>
          <h1 id="hero-title">
            Know what your sources <span>aren&apos;t</span> telling you.
          </h1>
          <p className="hero-intro">
            Map the gaps, contradictions, and stale details across the sources
            you&apos;re relying on.
          </p>

          <form
            className="survey-form"
            id="survey"
            onSubmit={(event) => {
              event.preventDefault();
              void runSurvey();
            }}
          >
            <div className="survey-field">
              <label className="field-label" htmlFor="research-question">
                <strong>01</strong> Question
              </label>
              <textarea
                className="question-input"
                id="research-question"
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What are you trying to find out?"
                rows={2}
                value={question}
              />
            </div>

            <div className="survey-field">
              <span className="field-label" id="sources-label">
                <strong>02</strong> Sources
              </span>
              <div className="url-stack" aria-labelledby="sources-label">
                {urls.map((source, index) => (
                  <div className="url-row" key={source.id}>
                    <span className="url-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <input
                      aria-label={`Source URL ${index + 1}`}
                      className="url-input"
                      onChange={(event) => updateURL(source.id, event.target.value)}
                      placeholder="Paste a source URL"
                      type="url"
                      value={source.value}
                    />
                    {urls.length > 1 ? (
                      <button
                        aria-label={`Remove source ${index + 1}`}
                        className="remove-url"
                        onClick={() => removeURL(source.id)}
                        type="button"
                      >
                        <svg aria-hidden="true" fill="none" height="12" viewBox="0 0 12 12" width="12">
                          <path d="m2 2 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                      </button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                ))}
                <button
                  className="add-url"
                  disabled={urls.length >= 8}
                  onClick={addURL}
                  type="button"
                >
                  <span aria-hidden="true">+</span>
                  Add a source <span>({urls.length}/8)</span>
                </button>
              </div>
            </div>

            <div className="form-actions">
              <p className="source-limit">Up to 8 sources · signals are not guarantees</p>
              <button className="run-button" type="submit">
                Run survey
                <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
                  <path d="M2.5 8h10m-4-4 4 4-4 4" stroke="currentColor" strokeLinecap="square" strokeWidth="1.2" />
                </svg>
              </button>
              <Link className="demo-button" href="/results?demo=scholarship">
                Load demo (scholarship)
              </Link>
            </div>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </form>
        </div>

        <aside className="hero-art" aria-label="A sample survey map">
          <p className="margin-note note-one">
            <strong>renewal policy:</strong><br />not found in 5 sources
          </p>
          <SurveyIllustration />
          <p className="margin-note note-two">
            <strong>deadline:</strong><br />sources disagree
          </p>
          <span className="illustration-caption">Specimen map / sample only</span>
        </aside>
      </section>

      <section className="how-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="how-heading">
          <h2 id="how-heading">How a survey works</h2>
          <p>A clearer view starts with what you already have.</p>
        </div>
        <div className="steps">
          <article className="step">
            <span className="step-index">01 / Collect</span>
            <h3>Bring your sources</h3>
            <p>Start with a research question and the pages you want to examine.</p>
          </article>
          <article className="step">
            <span className="step-index">02 / Cross-check</span>
            <h3>Map the evidence</h3>
            <p>See where claims line up, conflict, go stale, or leave gaps.</p>
          </article>
          <article className="step">
            <span className="step-index">03 / Verify next</span>
            <h3>Choose what to check</h3>
            <p>Follow a prioritized list back to the evidence and official sources.</p>
          </article>
        </div>
        <div className="honesty-note">
          <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" />
            <path d="M8 7v4m0-6v.2" stroke="currentColor" strokeLinecap="round" />
          </svg>
          <p><strong>BlindSpot flags potential gaps.</strong> It never replaces the official source.</p>
        </div>
      </section>
    </main>
  );
}
