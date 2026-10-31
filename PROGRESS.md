# BlindSpot project progress

## Foundation
- [x] Create the Next.js App Router project with TypeScript and Tailwind CSS.
- [x] Install the requested source-analysis and validation packages.
- [x] Add design system, environment example, and local cache ignore rules.
- [x] Define shared analysis result types.
- [x] Implement Gemini-first/Groq-fallback JSON LLM calls and disk caching.
- [x] Add the LLM health-check endpoint.

## Product surfaces
- [x] Add the Field Survey design tokens, fonts, shared header, and footer.
- [x] Build the responsive landing page and interactive survey-sheet form.
- [x] Fetch and parse HTML/PDF sources with metadata, capped text, and SSRF checks.
- [x] Generate research dimensions with a scholarship fallback.
- [x] Extract and normalize source claims; verify quotes and count dropped claims.
- [x] Build an evidence matrix and identify typed conflicts, outdated claims, gaps, and unanswered dimensions.
- [x] Score coverage by dimension importance and apply unresolved-conflict penalties.
- [x] Add a report endpoint for optional semantic checking, prioritized next steps, and a cautious email draft.
- [x] Add the browser-callable schema → parallel fetch → sequential extraction → analysis → report pipeline with partial-failure handling.
- [x] Wire the landing survey form to the pipeline with full-screen progress and session result storage.
- [x] Build the responsive evidence grid, specimen drawer, ledger, checklist, email draft, transparency, and export/print results experience.
- [x] Add the five-step method and limitations page.
- [x] Persist checklist progress locally and add empty, loading, error, and reduced-motion states.
- [x] Run a complete real-source survey using the three user-provided NSP URLs.
- [ ] Add durable result persistence and remaining product polish.

## Pipeline verification
- [x] Add and run plain Node quote-verification and value-normalization scripts.
- [x] Add fixture-based analysis engine tests, including conflicts, an old cycle, and a dimension missing everywhere.
- [x] Pass lint, TypeScript, and production build checks with the pipeline routes.

## Real-source survey
- [x] Fetch all three supplied NSP sources directly, including PDF text extraction from the official scholarship notice.
- [x] Complete a live survey for the 2026-27 application question: 2 exact quotes verified, 24 unverified AI claims dropped, 9 gaps flagged, and 9 verification steps produced.
- [x] Update provider model defaults to currently available free-tier models and bound provider requests so overloaded models fall back instead of stalling the survey.

## Demo and resilience
- [x] Add a reproducible demo builder for the supplied scholarship sources, retaining short excerpts and a precomputed analysis.
- [x] Serve the precomputed demo without contacting an AI provider and add the landing-page demo link and dated banner.
- [x] Limit live runs to eight sources, bound them to 45 seconds, preserve partial results, and surface provider fallback and source errors.
- [x] Use a Vercel-writable temporary cache directory for live LLM calls.
- [x] Replace the starter README with setup, no-key demo, method, limitations, and project documentation.
- [x] Review secrets, lint findings, results accessibility, and the responsive demo experience.

## Final validation
- [x] Pass quote-verification, value-normalization, and analysis fixture tests.
- [x] Pass ESLint and TypeScript checks.
- [x] Pass the production build and verify the precomputed demo API and results page from the built server.
- [x] Verify the production demo at 375px, including grid scrolling, keyboard-opened specimen drawer, Escape close, and focus restoration.

## Scoring and deployment hardening
- [x] Give full importance-weighted coverage only to verified claims from official, dated sources; give half credit to non-official and/or undated evidence.
- [x] Deterministically extract exact quoted deadlines from prose, tables, and lists and compare them across sources, preserving both quotes and conflicting cells.
- [x] Retry failed LLM cache writes in the system temporary directory and read from that fallback cache.
- [x] Set a 60-second maximum duration on every API route and configure Vercel for `bom1`.
- [x] Rebuild the offline scholarship demo with current scoring and deadline extraction, sanitizing malformed surrogate characters in generated JSON.
- [x] Verify deadline comparisons ignore unrelated dates while preserving the cross-source application-deadline discrepancy.
- [x] Re-run quote-verification, normalization, analysis, cache-fallback tests, lint, and TypeScript checks.
- [x] Complete a fresh production build with the regenerated offline demo.
