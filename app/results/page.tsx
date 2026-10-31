import { Suspense } from "react";
import ResultsExperience from "./results-experience";

async function ResultsContent({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;
  return <ResultsExperience demoMode={demo === "scholarship"} />;
}

function ResultsFallback() {
  return (
    <main className="results-loading" aria-label="Loading survey results">
      <div className="skeleton-line skeleton-line--short" />
      <div className="skeleton-line skeleton-line--large" />
      <div className="skeleton-grid">
        {Array.from({ length: 28 }, (_, index) => <span key={index} />)}
      </div>
      <p>Opening your field notes…</p>
    </main>
  );
}

export default function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  return (
    <Suspense fallback={<ResultsFallback />}>
      <ResultsContent searchParams={searchParams} />
    </Suspense>
  );
}
