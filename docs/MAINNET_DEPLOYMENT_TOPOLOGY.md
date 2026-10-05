# Mainnet deployment topology

This is the Phase 9C deployment topology audit. It is **not authorization to broadcast transactions**.

Target chain: Monad Mainnet (`143`). Canonical application state remains onchain; the deployment tooling does not introduce a database or canonical offchain service.

## Approval boundary

Every production deployment script inherits `R3OSMainnetScript`.

- Foundry dry-run context is allowed without an approval flag.
- Actual chain-143 `--broadcast` / `--resume` requires `CONFIRM_MAINNET=true` in the executing shell.
- The reviewed manifest is permanently `PLAN_ONLY`; it cannot contain `confirmMainnet`.
- Ownership acceptance and renderer freeze have separate exact-step approval flags.
- Contract/Safe final owners receive target + calldata instead of being impersonated by `startBroadcast(address)`.

Secrets/private keys never belong in repository files or browser `VITE_` variables.

## Deployment order

### 0. Read-only preflight

Run the full local gate, generate the reviewed manifest and execute `npm run mainnet:preflight`. Preflight uses a Finalized block for dependency/oracle checks and verifies chain 143, partner/dependency code, System Event oracle shape/freshness, season lead and deployer balance.

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

On chain 143 the script additionally locks the official r3tards address, the reviewed Paint budgets and a future season start. If `FINAL_OWNER != deployer`, this stage starts the four Ownable2Step transfers but does not accept them.

### 2. CARD.DRV — `DeployMonadCard.s.sol`

Deploy `R3OSCardMemory`, then register it with Paint, Pass and Quests while the deployer is still owner. Mainnet requires the predecessor code/wiring/ownership to match.

This must precede Monad Hardware because `R3OSBlockCamera.CARD_MEMORY` is immutable.

### 3. Monad Hardware — `DeployMonadHW.s.sol`

Deploy and register:

- `R3OSPageExe`
- `R3OSBlockCamera`

Mainnet refuses a zero/missing Card Memory and verifies that Card Memory points to the official Monad Cards collection.

### 4. Operator / System Event — `DeployOperator.s.sol`

Resolve the already-registered launch sources, then deploy:

- `R3OSOperatorRecord`
- `R3OSSystemEvent`

Fresh mainnet refuses to construct Operator Record with missing quests, finale, recycle, Block Camera, PAGE.EXE or CARD.DRV sources. `MON_FEED_MAX_AGE` is mandatory and the feed identity is checked before deployment.

### 5. Router Lab — `DeployRouterLab.s.sol`

Deploy/register `R3OSRouterLab`. Test mock venues are forbidden on chain 143.

### 6. Pre-acceptance Finalized Launch Doctor

Verify bytecode, immutable wiring, current/pending ownership, exact registry surface, Pass sources, Card/Hardware/Operator/Router links, System Event config, schedule and freeze state.

### 7. Explicit ownership-acceptance gate — `AcceptOwnership.s.sol`

Only after every owner-dependent registration is complete. The helper refuses an incomplete/wrong registry before any acceptance action.

For an EOA final owner it can broadcast after the separate approval flag. For a Safe/contract final owner it outputs the four `acceptOwnership()` calls for the owner's normal execution path.

### 8. Optional renderer freeze — `FreezeRenderers.s.sol`

Renderer freeze is separately approved and optional. The experiment registry intentionally remains open under the reviewed Phase 9 launch policy.

### 9. Post-acceptance Finalized certification

Run Launch Doctor again. Final owner/freeze state must match the reviewed intent.

### 10. Phase 9D acceptance, Flight Recorder and genesis evidence

Independent-provider split-brain checks and the mainnet canary still have to pass in 9D. Only after that should the deterministic Flight Recorder hash be treated as the `R3OS_MAINNET_GENESIS` evidence marker.

`R3OSSystemEvent` is not a generic launch-marker registry and is not overloaded to store that hash.

## Dependency graph

```text
read-only Finalized preflight
          ↓
Core
  ├─ CARD.DRV
  │    └─ Monad Hardware (Block Camera captures CARD_MEMORY immutably)
  ├─ Monad Hardware
  ├─ Operator Record / System Event (requires core + Card + hardware entries)
  └─ Router Lab
          ↓
collect 16/16 addresses from Foundry broadcast artifacts
          ↓
pre-acceptance Finalized Launch Doctor
          ↓
FINAL_OWNER ownership acceptance
          ↓
optional renderer freeze
          ↓
post-acceptance Finalized Launch Doctor
          ↓
9D canary + provider split-brain acceptance
          ↓
Flight Recorder / R3OS_MAINNET_GENESIS evidence marker
```

## Machine-validated manifest

Generate from a reviewed local copy of `docs/MAINNET_DEPLOYMENT_INPUT.example.json`:

```bash
npm run mainnet:manifest -- --input docs/MAINNET_DEPLOYMENT_INPUT.local.json
```

Outputs:

- `artifacts/mainnet-deployment-manifest.json`
- `artifacts/mainnet-deployment-manifest.sha256`
- `artifacts/MAINNET_DEPLOYMENT_PLAN.md`

The generator rejects chain/partner/budget/freeze/RPC drift and any attempt to store `confirmMainnet` in the plan.

## Read-only preflight

```bash
RPC_URL=... npm run mainnet:preflight -- --input docs/MAINNET_DEPLOYMENT_INPUT.local.json
```

Outputs:

- `artifacts/mainnet-preflight.json`
- `artifacts/MAINNET_PREFLIGHT.txt`

The RPC URL is not recorded.

## Broadcast-derived address handoff

After every successful deployment stage:

```bash
npm run mainnet:collect-addresses
```

The collector reads only local Foundry chain-143 broadcast artifacts and produces public-address handoff files. It reports partial progress until all 16 production contracts are present and refuses conflicting addresses for the same contract name.

Full step-by-step procedure: `docs/PHASE_9C_MAINNET_DEPLOYMENT.md`.
