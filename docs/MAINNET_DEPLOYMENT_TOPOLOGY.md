# Mainnet deployment topology

This is the Phase 9A topology audit, not authorization to broadcast transactions.

## Chain and approval boundary

Target chain: Monad Mainnet (`143`).

All deployment, ownership-acceptance, freeze and canonical launch-marker transactions remain behind an explicit human approval gate. Environment values must be supplied locally; secrets/private keys never belong in repository files or browser `VITE_` variables.

## Safest current deployment order

### 0. Read-only preflight

Before broadcasting anything:

- run contract build/tests and frontend regression gates;
- lock constructor inputs and final admin addresses in the deployment manifest;
- confirm live code at the r3tards, Skrumpeys and Monad Cards partner addresses;
- confirm the MON/USD oracle and heartbeat before choosing `MON_FEED_MAX_AGE`;
- confirm the intended renderer/experiment freeze policy;
- record expected artifact/bytecode identities.

### 1. Core — `Deploy.s.sol`

Deploys and wires:

- `R3OSPaint`
- `R3OSLabs`
- `DiffRenderer`
- `SeasonTimelapseRenderer`
- `DF1Renderer`
- `R3OSPainterPass`
- `R3OSFinaleAuction`
- `R3OSQuests`
- `R3OSRecycleBin`
- `R3OSCDBurner`

It also configures core experiments, stamp sources and day-one quests.

If `FINAL_OWNER != deployer`, this script only **starts** the `Ownable2Step` transfers. Do not have `FINAL_OWNER` accept them yet.

### 2. CARD.DRV — `DeployMonadCard.s.sol`

Deploy `R3OSCardMemory`, then register it with Paint, Pass and Quests while the deployer is still owner. This step should precede Monad Hardware because `R3OSBlockCamera.CARD_MEMORY` is immutable.

### 3. Monad Hardware — `DeployMonadHW.s.sol`

Deploy:

- `R3OSPageExe`
- `R3OSBlockCamera`

Register both with Paint and bind Block Camera's experiment id.

**Ordering invariant:** the broadcaster must still be the active Paint owner. The current script has no Safe-calldata fallback for its owner-only registration calls.

### 4. Operator / System Event — `DeployOperator.s.sol`

Resolve the already-registered core/Card/hardware sources, then deploy:

- `R3OSOperatorRecord`
- `R3OSSystemEvent`

On mainnet `MON_FEED_MAX_AGE` must be supplied explicitly. The script verifies the feed description/decimals before deployment. If Paint ownership has already moved, the script can emit Safe calldata for registry insertion, but keeping all add-ons before ownership acceptance is simpler and more auditable.

### 5. Router Lab — `DeployRouterLab.s.sol`

Deploy `R3OSRouterLab` without test mocks on chain 143 and register it with Paint. This script can emit Safe calldata if needed, but the preferred launch order still completes registration before ownership acceptance.

### 6. Pre-acceptance Launch Doctor

Run Launch Doctor against Finalized state. Verify:

- chain id and one finalized anchor;
- bytecode presence;
- immutable wiring;
- current/pending owners;
- registry entries;
- Pass source capacity;
- Card / Hardware / Operator / Router links;
- System Event feed configuration;
- schedule and freeze policy.

Do not interpret a passing pre-acceptance doctor as final launch acceptance while ownership is still pending.

### 7. Explicit ownership-acceptance gate

Only after every owner-dependent add-on is complete and reviewed, obtain explicit approval for the intended final owner to call `acceptOwnership()` on:

- Paint
- Labs
- Painter Pass
- Quests

These are admin-state transitions, not routine deployment housekeeping.

### 8. Optional irreversible freezes

Renderer and/or experiment freeze actions, if chosen at all, require their own explicit approval after deployment verification. Current project policy intentionally leaves the experiment registry open.

### 9. Post-acceptance Finalized certification

Run Launch Doctor again from Finalized state and, in 9D, the independent-provider canary/split-brain checks. Verify the intended owner/freeze state rather than merely the pending state.

### 10. Flight Recorder and genesis evidence

Only after mainnet acceptance passes:

1. populate the Flight Recorder input from verified facts;
2. run `npm run flight:record -- --input <path>`;
3. retain `artifacts/mainnet-launch.json`, `.txt` and `.sha256`;
4. use the deterministic artifact hash as the `R3OS_MAINNET_GENESIS` evidence marker.

The existing `R3OSSystemEvent` contract is not a generic launch-marker registry and is not used to store this hash.

## Known dependency graph

```text
Core
  ├─ CARD.DRV
  │    └─ Monad Hardware (Block Camera captures CARD_MEMORY immutably)
  ├─ Monad Hardware
  ├─ Operator Record / System Event (resolves core + Card + hardware entries)
  └─ Router Lab
         ↓
all owner-dependent registration complete
         ↓
FINAL_OWNER acceptOwnership
         ↓
finalized launch certification
         ↓
Flight Recorder / R3OS_MAINNET_GENESIS evidence marker
```

## Machine-validated manifest

Phase 9A adds a fail-closed manifest generator so the final plan is derived from reviewed inputs instead of hand-edited prose:

```bash
npm run mainnet:manifest -- --input <reviewed-json>
```

Template: `docs/MAINNET_DEPLOYMENT_INPUT.example.json`. The checked-in template is intentionally non-executable (`reviewed=false`, `CONFIRM_MAINNET=false`, unresolved 9B RPC/WS values, no accepted oracle max-age); copy it to a local launch input and fill/review every field before the generator will pass.

Outputs:

- `artifacts/mainnet-deployment-manifest.json`
- `artifacts/mainnet-deployment-manifest.sha256`
- `artifacts/MAINNET_DEPLOYMENT_PLAN.md`

The generator rejects chain drift, partner-address drift, Paint-budget drift, an experiments-freeze policy that contradicts the reviewed launch policy, missing public RPC/WS configuration, and a missing `CONFIRM_MAINNET=true` intent. It never queries RPC or broadcasts anything.

The checked-in source test also asserts the safety-critical script facts behind the order: CARD.DRV constructs Card Memory before Hardware consumes that immutable address; Hardware directly calls owner-only Paint registry functions; and core ownership transfer remains `Ownable2Step`.
