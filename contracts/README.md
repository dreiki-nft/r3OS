# contracts

The contract package contains the canvas/frame core plus day-1 Lab contracts and renderers. Phase 7.5 is the final planned pre-mainnet source revision before the core is re-frozen for launch.

## Frontend boundary

The deployed/tested contract set is intentionally broader than the current r3OS interface. Direct UI for Flipbook, Weeds, Forks, Block DNA / Brushes, Sleepwalker, Lanes, Disk Defrag, PAGE.EXE, CARDMEM.EXE, Kernel Debugger and ROUTER.EXE is retired. Their contracts, ABIs, tests and historical readers remain where they preserve immutable history, deployed compatibility, recovery paths or active backend features. The active judge-facing UI boundary is documented in the root `README.md` and `docs/TECHNICAL.md`.

Do not delete or retire deployed contracts merely to mirror frontend cleanup.

## Core freeze

The already-deployed snapshot-28 testnet core is unchanged. Phase 7.5 reopens the fresh mainnet source only for the r3OS protocol-name migration and the bounded partner-holder bonus addition. After the Phase 7.5 Foundry/web/generated gate passes, `src/R3OSPaint.sol` is frozen again. Do not change it in Phase 8 unless a concrete launch-blocking bug is reported.

## Contracts

- `R3OSPaint.sol` — canvas, seasons, budgets, frames, storms, block-coinbase provenance, session keys, renderer registry, Lab registry, quest stats, region read API
- `R3OSPainterPass.sol` — ERC-5192-style soulbound painter credential with live stamps
- `R3OSLabs.sol` — shared ERC-721 + ERC-2981 collection for Reel, Fork, Dream and CD Lab tokens
- `renderers/DiffRenderer.sol` — per-season frame diff
- `renderers/SeasonTimelapseRenderer.sol` — finale timelapse, up to 4 sampled 128×128 frames
- `interfaces/IFrameRenderer.sol` — external renderer interface
- `interfaces/IR3OSPaintData.sol` — builder/read interface
- `interfaces/IStampSource.sol` — view-only Painter Pass stamp extension
- `interfaces/ILabTokenSource.sol` — source metadata/burn policy for the shared Labs collection
- `interfaces/ILabTokenNameSource.sol` — optional custom-name hook for immutable Lab token names
- `interfaces/IR3OSSleepwalkerCore.sol` — frozen-core session/write interface used only by Sleepwalker
- `labs/R3OSFlipbook.sol` — adminless 32×32 block-rate animation Lab and immutable reel NFTs
- `labs/R3OSWeeds.sol` — adminless 16-region toroidal Game of Life Lab over blank canvas soil
- `labs/R3OSForks.sol` — adminless 64×64 forked side canvases and lineage NFTs
- `labs/R3OSBrushes.sol` — adminless recent-block Block DNA catch / verify game
- `labs/R3OSFinaleAuction.sol` — adminless candle auction for season-finale NFTs
- `labs/R3OSQuests.sol` — append-only read-only condition quests and `QUESTS n` stamp
- `labs/SleepwalkerKey.sol` — deterministic EIP-1167 session-key implementation; clones accept only Sleepwalker calls
- `labs/R3OSSleepwalker.sol` — adminless overnight stencil cranker, Dream NFT source and `DREAMING DAYS n` stamp
- `labs/R3OSRecycleBin.sol` — adminless approved/safe-transfer frame burner, tombstones, top burners and `RECYCLER` stamp
- `labs/R3OSCDBurner.sol` — adminless 1–12-frame immutable mix CD-R snapshot/minter
- `lib/Source64.sol` — constant-cost 256×256 → 64×64 frame/outline source builder
- `lib/BmpN.sol` — generic small-square 24-bit BMP encoder; `Bmp64` remains its 64×64 wrapper
- `lib/BrushDNA.sol` — frozen Block DNA brush derivation and run encoder

## Build

```bash
npm ci
forge build --root contracts
node scripts/check-contract-sizes.mjs
forge test --root contracts -vv
npm run test:web
```

Compiler: Solidity 0.8.28, optimizer 200, via-IR. Foundry is pinned to v1.8.3 and tests run with `network = "monad"`, `hardfork = "monad:MonadTen"`. MIP-8 page storage is live and the storage layouts are page-aligned intentionally. The local size checker uses Monad's 131,072-byte runtime ceiling.

## Mainnet naming and holder budgets

