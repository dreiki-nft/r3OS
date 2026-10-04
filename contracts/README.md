# contracts

The Solidity package is the production contract surface for **r3OS**. Phase 7.6 removes experiments that are no longer part of the hackathon product from fresh-mainnet source, deployment wiring, generated ABIs and tests. Git history remains the archive; the existing snapshot-28 testnet deployment is not modified.

## Submission boundary

Fresh mainnet deploys only contracts that support the current r3OS experience. PAGE.EXE, CARD.DRV and Router Lab remain because active r3OS surfaces consume their backends. Historical experiment names can still appear in compatibility readers for the already-deployed testnet, but they are not part of the fresh mainnet deployment graph.

`R3OSOperatorRecord` intentionally keeps its v1 fixed-layout legacy fields so the frontend can still read existing testnet records. Fresh mainnet passes zero addresses for the retired source slots, making those probes inert.

## Core freeze

The snapshot-28 testnet core is unchanged. Phase 7.5 reopened fresh-mainnet source for the r3OS naming migration and bounded partner-holder bonuses. Phase 7.6 changes the **deployment surface**, not Paint semantics. `R3OSPaint.sol` remains launch-frozen unless a concrete blocking bug is found.

## Production contracts

- `R3OSPaint.sol` — shared canvas, seasons, budgets, frames, storms, session keys, renderer registry and experiment registry
- `R3OSPainterPass.sol` — soulbound participation credential with append-only view-only stamp sources
- `R3OSLabs.sol` — shared ERC-721 + ERC-2981 collection used by active Lab artifacts
- `renderers/DiffRenderer.sol` — per-season frame diff
- `renderers/SeasonTimelapseRenderer.sol` — finale timelapse
- `renderers/DF1Renderer.sol` — exact 64×64 DF1 renderer
- `labs/R3OSFinaleAuction.sol` — adminless candle auction for season finales
- `labs/R3OSQuests.sol` — append-only onchain achievements
- `labs/R3OSRecycleBin.sol` — frame recycling, tombstones, leaderboard and `RECYCLER` stamp
- `labs/R3OSCDBurner.sol` — immutable 1–12-frame mix-CD artifact minter
- `monadhw/R3OSPageExe.sol` — MIP-8 page benchmark + one real 4 KiB page per wallet
- `monadhw/R3OSBlockCamera.sol` — block/epoch/proposer-derived portrait artifacts minted through Labs
- `monadcard/R3OSCardMemory.sol` — CARD.DRV page storage for official Monad Cards
- `operator/R3OSOperatorRecord.sol` — public onchain activity record; v1 layout retained for testnet compatibility
- `operator/R3OSSystemEvent.sol` — one-way external-condition latch
- `router/R3OSRouterLab.sol` — read-only/reverting routing simulation backend used by Explore Monad

Shared libraries and interfaces live under `lib/` and `interfaces/`. `R3tardsPalette.sol` and historical `r3tards.*` derivation salts keep their names intentionally where changing them would alter protocol data rather than branding.

## Build

```bash
npm ci
forge build --root contracts
node scripts/check-contract-sizes.mjs
forge test --root contracts -vv
npm run test:web
```

Compiler: Solidity 0.8.28, optimizer 200, via-IR. Foundry is pinned to v1.8.3 and tests run with `network = "monad"`, `hardfork = "monad:MonadTen"`. MIP-8 storage layouts are 128-slot aligned intentionally. The local size checker enforces Monad's 131,072-byte runtime ceiling.

## Mainnet naming and holder budgets

The existing chain-10143 deployment is historical compatibility: its deployed artifacts use `R3tards*` names and Paint's EIP-712 domain is `r3tards paint`, version `2`. Fresh mainnet source uses `R3OS*`, `r3OS paint`, `r3OS painter pass` and `r3OS labs`. Mainnet is a new deployment, so no storage migration or proxy upgrade is involved.

Launch budget intent:

- base: 512 px/hour, +32 px/hour per active day, capped at 2,048 px/hour;
- r3tards: +512 px/day **per owned token id**, with spent quota stored by token id;
- Skrumpeys `0xB0DAD798C80e40Dd6b8E8545074C6a5B7B97D2c0`: +128 px/day **once per current-holder wallet** on chain 143;
- Monad Cards `0x0000CA12D5c07085022eBC74867157449919Fd67`: +128 px/day **once per current-holder wallet** on chain 143.

