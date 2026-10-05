# Phase 9A validation record

This file separates proven checkpoints from work that still needs a fresh local regression run. Humans do love turning old green checkmarks into eternal truths; this document does not.

## User-local validation: first 9A integrity checkpoint

After the speculation/finalized-reconciliation patch, the user's normal Windows checkout verified:

- `npm run test:speculation` — 3/3 files, 18/18 tests;
- `npm run test:torture` — 4/4 files, 15/15 tests;
- `npm run repo:doctor` — PASS;
- `npm run test:web` — 99/99 files, 449/449 tests;
- generated outline — 372 runs;
- generated ABI export — 16 contract ABIs;
- TypeScript + Vite production build — PASS;
- Foundry build / contract-size gate — PASS;
- Foundry tests — 241 passed, 0 failed, 3 environment-dependent fork tests skipped;
- `git diff --check` — PASS.

That proves the first 9A checkpoint preserved the Phase 8 regression baseline while adding speculation-integrity coverage.

## Current completion patch: audit-environment checks

This follow-on 9A completion patch adds the machine-validated mainnet manifest, structured Launch Doctor evidence, local acceptance-gate capture and stricter Flight Recorder assembly.

Verified while producing this patch:

- Node syntax checks pass for every `scripts/*.mjs` file;
- Node TypeScript syntax stripping accepts the modified/new test files;
- mainnet manifest validation/hashing smoke test — PASS;
- manifest human-review guard (`reviewed=true`) — PASS;
- local acceptance-gate schema/green-state smoke test — PASS;
- Launch Doctor structured-evidence smoke test — PASS;
- Flight Recorder assembly/validation/deterministic hash smoke test — PASS;
- `git diff --no-index --check` against the accepted first-9A tree — PASS.

## Fresh local gate required for this completion patch

The completion patch changes test/tooling files after the 449/449 run above, so those earlier counts must not be reused as post-patch proof.

Run:

```bash
npm run test:speculation
npm run test:torture
npm run repo:doctor
npm run test:web
npm run generated:check
npx tsc -b
npm run build
npm run contracts:build
npm run contracts:test
git diff --check
```

Then optionally capture the same gates as launch evidence with:

```bash
npm run launch:gates
```

No dependency or package-lock change is part of this patch, so an already-working checkout should not need `npm install`.
