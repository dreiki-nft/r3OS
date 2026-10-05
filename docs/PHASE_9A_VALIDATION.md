# Phase 9A validation record

This records what was actually verified while producing the Phase 9A integrity patch. It is deliberately not a substitute for the local full regression gate.

## Verified in the audit environment

- `node scripts/repo-doctor.mjs` — PASS.
- `node scripts/export-outline.mjs` — 372 runs; generated outline is unchanged from the Phase 8 upload.
- generated ABI source still exposes 16 contract ABI constants.
- static test inventory after the patch: 99 `*.test.ts` files.
- dedicated torture inventory remains 4 files / 15 lexical test cases.
- Node syntax checks pass for the modified/new `.mjs` tooling.
- TypeScript syntax transpilation passes for the modified/new `.ts` files.
- Flight Recorder deterministic smoke test — repeated runs over the same human-reviewed input produced byte-identical JSON and identical SHA-256 output.

## Not certified in this audit environment

The uploaded ZIP did not contain installed dependencies or Foundry build artifacts. Dependency restoration was unavailable in the sandbox, and `forge` is not installed there. Therefore the following gates were **not** truthfully rerun here:

```bash
npm run test:speculation
npm run test:torture
npm run test:web
npm run generated:check
npx tsc -b
npm run build
npm run contracts:build
npm run contracts:test
git diff --check
```

Run those commands in the normal local project environment before accepting/committing the patch. No dependency or package-lock change was made by Phase 9A, so no fresh `npm install` should be necessary in an already-working checkout.

## Acceptance rule

Do not describe the Phase 9A regression suite as green until the commands above pass locally. In particular, the historical Phase 8 `439/439` result remains the **pre-patch baseline**, not a claimed post-patch count.
