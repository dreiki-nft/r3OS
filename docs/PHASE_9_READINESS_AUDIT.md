# Phase 9 readiness audit

Status: Phase 8 handoff reconciled against the uploaded repository before mainnet work.

## Phase 8 baseline reconciliation

The uploaded repository still has the Phase 8 structure expected by the handoff:

- 97 frontend test files are present.
- `src/torture/` contains 4 dedicated torture files / 15 test cases.
- the generated ABI surface exports 16 contract ABIs.
- `npm run outline:export` still produces 372 runs.
- `npm run repo:doctor` passes in the Phase 9 audit environment.

The audit environment could not restore the npm/Foundry toolchains from the network, so the full 439-test, TypeScript, Vite build and Foundry gates must be rerun in the normal local development environment before this patch is accepted. Phase 9 must not claim those gates are green from static inspection alone.

## Relevant Phase 9 modules

### Runtime / commitment path

- `src/chain/monadLogs.ts` — Monad commitment feed and transaction commitment instrumentation.
- `src/chain/txTrace.ts` — Proposed / Voted / Finalized timing state.
- `src/paint/canvasStore.ts` — low-latency Paint replay, canonical catch-up and canvas snapshot state.
- `src/chain/clients.ts` — public HTTP fallback, action RPC lane and WebSocket client.
- `src/chain/speculation.ts` — Phase 9 proposal-identity reconciliation tracker.

### Launch / deployment path

- `scripts/launch-doctor.mjs`
- `scripts/launch-doctor-lib.mjs`
- `contracts/script/Deploy.s.sol`
- `contracts/script/DeployMonadCard.s.sol`
- `contracts/script/DeployMonadHW.s.sol`
- `contracts/script/DeployOperator.s.sol`
- `contracts/script/DeployRouterLab.s.sol`

### Evidence / launch artifacts

- `scripts/flight-recorder.mjs`
- `scripts/flight-recorder-lib.mjs`
- `docs/MAINNET_INTEGRITY.md`
- `docs/MAINNET_DEPLOYMENT_TOPOLOGY.md`

## Architectural conflicts found

### 1. Critical reads were not pinned to Finalized

Before Phase 9, Launch Doctor used ordinary/default reads. On Monad, `latest` is the Proposed view, so a launch/admin certification based on default reads can certify speculative state. Phase 9 pins one finalized reference block and executes the launch checks at that block.

### 2. Paint reconciliation compared against a non-finalized head

The existing Paint repair loop had a useful overlap/reload mechanism, but it reconciled against the current head. That is not an authoritative repair target on Monad because the current head can be Proposed. Phase 9 reconciles the authoritative overlap against Finalized state, then replays the newer low-latency tail.

### 3. Proposal identity was absent from reconciliation state

A block number alone does not identify a speculative Monad proposal. Phase 9 tracks `(height, blockId)` commitment progress and treats finalization of a sibling proposal as a reconciliation trigger.

### 4. Paint log identity did not distinguish sibling proposals

The old de-duplication key was transaction hash + log index. Phase 9 prefers block hash + transaction hash + log index when block hash is available, preventing sibling proposal delivery from being conflated.

### 5. `monadLogs` parsing was too narrow

The decoder expected the historical/nested log shape. Current Monad subscription data exposes commitment metadata alongside log fields. The Phase 9 decoder accepts the current flat shape while retaining backward compatibility with the nested shape used by existing tests/providers.

## Missing tooling at Phase 9 entry

The Phase 8 repo did not yet have:

- a production-path Speculation Integrity Test;
- a block-id commitment tracker for Paint reconciliation;
- finalized-only Launch Doctor certification;
- a deterministic mainnet Flight Recorder/hash command;
- an explicit deployment topology recording the ownership-acceptance dependency between add-on scripts;
- a mainnet canary / split-brain guard (9D, intentionally not pulled into 9A);
- FastLane/browser-safety integration and Boot Packet work (9B, intentionally not pulled into 9A).

## Mainnet-dangerous assumptions

### Immutable Paint configuration

The following are constructor-time / immutable and must be human-reviewed before `Deploy.s.sol` is broadcast:

- r3tards collection address;
- `SEASON_START`;
- `BASE_PIXELS_PER_HOUR`;
- `PIXELS_PER_ACTIVE_DAY`;
- `MAX_PIXELS_PER_HOUR`;
- `MIN_PIXELS_FOR_ACTIVE_DAY`;
- `HOLDER_PIXELS_PER_DAY`;
- royalty receiver.

The fixed mainnet partner addresses/budgets in `R3OSPaint` must also be checked against live chain code before deployment acceptance.

### Ownership ordering

`Deploy.s.sol` initiates `Ownable2Step` transfers for Paint, Labs, Pass and Quests when `FINAL_OWNER != deployer`, but the deployer remains the active owner until the recipient calls `acceptOwnership()`.

`DeployMonadHW.s.sol` unconditionally calls owner-only `paint.addExperiment(...)`; unlike the Card, Operator and Router add-on scripts, it has no Safe-calldata fallback. Therefore **the final owner must not accept Paint ownership before Monad Hardware registration is complete**, unless this script is deliberately refactored first.

Because Block Camera stores `CARD_MEMORY` immutably, CARD.DRV should be deployed before Monad Hardware if Card integration is part of the mainnet launch.

### System Event is not the genesis marker

`R3OSSystemEvent` is a specific permanent MON/USD threshold latch. It has no generic bytes/hash/message field. It must not be overloaded as `R3OS_MAINNET_GENESIS`. Phase 9 uses the deterministic Flight Recorder hash as the launch marker unless a separate reviewed onchain mechanism is introduced later.

### Freeze operations remain separate

The experiment registry is intentionally left unfrozen by current launch policy. Renderer/experiment freezes are irreversible policy decisions and are not silently added by Phase 9A.

## Exact 9A patch scope

1. Decode and distribute Monad commitment notifications with proposal identity.
2. Track competing proposals by block height and `blockId`.
3. Trigger Paint repair when a different proposal at the same height finalizes.
4. Make the canonical Paint repair target Finalized, while preserving the newer speculative tail after repair.
5. Add `npm run test:speculation` covering divergent proposals, reordering, normal progression and duplicate finalization.
6. Pin Launch Doctor to one finalized block for all critical reads.
7. Add deterministic Flight Recorder generation and hashing without signing or RPC side effects.
8. Document the launch consistency policy and deployment/ownership ordering.

No contract deployment, ownership acceptance, freeze or genesis emission is performed by 9A.