The existing chain-10143 deployment remains historical compatibility: its deployed artifacts use `R3tards*` names and its Paint EIP-712 domain is `r3tards paint`, version `2`. Fresh Phase 7.5 source uses `R3OS*`, `r3OS paint`, `r3OS painter pass` and `r3OS labs`. Mainnet is a new deployment, so no storage migration or proxy upgrade is involved. The actual external r3tards NFT contract keeps its own name and remains the primary holder tier.

Historical `r3tards.*` strings used only as deterministic storage/hash derivation salts are retained intentionally. Renaming those would change protocol layout/derived keys without improving the public product identity.

Launch budget intent:

- base: 512 px/hour, +32 px/hour per active day, capped at 2,048 px/hour;
- r3tards: +512 px/day **per owned token id**, with spent quota stored by token id so transfer does not reset that token;
- Skrumpeys `0xb0dad798c80e40dd6b8e8545074c6a5b7b97d2c0`: +128 px/day **once per current-holder wallet** on chain 143;
- Monad Cards `0x0000CA12D5c07085022eBC74867157449919Fd67`: +128 px/day **once per current-holder wallet** on chain 143.

The two partner bonuses use a 50,000-gas-capped `balanceOf(owner)` static probe against fixed addresses, stack with each other, and fail closed if an external read fails. The transaction hot path skips both probes unless hourly + r3tards quota is insufficient. They preserve the existing Paint call shape: no partner token id is passed with a stroke. Because the Skrumpeys allowance is wallet/day rather than token/day, transferring a Skrumpey can make a different wallet eligible later that UTC day; the 128 px cap is deliberately small and this bonus is not a Sybil-resistance mechanism. See `../THREAT_MODEL.md`.

## Ownership

`R3OSPaint` uses OpenZeppelin `Ownable2Step`. The initial token #0 recipient is the initial owner. Core admin authority is deliberately narrow: future outlines, append/freeze renderer registry, add/retire Lab entries, and one-time official Painter Pass binding. There is no privileged pixel writer and no renderer-choice override.

`R3OSPainterPass` also uses `Ownable2Step`; its owner can append view-only stamp sources only.

`R3OSQuests` uses `Ownable2Step`; its owner may append new display-only quests but cannot edit, remove or revoke an existing quest or completion. The Finale Auction, Flipbook, Weeds, Forks, Brushes, Sleepwalker, Recycle Bin and CD Burner have no owner/admin. No Lab has special powers over the canvas; Sleepwalker only paints through a painter's own signed core session and normal budget.

## Deploy

Copy `contracts/.env.example` to `contracts/.env` and load the variables into your shell. No raw private key is read by the script.

Testnet with a Ledger:

```bash
cd contracts && FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_TESTNET_RPC_URL" --broadcast --verify --ledger
```

Or use a Foundry keystore:

```bash
cd contracts && FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_TESTNET_RPC_URL" --broadcast --verify --account <keystore-name>
```