Partner checks use a 50,000-gas-capped `balanceOf(owner)` static probe with a fixed 32-byte return buffer. They fail closed and are skipped unless ordinary hourly + r3tards quota is insufficient. See `../THREAT_MODEL.md`.

## Ownership

`R3OSPaint`, `R3OSPainterPass` and `R3OSQuests` use `Ownable2Step`. Paint ownership is deliberately narrow: future outlines, append/freeze renderer registry, add/retire experiment entries, and one-time official Pass binding. There is no privileged pixel writer.

Painter Pass ownership can append view-only stamp sources only. Quests ownership can append display-only quests but cannot edit or revoke existing definitions/completions. Finale Auction, Recycle Bin, CD Burner, PAGE.EXE, Block Camera, CARD.DRV and Router Lab do not gain any Paint write privilege from registration.

## Canonical deployment

Copy `contracts/.env.example` to `contracts/.env` and load it into your shell. The scripts do not read a raw private key.

Ledger example:

```bash
cd contracts && FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_TESTNET_RPC_URL" --broadcast --verify --ledger
```

Keystore example:

```bash
cd contracts && FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_TESTNET_RPC_URL" --broadcast --verify --account <keystore-name>
```

The broadcaster must equal `DEPLOYER_ADDRESS`. `TOKEN_ZERO_RECIPIENT`, `ROYALTY_RECEIVER` and `FINAL_OWNER` default to it and may differ. Chain 143 requires `CONFIRM_MAINNET=true` after rehearsal.

The core script now deploys Paint, Labs, Painter Pass, three renderers, Finale Auction, Quests, Recycle Bin and CD Burner. It registers **4** core Lab experiments, **2** initial Pass stamp sources and **7** day-one quests. `DeployMonadCard.s.sol` later adds CARD.DRV, the `MONAD CARD` Pass stamp and the `CARD CARRIER` quest. `DeployMonadHW.s.sol` adds PAGE.EXE and Block Camera. `DeployOperator.s.sol` adds Operator Record/System Event with retired v1 source slots set to zero. Router Lab is deployed separately for Explore Monad.

Every deployment uses `vm.deployCode`, so script runtime does not embed all creation bytecode. `DeployGas.t.sol` guards each production deployment/wiring transaction under the existing 25M regression ceiling.

## Active Lab details

### Finale Candle Auction

Finale owners approve and escrow a finale; bidding stays open for the configured window. After close the contract resolves the hidden candle end from historical block data, using native `blockhash` first and EIP-2935 history when available. Deposits and seller/royalty proceeds use pull payments guarded by `ReentrancyGuard`. See `../docs/specs/AUCTION.md`.

### Quests

Each quest contains one to four gas-capped static conditions that copy only one requested return word. Active core session keys claim for their resolved owner. Completion is stored once and grants no token or economic advantage. Fresh mainnet starts with **7** quests; CARD.DRV adds `CARD CARRIER` later. See `../docs/specs/QUESTS.md`.

### Recycle Bin

`recycle(ids)` accepts 1–50 caller-owned frames with approval. A single frame can also be dropped by safe transfer. The Bin records tombstones, per-wallet totals and a stable top-10 table; token #0 and finales remain non-burnable through core rules. `RECYCLER` is earned at 100 burns. See `../docs/specs/RECYCLE_BIN.md`.

### CD Burner

`burnCD` accepts 1–12 distinct caller-owned frames plus a short label, snapshots compact source metadata and thumbnails, and mints one immutable Labs CD. Source frames are never burned or transferred. See `../docs/specs/CD_BURNER.md`.

## Monad-native backends

PAGE.EXE measures MIP-8 storage-page behavior and gives each wallet one aligned 4 KiB page. Benchmark writes run via `eth_call` and always revert with their measurement so nothing persists.

Block Camera captures inclusion-block context and creates deterministic Labs portraits. Proposer/epoch context is provenance and art input, not secure randomness.

CARD.DRV binds aligned page storage to official Monad Card ownership. Router Lab executes bounded quote frames only inside an outer reverting simulation, so approvals, funds and venue state cannot survive the call.

Before mainnet, use `docs/PRE_MAINNET_CHECKLIST.md` and Launch Doctor as the source of truth for chain-specific validation and deployment wiring.
