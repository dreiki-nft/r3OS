# r3OS Mainnet Deployment Plan

> **PLAN ONLY. THIS FILE IS NOT AUTHORIZATION TO BROADCAST, ACCEPT OWNERSHIP, FREEZE, OR EMIT A CANONICAL GENESIS MARKER.**

Manifest schema: `r3os-mainnet-deployment/v2`
Human-reviewed input: **yes**
Approval state: **PLAN_ONLY**
Manifest SHA-256: `0x307580c4fc98f28cee605a5a5bd348f08a9f1eba71788bd26eaced86e0cf67f1`
Chain: Monad Mainnet (`143`)

## Reviewed launch identities

- Deployer / initial owner: `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`
- Final owner: `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`
- Token #0 recipient: `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`
- Royalty receiver: `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`
- r3tards: `0x200723A706de0013316E5cd8EBa2b3f53DD90c29`
- Skrumpeys: `0xB0DAD798C80e40Dd6b8E8545074C6a5B7B97D2c0`
- Monad Cards: `0x0000CA12D5c07085022eBC74867157449919Fd67`

## Paint launch configuration

- Season start: `1791284400` (2026-10-06T11:00:00.000Z)
- Base budget: `512` px/hour
- Active-day step: `32` px
- Hour cap: `2048` px/hour
- Active-day threshold: `16` px
- r3tards: +`512` px/day per owned token
- Skrumpeys: +`128` px/day per holder wallet
- Monad Cards: +`128` px/day per holder wallet
- EIP-712 mainnet target: `r3OS paint` / version `2`

## Public frontend RPC / WebSocket configuration

These values are browser-visible. No unrestricted secret may appear here.

- Read pool: `https://rpc.monad.xyz`, `https://rpc1.monad.xyz`
- Wallet/action RPC: `https://rpc.monad.xyz`
- WebSocket: `wss://rpc.monad.xyz`
- Explorer: `https://monadvision.com`
- Optional stateless FastLane accelerator: disabled

The FastLane Enterprise credential is never browser-visible. If configured, only the public Cloudflare Worker route appears here. Direct public Monad RPC remains the fallback/canonical browser path, and this manifest makes no RPC-tier transaction-priority claim.

## System Event configuration

- MON/USD feed: `0xBcD78f76005B7515837af6b50c7C52BCf73822fb`
- Trigger: `333` milli-USD
- Max age: `4200` seconds
- `MON_FEED_MAX_AGE` must be chosen from the live mainnet feed update policy/freshness immediately before deployment.

## Exact deployment sequence

| # | Step | Command/script | Creates / action | Approval class |
|---:|---|---|---|---|
| 0 | Preflight | `npm run mainnet:preflight` | Finalized dependency/oracle/season checks | READ ONLY |
| 1 | Core | `Deploy.s.sol:Deploy` | R3OSPaint, R3OSLabs, renderers, Pass, Finale, Quests, Recycle, CDBurner | **DEPLOYMENT** |
| 2 | CARD.DRV | `DeployMonadCard.s.sol:DeployMonadCard` | R3OSCardMemory + Paint/Pass/Quest registration | **DEPLOYMENT** |
| 3 | Monad Hardware | `DeployMonadHW.s.sol:DeployMonadHW` | R3OSPageExe + R3OSBlockCamera + owner-only Paint registration | **DEPLOYMENT** |
| 4 | Operator/System Event | `DeployOperator.s.sol:DeployOperator` | R3OSOperatorRecord + R3OSSystemEvent | **DEPLOYMENT** |
| 5 | Router Lab | `DeployRouterLab.s.sol:DeployRouterLab` | R3OSRouterLab | **DEPLOYMENT** |
| 6 | Pre-acceptance certification | `npm run launch:doctor` | Finalized, read-only checks | READ ONLY |
| 7 | Ownership acceptance | not required | `FINAL_OWNER == DEPLOYER`; ownership is already final | NOT APPLICABLE |
| 8 | Optional renderer freeze | `FreezeRenderers.s.sol:FreezeRenderers` | renderers only; experiments remain open | **IRREVERSIBLE FREEZE GATE** |
| 9 | Post-acceptance certification | `npm run launch:doctor` | Finalized acceptance state | READ ONLY |
| 10 | Flight Recorder | `npm run flight:record` | deterministic accepted launch artifact/hash | EVIDENCE ONLY |

### Ordering invariant that must not be violated

**No ownership handoff is scheduled for this manifest.** `FINAL_OWNER == DEPLOYER`, so keep the deployer as owner through every add-on registration and do not invoke `AcceptOwnership.s.sol`. CARD.DRV still precedes Hardware because Block Camera stores `CARD_MEMORY` immutably in its constructor.

## Constructor / immutable map