The broadcaster must be `DEPLOYER_ADDRESS`. `TOKEN_ZERO_RECIPIENT`, `ROYALTY_RECEIVER` and `FINAL_OWNER` default to it and may be different addresses (token #0 is transferred and ownership handed over at the end). Mainnet chain ID 143 requires `CONFIRM_MAINNET=true` after testnet validation. Mainnet Launch Doctor also checks the core budget immutables plus the fixed Skrumpeys / Monad Cards addresses, code presence and 128 px/day constants. The script deploys Paint, the shared Labs collection, Painter Pass, three renderers, Flipbook, Weeds, Forks, Brushes, Finale Auction, Quests, the SleepwalkerKey implementation, Sleepwalker, Recycle Bin and CD Burner. It registers all three optional renderers, nine Lab experiments, seven display-only Lab stamp sources, and all thirteen day-one quests. Sleepwalker is registered after Quests so it is stamp source #6 (zero-based source index 5) and therefore Pass visual pin 11. Every deployment uses `vm.deployCode`, so the deployment script runtime does not embed every contract creation blob. Ownable contracts may later move to a hardware-wallet address through `Ownable2Step`; Sleepwalker and its key clones, Recycle Bin and CD Burner are adminless.

Before mainnet, verify on Monad testnet what `block.coinbase` represents. Frame metadata calls it `Sealed by`; the product copy must describe it as validator beneficiary only if testnet evidence supports that interpretation.

## Flipbook

`R3OSFlipbook` has no owner. Its 32-frame ring uses 128-slot-aligned storage pages; each new block may create one carried-forward frame and same-block paints edit that shared frame. Active core session keys resolve to their owner for painting, but cannot mint reels. Ink bounds Sybil scribbling per resolved wallet. Reels snapshot 8–32 frames into one FrameStore pointer and are immutable after mint. The first reel can mint at 8 frames; after that, 32 new frames are required, so reel windows partition Flipbook history without overlap.


Monad charges by submitted gas limit, including reverted transactions. Flipbook paints therefore use a fixed 240K production limit rather than `eth_estimateGas`; see `../docs/specs/GAS_LIMITS.md`. Other actions use measured estimates plus the documented headroom and are re-measured on testnet before launch.

The canonical genesis lives at `script/flipbook-genesis.hex`. `scripts/export-flipbook-genesis.mjs` can regenerate the default from the frozen core outline, but CI intentionally does not enforce regeneration because the artist may replace the 32×32 genesis by hand before deployment.

## Exact DF1 renderer

`DF1Renderer` ports the frozen DF1 v1 mulberry32 algorithm exactly and renders a 64×64 source fully onchain. Frames/finales use `df1Seed(tokenId)` and `max(100, frameInfo.df1Amount)`; token #0 uses the live `df1Seed(0)` and 200% only during storms. The source reconstructs background + that season's core-stored `genesisFrameData` through `Source64` before applying DF1, so raw outline-run count does not affect renderer cost and overlapping runs count once. `source64` and `df1Rgb64` are public verification views. Shared `FrameTraits` preserves the built-in frame traits when Diff, Timelapse or DF1 is selected.

64×64 is a gas-bound design choice, not a claim that DF1 itself is low resolution. The client can later render the same frozen algorithm at 256×256 as an explicitly labelled site preview.

## Weeds Lab

`R3OSWeeds` has no owner. Sixteen 64×64 toroidal Life worlds occupy separate 128-slot-aligned pages. `tick(region)` reads `regionBlankMask(currentSeason(), region)` from the frozen core, advances one B3/S23 generation and kills/bars cells outside that soil. `plant` places one of eight fixed 8×8 patterns with toroidal wrap and a 100-block per-resolved-owner cooldown. The Lab never writes the core.

`worldBitmap()` exposes the 256×256 one-bit overlay. `GARDENER` is a view-only Painter Pass stamp earned after five plants or twenty-five ticks.

Gas regression targets under Monad rules: DF1 renderer `<11M` on the default outline and `<13M` on a worst-case full custom outline; Weeds `tick <600k`, `plant <500k`, and `worldBitmap <1M`. Production transaction limits are still re-measured on testnet.


## Forks Lab

`R3OSForks` has no admin. `forkFrame` seeds one 64×64 page through `Source64.rows(frameData, genesisFrameData, face)`; `forkFork` copies a parent fork's current rows. Open forks are permissionless, closed forks are direct-NFT-owner paint surfaces, and sealing is permanent. Fork rows and stats are preconditioned to non-zero values to avoid repeated MIP-8 storage-growth charges.

Gas regression targets under Monad rules: `forkFrame <2.3M`, `forkFork <1.6M`, fork paint `<190k` for one-row 64 px and `<220k` for a 32-row/64-px pattern, including a `<230k` session-key/new-painter worst-case regression, `tokenURI <1M`, and `stamp <25k`. Fork runs must be sorted by non-decreasing row so each row is loaded/written once while preserving exact net-no-op detection. The measured worst case after that change is about 200K; production fork paint keeps a fixed 250K limit pending testnet measurement.

## Block DNA Brushes Lab

`R3OSBrushes` has no admin. `BrushDNA` derives a deterministic 8×8 brush from a recent block hash; the resolved owner can catch it into one of eight page-aligned slots, stamp it through ordinary core paint, and verify the filled cells against current-season `regionWords`. The Lab never writes core state. Brush placement must avoid the protected season outline because core paint intentionally skips those pixels. `BLOCK DNA` is earned after three lifetime successful verifications.

Gas regression targets: `catchBrush <160k`, one-region verify `<250k`, four-region verify `<400k`, and `stamp <20k`.

## Finale Candle Auction

`R3OSFinaleAuction` has no owner/admin. Finale owners approve and escrow a finale, then bidding remains open for 288,000 blocks. After close, the contract derives the real candle end from the closing block hash: native `blockhash` for 256 blocks, then Monad's EIP-2935 history contract for up to 8,191 blocks. Settling after that falls back to `candleStartBlock` (never a grindable later hash), which favours whoever led at the candle start, so the seller or a keeper (`scripts/auction-keeper.sh`) should settle within ~8,191 blocks of close. Winner selection is a binary search over historical standing bids. Deposits and seller/royalty proceeds use pull payments guarded by `ReentrancyGuard`; settlement transfers the NFT with `transferFrom`.

Regression targets: `list <300k`, each bid/top-up `<250k`, settlement with 43 bids `<350k`, and deposit withdrawal `<100k`.

## Quests Lab

`R3OSQuests` is append-only under `Ownable2Step`. Each quest contains one to four gas-capped static conditions that copy only one requested return word from a public view. Active core session keys claim for their resolved owner. Completion is stored once, allowing the Painter Pass to display `QUESTS n` with a cheap storage read. Quests grant no permissions or economic advantage. The deploy script installs thirteen day-one quests, with `RECYCLER` at id 12 reading the Bin's `burnedBy(address)` count.

Regression targets: a one-condition core claim `<160k`, a four-stamp condition claim `<250k`, and quest `stamp <25k`.


## Sleepwalker Lab

`R3OSSleepwalker` stores a maximum 4,096-pixel stencil in an SSTORE2-style `FrameStore` pointer and lazily deploys one CREATE2/EIP-1167 `SleepwalkerKey` per painter. The painter signs 1–4 ordinary core sessions for that predictable key. Permissionless `step(owner)` calls may then submit at most 64 stencil pixels through the active key, but only after the painter has independently crossed the core's human active-day threshold and only up to 2× the painter's non-Sleepwalker pixels for that UTC day.

Successful steps are paced by 100 blocks, spend the owner's normal core budget/session allowance, count exact `pixelsToday` deltas, and pay the configured MON tip only when the deposit covers it. `wake` deletes unused signatures and refunds the remaining deposit; the owner-wallet UI revokes the active core session before calling it. Dreams mint once through `R3OSLabs`, use an onchain cropped stencil SVG, and freeze survival from up to 128 evenly-spaced `pixelAt` samples. `DREAMING DAYS N` is the Pass stamp. See `../docs/specs/SLEEPWALKER.md`.

The cranker path uses a fixed 600K submitted gas limit pending Monad-testnet measurement.

## Recycle Bin Lab

`R3OSRecycleBin` has no admin and burns only through the frozen core's existing ERC-721 authorization path. `recycle(ids)` accepts 1–50 caller-owned frames with token/operator approval. A single frame can instead be dropped with `safeTransferFrom`; the receiver accepts the Paint collection only, snapshots its tombstone, burns it in the callback and credits the original owner. Active session keys are rejected.

The Bin records `burnedBy`, `totalBurned`, `lastBurnBlock`, per-frame tombstones and a stable top-10 burner table. Token #0 and finales deliberately reach the core and revert with its canonical non-burnable error. Core frame snapshots remain readable after an ordinary ERC-721 burn, but the Bin exposes its own cheap tombstone record for the UI. `RECYCLER` is earned at 100 burns and the same counter drives quest id 12. See `../docs/specs/RECYCLE_BIN.md`.

## CD Burner Lab

`R3OSCDBurner` has no admin. `burnCD` accepts 1–12 distinct caller-owned frames plus a 1–24-character Sharpie label, rejects token #0 and active session keys, and never transfers or burns the source frames. It snapshots every source id/season/flags/colours plus a sampled 32×32 4-bit thumbnail into one `FrameStore` pointer before minting through `R3OSLabs`. Finales are valid tracks.

The Labs token renders a 1000×1000 onchain CD-R with deterministic marker lettering and rim thumbnails. CD-specific traits include track count, format, season mix, storm/finale data and oldest track; common colour traits are aggregated from all thumbnails. The custom immutable name `r3OS labs cd #N: <label>` uses the optional `ILabTokenNameSource` hook. Regression targets are `<6M` for a 12-track mint and `<8M` for its Labs `tokenURI`. See `../docs/specs/CD_BURNER.md`.

## Deployment gas reference

`DeployGas.t.sol` covers each deployment and wiring transaction under the Monad Foundry profile, including the shared Labs collection, SleepwalkerKey implementation, Sleepwalker, Recycle Bin and CD Burner registration/binding, and seventh Pass stamp-source wiring. Every individual deployment/wiring transaction remains guarded by the existing 25M regression ceiling.

The pre-Labs/ pre-Sleepwalker aggregate numbers are intentionally not repeated here. Run the suite after assembly and treat its `GAS deploy ...` / `GAS wire ...` logs as the source of truth; the older aggregate does not include these contracts.
