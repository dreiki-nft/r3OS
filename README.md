# Cleaned Sonnet useful-core patch

Applied against `latest repo.zip`.

Kept:
- structured overheat data from `previewPaintCost`;
- client-side cached heat decay using the core cooldown constant, with no extra RPC;
- human-readable approximate wait formatting using the observed block cadence and a 300 ms fallback;
- contextual Paint refusal copy for overheated strokes;
- factual `TileTooHot` / `RegionBusy` fallback errors;
- focused unit tests.

Rejected from the Sonnet patch:
- the always-visible Paint rules legend;
- all legend CSS/UI state;
- 400 ms fallback assumptions;
- duplicated cooldown tables in generic chain error handling;
- the claim that `RegionBusy` necessarily means too many people were painting.

Validation available in this environment:
- pure TypeScript compile for `cost.ts` and `explain.ts`: PASS;
- TypeScript syntax transpile for every changed TS/TSX file: PASS;
- direct pure-behavior checks for heat decay, overheat detail, fallback timing and explanation: PASS.

Full Vitest / Vite / project build were not run because this uploaded repo has no `node_modules` in the execution environment.
