import Link from "next/link";

const method = [
  {
    index: "01",
    title: "Expectation schema",
    text: "A research question is mapped into the information dimensions a decision-ready answer may need to cover.",
  },
  {
    index: "02",
    title: "Claim extraction",
    text: "Each accessible source is checked independently for statements that address those dimensions.",
  },
  {
    index: "03",
    title: "Quote verification",
    text: "Claims are retained only when their quoted wording can be found in the fetched source text.",
  },
  {
    index: "04",
    title: "Cross-check",
    text: "Verified claims are compared for differences; older cycles, missing dates, and unaddressed dimensions are flagged.",
  },
  {
    index: "05",
    title: "Verify next",
    text: "A prioritized checklist points back to the evidence and suggests what to confirm with an official source.",
  },
];

export default function HowItWorksPage() {
  return (
    <main className="method-page">
      <header className="method-intro">
        <p className="eyebrow">Field method / 05 steps</p>
        <h1>From source text to a better next question.</h1>
        <p>BlindSpot is a research instrument, not a chatbot or a summarizer. It marks what the supplied sources do and do not appear to support.</p>
      </header>
      <section className="method-line" aria-label="Five steps in the survey method">
        {method.map((step) => (
          <article className="method-step" key={step.index}>
            <span className="method-node" aria-hidden="true">{step.index}</span>
            <div><p className="micro-label">Step {step.index}</p><h2>{step.title}</h2><p>{step.text}</p></div>
          </article>
        ))}
      </section>
      <section className="limitations-panel">
        <p className="micro-label">Read the field conditions</p>
        <h2>Limitations</h2>
        <ul>
          <li>Login-protected or JavaScript-heavy pages may not load.</li>
          <li>Results depend on the text that could be fetched and extracted from the supplied URLs.</li>
          <li>AI signals can be wrong, incomplete, or miss a relevant nuance.</li>
          <li>A quote being present is not proof that its claim is accurate or current.</li>
        </ul>
        <p>Use findings as leads for further checking. Before you act, confirm important requirements directly with the official source.</p>
        <Link className="run-button" href="/">Start a survey</Link>
      </section>
    </main>
  );
}
