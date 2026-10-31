Concept: "Field Survey". The app looks like a cartographer's survey sheet. Missing
information is "unsurveyed territory" (hatched). Evidence is a "specimen" shown as a
typewriter quote. The whole UI feels editorial, tactile and precise, not like a SaaS
dashboard.
Colors (CSS variables + Tailwind): paper #F3EEE4 (background), paper-deep #E9E2D3,
ink #14120F (text, borders), ink-soft #4A453C, rule #CFC6B2 (thin lines), signal #D6361F
(conflict, critical gap), amber #C98A12 (outdated), moss #2F5D46 (sourced/covered).
Optional "Night survey" toggle: invert to ink background with paper text, same accents.
Fonts: Fraunces (display and headlines, use opsz and a slight soft/wonk feel, big sizes),
Instrument Sans (body/UI), JetBrains Mono (quotes, URLs, dates, labels, small caps tags).
Shapes: 2px radius max. 1px ink borders. No soft drop shadows; use hard offset shadows
(4px 4px 0 ink) on hover or focus only. Background: paper with a faint dot-grid
(radial-gradient dots every 24px at 6% ink opacity).
Signature motif: a field of dots where some dots are "unlit" (hollow with dashed outline).
Reuse it in the hero art and loading states.
Label system (never rely on color alone):
- Sourced = moss tag with a solid dot icon, text "SOURCED"
- AI-inferred = dashed ink outline tag with a diamond icon, text "AI SIGNAL"
- Unknown = hatched tag with a hollow circle icon, text "UNKNOWN"
Heatmap cell language (used in the results page later): covered = ink dot inside a moss
square; missing = diagonal hatching with dashed signal border ("unsurveyed"); conflicting
= solid signal square with a not-equal glyph; outdated = amber square with a clock
icon. All icons are inline SVG, no emoji anywhere.
Motion: cells and cards reveal with a short staggered "scan" (left to right) animation;
respect prefers-reduced-motion.
FORBIDDEN: purple or blue gradients, glassmorphism, rounded-xl cards with soft shadows,
Inter/Roboto/Arial, emoji icons, chatbot bubbles, a centered hero with three feature
cards, generic stock illustrations.
Landing layout (asymmetric): left 60%: small mono tag "SURVEY NO. 001", a huge Fraunces
headline "Know what your sources aren't telling you.", one-sentence subcopy, and the
input as a "survey sheet" form (numbered fields: 01 Question, 02 Sources, with ruled
lines instead of boxy inputs). Right 40%: a static SVG illustration of a survey grid
with lit and unlit dots and a few hatched squares, plus small margin annotations in
mono ("renewal policy: not found in 5 sources", "deadline: sources disagree"). Below:
a 3-step "How a survey works" strip with thin rules (Collect, Cross-check, Verify next)
and a short honesty note: "BlindSpot flags potential gaps. It never replaces the
official source."