- `R3OSPaint`: (`0x200723A706de0013316E5cd8EBa2b3f53DD90c29`, seasonStart, `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`, `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`, 512, 32, 2048, 16, 512)
- `R3OSLabs`: (Paint, `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`)
- `DiffRenderer`: ()
- `SeasonTimelapseRenderer`: ()
- `DF1Renderer`: ()
- `R3OSPainterPass`: (Paint)
- `R3OSFinaleAuction`: (Paint)
- `R3OSQuests`: (Paint, seasonStart, `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA`)
- `R3OSRecycleBin`: (Paint)
- `R3OSCDBurner`: (Paint, Labs)
- `R3OSCardMemory`: (`0x0000CA12D5c07085022eBC74867157449919Fd67`)
- `R3OSPageExe`: ()
- `R3OSBlockCamera`: (Paint, Labs, CardMemory)
- `R3OSOperatorRecord`: sources resolved from the live reviewed Paint registry before any ownership handoff
- `R3OSSystemEvent`: (`0xBcD78f76005B7515837af6b50c7C52BCf73822fb`, 333, 4200)
- `R3OSRouterLab`: ()

## Registry / wiring intent

- Renderers: built-in, diff, season timelapse, df1.
- Experiments: finale auction, quests, recycle-bin, cd-burner, card-drv, page-exe, block-camera, operator-record, system-event, router-lab.
- Pass stamp sources: quests, recycle-bin, card-drv.
- Bound experiment ids: recycle-bin, cd-burner, block-camera.
- Mainnet must not contain the test-only `router-mock-venues` entry.

## Freeze intentions

- Renderers: **freeze-after-acceptance**
- Experiments: **keep-open**
- Any freeze transaction requires a separate explicit approval immediately before broadcast.

## Foundry environment contract

| Variable | Reviewed value | Note |
|---|---|---|
| `DEPLOYER_ADDRESS` | `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA` | must match the broadcasting account |
| `R3TARDS_ADDRESS` | `0x200723A706de0013316E5cd8EBa2b3f53DD90c29` | official collection |
| `SEASON_START` | `1791284400` |  |
| `TOKEN_ZERO_RECIPIENT` | `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA` |  |
| `ROYALTY_RECEIVER` | `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA` |  |
| `FINAL_OWNER` | `0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA` | same as deployer; no Ownable2Step acceptance transaction is required |
| `BASE_PIXELS_PER_HOUR` | `512` |  |
| `PIXELS_PER_ACTIVE_DAY` | `32` |  |
| `MAX_PIXELS_PER_HOUR` | `2048` |  |
| `MIN_PIXELS_FOR_ACTIVE_DAY` | `16` |  |
| `HOLDER_PIXELS_PER_DAY` | `512` |  |
| `LAB_BASE_URI` | blank |  |
| `CONFIRM_MAINNET` | **NOT STORED** | set `true` only in the shell at the exact approved `--broadcast` / `--resume` step |
| `MONAD_CARD_ADDRESS` | `0x0000CA12D5c07085022eBC74867157449919Fd67` |  |
| `MON_USD_FEED` | `0xBcD78f76005B7515837af6b50c7C52BCf73822fb` |  |
| `MON_PRICE_TRIGGER_MILLI_USD` | `333` |  |
| `MON_FEED_MAX_AGE` | `4200` | must be re-confirmed against live update policy/freshness |

Add-on scripts also require the addresses emitted by earlier steps (`PAINT_ADDRESS`, `PASS_ADDRESS`, `QUESTS_ADDRESS`, `LABS_ADDRESS`, `CARD_MEMORY_ADDRESS`). Populate them only from the reviewed deployment outputs.

## Verification / acceptance commands

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

# read-only preflight before approval/broadcast:
RPC_URL=... npm run mainnet:preflight -- --input <reviewed-json>

# dry-run scripts are allowed without CONFIRM_MAINNET because the guard checks Foundry context:
(cd contracts && FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" -vvvv)

# after each successful deployment stage, derive addresses from Foundry broadcast artifacts:
npm run mainnet:collect-addresses

# finalized deployment certification with a local RPC_URL and no secret on argv:
EXPECTED_CHAIN_ID=143 PAINT_ADDRESS=<paint> EXPECTED_OWNER=<finalOwner> npm run launch:doctor -- --json

# source-verification command shape (run per deployed contract; keep verification separate from signing):
forge verify-contract <address> <source-path:ContractName> --chain 143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --watch
# confirm each verified address on https://monadvision.com/ before final acceptance.
```

## Mandatory STOP gates

1. **STOP before the first mainnet deployment broadcast.** Human approval is required at that exact step. The stored manifest remains `PLAN_ONLY`; only then set `CONFIRM_MAINNET=true` in the executing shell.
2. **Ownership acceptance is not applicable for this manifest.** `FINAL_OWNER == DEPLOYER`; do not run `AcceptOwnership.s.sol`.
3. **STOP before any freeze.** A freeze is optional and irreversible.
4. **STOP before treating a Flight Recorder hash as canonical launch evidence.** Post-acceptance finalized certification and 9D split-brain/canary acceptance must pass first.

## Genesis evidence

The deterministic Flight Recorder SHA-256 is labeled `R3OS_MAINNET_GENESIS`. `R3OSSystemEvent` is not a generic hash registry and must not be overloaded to store the marker.
