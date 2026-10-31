# BlindSpot

BlindSpot is a free, no-database research survey tool for finding what a set of
sources may leave unresolved. It is built for a hackathon and does not require
paid APIs, accounts, or card signups to explore the precomputed demo.

## The problem

Research often depends on details spread across pages: deadlines, fees,
eligibility, exceptions, and official processes. A single summary can hide
contradictions, stale information, and questions no source answers.

## The solution

Enter a research question and up to eight URLs. BlindSpot builds a decision-
oriented evidence grid, surfaces potential gaps and conflicts, and creates a
prioritized list of details to verify. Every extracted claim must pass an exact
source-quote check before it can appear as evidence. Findings are potential
signals, not guaranteed facts.

## The five-step method

1. **Expectation schema** — identify the dimensions a decision-ready answer
   should address.
2. **Claim extraction** — inspect each source for claims about those dimensions.
3. **Quote verification** — discard claims whose quoted text cannot be found in
   the original source.
4. **Cross-check** — compare dates and numeric claims; flag possible semantic
   conflicts as AI signals.
5. **Verify next** — prioritize unresolved questions and draft a message to the
   relevant official body.

## Features

- HTML and PDF source fetching with metadata, source tiers, and SSRF protections.
- Coverage grid, evidence specimens, conflicts, gaps, outdated signals, and
  unanswered dimensions.
- Completeness fully credits only dimensions with verified evidence from an
  official, dated source; non-official or undated evidence earns half credit.
- Code extracts exact, quoted deadline dates from prose, tables, and lists for
  cross-source comparison, even when AI extraction omits a date.
- Quote-linked findings, a prioritized verification checklist, and an editable
  official inquiry draft.
- Markdown export, print-to-PDF, and locally saved checklist progress.
- Offline scholarship demo with sample evidence and precomputed analysis.

## Tech stack

Next.js App Router, TypeScript, Tailwind CSS, Gemini/Groq JSON APIs, Cheerio,
JSDOM, Mozilla Readability, pdf-parse, chrono-node, Fuse.js, and Zod. There is
no database; live results are kept in the current browser session.

## Setup

Use Node.js 22.6 or newer and npm.

```powershell
git clone <repository-url>
cd blindspot
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Live surveys need a
Gemini or Groq key in `.env.local`; add at least one key:

```dotenv
GEMINI_API_KEY=your-key
GROQ_API_KEY=your-key
```

Keys are server-side only. The app attempts Gemini first and falls back to Groq
if Gemini is unavailable or rate-limited.

## No-key demo

Choose **Load demo (scholarship)** on the landing page. It loads the committed,
precomputed sample report without contacting an AI provider. To regenerate the
sample, set provider credentials locally and run:

```powershell
npm run demo:build
```

The builder reads `demo/urls.json`, fetches the sources, and writes the report,
short source excerpts, and LLM cache. Review those public sample files before
committing regenerated data.

## Tests and deployment

Run the focused checks with `npm run test:verify`, `npm run test:normalize`,
`npm run test:analyze`, and `npm run test:cache`. Vercel functions are pinned to
the Mumbai region (`bom1`) and allow up to 60 seconds per API route. LLM cache
writes fall back to the system temporary directory if the project filesystem is
read-only.

## Limitations and responsible AI

Login-protected, JavaScript-heavy, blocked, or unusually large sources may not
load. Results reflect only text successfully fetched, and date metadata may be
absent. AI extraction and semantic signals can be wrong; quote verification
confirms that text appears in a source, not that the claim is true. Always check
important details against the relevant official source. BlindSpot is not legal,
financial, or eligibility advice.

## Project structure

- `app/` — landing page, results, method page, and API routes.
- `lib/` — source fetch, schema, extraction, quote verification, analysis, and
  pipeline logic.
- `scripts/` — focused test scripts and demo builder.
- `demo/` — URL configuration and precomputed scholarship sample.
- `DESIGN.md` — the Field Survey design system.
- `PROGRESS.md` — implementation checklist.

## Future scope

Browser extension; scheduled re-checks with change alerts; Hindi and regional
language sources; source-reliability learning; team workspaces.
