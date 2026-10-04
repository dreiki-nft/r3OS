# r3OS: technical reference

> an operating system for the world computer.
>
> paint monad. pay gas. try not to ruin it.

r3OS is a Windows 98-style onchain computer whose signature app is a shared 256×256 fully onchain canvas and frame collection. The contract is designed around Monad's page storage and parallel execution: the canvas is split into **16 independent 64×64 regions**, so it behaves like a living canvas running as 16 parallel worlds. The accurate claim is that this is **one of the first apps designed for Monad's page storage and parallel execution**. Onchain canvases and onchain Game of Life systems exist elsewhere; this project does not claim otherwise.

The r3OS 98 frontend lives in `src/os`, `src/paint`, `src/pass` and `src/chain`.

The product/interface name is **r3OS**. Existing deployed testnet contracts and protocol-bound EIP-712 metadata retain `R3tards*` / `r3tards paint` identifiers for compatibility; those names are not being rewritten as part of the frontend rebrand.

## Core freeze

`contracts/src/R3tardsPaint.sol` is frozen as of the verified 2b-fix2 build. New experiments plug in through the Lab registry, renderer registry, Painter Pass stamp sources, public views and events. Later phases do **not** modify the core unless a concrete core bug is reported. This keeps the day-1 canvas contract immutable while Labs remain disposable and replaceable.

## Current UI boundary (2026-10-03)

The production r3OS interface intentionally does **not** expose every experiment built during development. Flipbook, Weeds, Forks, Block DNA, Sleepwalker, Lanes, Disk Defragmenter, PAGE.EXE, CARDMEM.EXE, Kernel Debugger and ROUTER.EXE are retired UI surfaces. Their contracts and historical data remain documented because deployed state is immutable and a few active features still read specific backend experiments. The retired React programs themselves are removed from the production program registry and bundle; `src/os/retired.ts` remains the shared policy for hiding retired quests, Pass stamps and Operator subsystems.

Two backend dependencies are deliberate: **Explore Monad → Storage race** reads the PAGE.EXE experiment, and **Explore Monad → Liquidity race** reads Router Lab. CARD.DRV also remains an active backend for Monad Card / Block Camera integration. UI retirement is not contract retirement.

## Contracts

### `R3tardsPaint`

- transferable token #0 = the live canvas; never burnable
- 30-day seasons from constructor `SEASON_START`
- 4-bit packed 256×256 background canvases in 128-slot-aligned storage pages
- 16 region-local state pages designed to avoid write conflicts between unrelated paints
- default r3tard outline plus optional future-season collaboration outlines
- black/white face toggle using palette indexes 1 / 7
- background trait colors through BMP palette entry 0
- hourly address budgets + per-r3tard-token holder quota
- epoch wet-paint protection, tile heat, and per-region block caps
- hand-off-pressure DF1 corruption plus deterministic DF1 storms
- exact-replay `Painted` events
- immutable background-only frame blobs, recomposited with each frame season's own outline
- block provenance: every frame/finale records `block.coinbase` as `proposer`; the UI does not claim this is a verified validator identity
- season finales routed to whoever owns token #0 when the finale is minted
- built-in onchain BMP → SVG → JSON renderer
- append-only optional renderer registry with holder opt-in and fallback
- EIP-712 session keys for paint-only live mode
- display-only Lab experiment registry
- quest-oriented per-address painter stats
- Lab read API for 64×64 region words and blank masks
- ERC-2981 royalties at 5%
- OpenZeppelin `Ownable2Step` administration

### `R3tardsLabs`

The single tradeable ERC-721 collection for token-producing Labs. Flipbook reels, Forks, Sleepwalker dreams and mix CD-Rs mint here; future token Labs join the same contract. Labs are authorized only through active entries in the core experiment registry. Token IDs are global across Labs, royalties are fixed at 5% to the immutable receiver, and the collection owner can only set its marketplace external link. See `docs/specs/LABS_NFT.md`.

### `R3tardsPainterPass`

A separate ERC-721 + ERC-5192-style soulbound pass. One lifetime claim per address after at least one successful paint. Owners may burn their pass; burning does not make the address eligible to claim a second one. Active session keys cannot claim. The pass grants no advantages.

Its generative onchain `r3 pass` image and metadata derive live art/stamps from core stats:

- First paint
- First frame
- Live painter: at least 10 session paints
- Storm chaser: at least one storm paint
- Regular: at least 7 active days
- Holder: currently owns at least one r3tard

The Pass owner can append view-only `IStampSource` contracts for future Lab badges. These sources are presentation-only, are gas-capped when read, and grant no Paint or Pass permissions.

**Visual pins are scarce.** `PassArt.MAX_PINS` is 16 and only pins below it are drawn. The six built-ins take pins 0–5 and stamp source *i* takes pin `6 + i`. The deployment adds seven Lab sources (Flipbook, Weeds, Forks, Brushes, Quests, Sleepwalker, Recycle Bin) and CARD.DRV adds an eighth, so **14 of 16 visual pins are used and 2 remain**. Policy:

- pins 14 and 15 are deliberately **reserved**; no generic experiment gets a visual pin by default;
- ROUTER and DXDIAG get no pin;
- `addStampSource` still accepts further sources, but once the visual capacity is used they become **metadata-only** (the stamp appears in the token's attributes, not in the art). Metadata-only sources are allowed when justified;
- assigning either reserved visual pin requires an explicit, documented design decision.

The Launch Doctor reports the live count (built-ins, external sources, pins used and remaining, metadata-only overflow).

### Experimental renderers

- `DiffRenderer`: highlights changed pixels relative to the previous frame record in the same season. The first frame diffs against that season's genesis state; a finale diffs against the last regular frame.
- `SeasonTimelapseRenderer`: finale-only animated SVG, sampling at most **4** records from that finale's season, downsampled to 128×128. Every sampled frame uses that season's own outline.
- `DF1Renderer`: exact DF1 v1 (mulberry32) rendered fully onchain at 64×64, using the frame's frozen DF1 seed/amount and that season's own outline. Calm frames render canonical 100%; storm frames render at 200%.


### `R3tardsFlipbook` Lab (contract/history; UI retired)

A separate 32×32 block-rate animation canvas. The first successful Flipbook paint in a new Monad block copies the previous frame and starts a new frame; later paints in that same block edit the shared frame. At Monad's 300 ms block target, chain time itself becomes roughly 3.3 fps stop-motion.

- no owner and no admin functions; a broken Lab is replaced with a new deployment and the old registry entry can be retired
- 32-frame ring stored in aligned pages, prefilled at deploy so first-use paints update existing slots instead of paying launch-day zero-to-nonzero storage growth
- one paint per resolved owner per block
- 64 ink per 200-block window for new wallets; 256 permanently after at least one successful core paint
- active core session keys can paint the Flipbook and activity is credited to the session owner, but active session keys cannot mint reels
- reels snapshot 8–32 frames into one immutable FrameStore blob and mint through the shared `R3tardsLabs` ERC-721; after the first reel, 32 new frames are required so reel windows do not overlap
- reel ownership and the fixed 5% royalty live in `R3tardsLabs`; Flipbook itself is not an ERC-721
- reel animation timing follows actual block gaps, clamped to 1–8 ticks, with a four-tick final hold
- implements `IStampSource`: `FLIPBOOK` is earned after painting 10 distinct Flipbook frames

Flipbook paints in the same block intentionally share the current frame slots, so they collide with one another. Flipbook storage never overlaps the core canvas storage, so Flipbook and canvas paints do not conflict by storage layout. The Lanes engine visualizes that distinction as an estimate; Monad's executor determines the real schedule.

### `R3tardsWeeds` Lab (contract/history; UI retired)

A separate adminless Conway's Game of Life experiment over the empty parts of the live canvas. Each of the 16 canvas regions has an independent 64×64 toroidal world stored in its own 128-slot-aligned page. Cells can live only where `regionBlankMask(currentSeason, region)` says the canvas is blank and not covered by that season's outline.

- anyone can `tick(region)` once per region per block
- anyone can `plant(region, x, y, pattern)` from eight fixed 8×8 Life patterns, subject to a 100-block per-owner cooldown
- active core session keys resolve to their owner for gardening stats
- `worldBitmap()` exposes the complete 256×256 one-bit overlay for the site
- the Lab has **no owner and no admin functions**
- implements `IStampSource`: `GARDENER` is earned after 5 plants or 25 ticks

Weeds reads the core's current-season soil but never writes the core. Region-world writes are page-local, so different regions are designed to avoid storage conflicts; the per-address gardening statistic is separate account state. A Weeds tick and a canvas paint in the same region may conflict because the tick reads canvas soil that the paint writes.

### `R3tardsForks` Lab (contract/history; UI retired)

A separate adminless 64×64 side-canvas system seeded from any saved frame or finale. Forks can themselves be forked, so lineage is recorded onchain without giving the Lab any power over the frozen core.

- creators must have painted the core at least once; active session keys cannot mint fork NFTs
- every fork owns one 128-slot-aligned page and starts open
- open forks are public; closed forks are NFT-owner-only; sealed forks are permanently immutable
- up to 64 submitted pixels per paint and 256 submitted pixels per fork per block
- active session keys can paint a fork for their resolved owner
- fork rows are XOR-encoded so blank rows are non-zero storage
- fork ownership and the fixed 5% royalty live in the shared `R3tardsLabs` ERC-721; Forks itself is not an ERC-721
- implements `IStampSource`: `FORKER` is earned after painting three distinct forks

Fork rendering is fully onchain. Source frames are downsampled through the shared constant-cost `Source64` library, so guest-outline run count does not affect seeding cost. Fork `paint` uses a fixed 250K production gas limit rather than `eth_estimateGas`; runs are sorted by row and the measured worst case after that optimization is about 200K. See `docs/specs/GAS_LIMITS.md`.

### `R3tardsSleepwalker` Lab (contract/history; UI retired)

Sleepwalker turns a pending Paint drawing into a 4,096-pixel-max stencil that other players can crank onto the real canvas overnight. It has no admin and no privileged write path. Each painter gets a deterministic EIP-1167 `SleepwalkerKey`; the painter pre-signs 1–4 normal core sessions for that key, and every successful step is an ordinary core `paint` charged to the painter's own budget.

- the owner must already have enough non-Sleepwalker pixels today to satisfy `MIN_PIXELS_FOR_ACTIVE_DAY`; dream paint can never create the active day
- every human pixel today earns two dream pixels, with a 64-pixel maximum per successful step and at least 100 blocks between successful steps
- stale stored session nonces are skipped if ordinary Live Mode consumed them
- permissionless crankers earn the configured MON tip only after a successful core paint
- `wake()` deletes unused signatures and refunds the remaining deposit; the owner-wallet UI revokes the active core session first
- completed or pre-wake dreams can mint once through `R3tardsLabs`, with onchain stencil art and survival sampled from up to 128 canvas pixels at mint
- implements `IStampSource`: `DREAMING DAYS N` is earned after the first UTC day with a successful dream paint

No Lab has special powers over the canvas; Sleepwalker only paints through your own signed session, with your own budget. See `docs/specs/SLEEPWALKER.md`.

### `R3tardsBrushes` Lab (contract/history; UI retired)

An adminless Block DNA game. Every recent Monad block deterministically defines an 8×8 mirror-symmetric brush from its block hash. Users catch a brush into an eight-slot box, stamp it using ordinary core paint runs, then verify that its filled cells are still present on the current-season canvas.

- catch window: the previous 256 blocks
- one catch per resolved owner per block; active session keys resolve to their owner
- boxes use one aligned storage page per owner
- stamping spends ordinary core paint budget and is subject to DF1/storm corruption
- verification reads at most four canvas regions through `regionWords` and never writes the core
- overwriting a box slot clears that slot's current verified bit but lifetime verified count never decreases
- implements `IStampSource`: `BLOCK DNA` is earned after three successful verifications

Brushes are not NFTs and the contract has no owner or funds. The stamp UI must reject placements whose filled cells overlap the protected season outline: core paint never lands under that outline, so those brush cells could never verify. Phase 5 verifies recent `blockhash(n)` values against Monad RPC block hashes and confirms the effective 256-block catch window on testnet.

### `R3tardsFinaleAuction` Lab

An adminless candle auction for season-final NFT snapshots. A listing bids for 288,000 blocks, but the effective end is drawn after close from one of the final 12,000 blocks. Bids after the drawn candle end stay refundable and do not determine the winner.

- any finale owner may list after approving the auction contract
- bids use cumulative top-ups and require a 5% minimum raise, rounded up
- deposits stay locked until settlement because any historical bid may become the winner
- settlement is permissionless; settling within 256 blocks of close uses the close-block hash, while late settlement deliberately falls back to the public close block
- seller proceeds and ERC-2981 royalties use pull-payment credits
- token transfers use `transferFrom`, not safe callbacks
- the contract has no owner or admin

### `R3tardsQuests` Lab

An append-only onboarding quest board. Each quest has one to four gas-capped read-only conditions against the core or a Lab. Claims record completion once, then the Painter Pass can show a cheap `QUESTS n` badge instead of re-running a pile of cross-contract checks on every metadata request.

- quest ids are append-only and capped at 256
- the `Ownable2Step` owner may add quests but can never edit, remove, revoke, or mark one completed
- active session keys may claim for their resolved owner
- conditions copy only one requested return word and are gas-capped
- quests grant no canvas, NFT, budget, auction, or Lab authority
- day one deploys 13 quests spanning core painting, storms/live mode, Flipbook, Weeds, Forks, Brushes, auction bidding and 100-frame recycling

### `R3tardsRecycleBin` Lab

An adminless graveyard for ordinary saved frames. `recycle(ids)` burns 1–50 caller-owned frames through the frozen core after ordinary ERC-721 token/operator approval; a single frame can instead be dropped with `safeTransferFrom` and burned in the receiver callback without a prior approval. Token #0 and finales remain non-burnable under the core's own rules, and active session keys cannot recycle.

The Bin records lifetime counts, last burn block, an onchain stable top 10 and a compact tombstone (minter, season, saved-frame block, storm) before each burn. The core's immutable frame snapshot remains readable after an ERC-721 burn, but the Bin tombstone is the purpose-built UI record. `RECYCLER` is earned at 100 burns and drives day-one quest id 12. See `docs/specs/RECYCLE_BIN.md`.

### `R3tardsCDBurner` Lab

An adminless mix CD-R minter. Pick 1–12 distinct frames you currently own, add a 1–24-character Sharpie label, and mint one immutable artifact through `R3tardsLabs`. Burning a CD does **not** burn or transfer the source frames; finales are allowed, token #0 and active session keys are not.

Every CD snapshots frame ids, season/storm/finale flags, face/background colours and 32×32 4-bit thumbnails into one `FrameStore` pointer. Its 1000×1000 SVG renders a silver disc, deterministic monoline marker lettering, two-column track list and rim thumbnails entirely from that snapshot, so later sales or burns of source frames cannot change the CD. Common colour traits aggregate all tracks, and the immutable name is `r3tards labs cd #N: <label>`. See `docs/specs/CD_BURNER.md`.

Renderer 0 is the permanent built-in renderer and always remains available. External renderers are called with a **14,000,000 gas cap**; revert, out-of-gas, or empty return falls back to renderer 0. The timelapse target is `<13M` renderer gas and `<200 KB` tokenURI output so the renderer plus fallback path stays compatible with a default 30M `eth_call` ceiling.

The DF1 renderer intentionally uses 64×64 source pixels because exact DF1 v1 is a per-pixel PRNG and the frozen core caps external renderer calls at 14M gas. It reads the core's already-expanded `genesisFrameData(season)` through shared `Source64`, so render cost is independent of guest-outline run count and overlapping outline runs count once. The renderer exposes `source64` and `df1Rgb64` so anyone can reproduce the same bytes offchain. The website may later offer a 256×256 client-side preview from the same seed, but that preview is labelled as site-rendered rather than the onchain image.

## Owner powers and hard limits

Ownership uses OpenZeppelin `Ownable2Step`: `transferOwnership(newOwner)` only nominates a pending owner; the new owner must explicitly call `acceptOwnership()`.

The **R3tardsPaint owner can**:

1. configure, append, or clear a collaboration outline for a **future season only**, before that season begins, with at most **16,384 unique outline pixels** per season;
2. append renderer addresses/names to the optional renderer registry; renderer addresses must contain code;
3. permanently call `freezeRenderers()`, after which no renderer can ever be added;
4. add and retire entries in the display-only Lab registry;
5. permanently call `freezeExperiments()`, after which no new Lab entry can be added while existing entries may still be retired.

`R3tardsPaint.renounceOwnership()` is deliberately disabled. The owner can transfer through `Ownable2Step`, but the protocol cannot be left without the ability to retire a broken Lab entry.

The **R3tardsLabs owner can** set the collection external link for marketplace metadata. It cannot mint, move or burn tokens, authorize Labs, change rendering, or change the immutable 5% royalty receiver.

The **Painter Pass owner can** append view-only `IStampSource` contracts, enable/disable an existing stamp source, and set the collection external link. Disabling a source only removes that source from live Pass metadata; it grants no protocol privilege and does not alter paint history.

The **Quests owner can** append new display-only quests through `Ownable2Step`. Existing quests, completion records and requirements are immutable once added.

The owners **can never**:

- paint, erase, recolor, restore, or otherwise modify canvas pixels through an owner privilege;
- change a current or past season outline after that season starts;
- cover more than 16,384 unique canvas pixels with a future-season outline;
- alter a frame's immutable stored background, block, proposer, season, face, or background record;
- choose or override the renderer for somebody else's token;
- change renderer 0 or make another renderer the default;
- unfreeze the renderer registry or Lab registry;
- give a Lab experiment or stamp source contract pixel, frame, budget, session, or ownership permissions merely by registering it. No Lab has special powers over the canvas; Sleepwalker only paints through your own signed session, with your own budget;
- trigger, cancel, move, or alter a DF1 storm;
- change painter statistics directly;
- burn token #0 or season finales;
- bypass paint budgets, tile heat, wet-paint rules, region caps, frame cooldowns, or session limits.

Bad optional metadata extensions fail closed: malformed/reverting renderer, stamp-source and Labs metadata return data is ignored and the permanent built-in/fallback metadata path remains available.

If an owner also owns an NFT, they retain only the same holder rights as any other holder for that NFT.

## Collaboration seasons

Unset seasons use the permanent genesis r3tard outline. A future season can be prepared with:

```solidity
setSeasonOutline(season, outlineRuns, guestName)
appendSeasonOutline(season, moreRuns)
clearSeasonOutline(season)
```

Outline runs are packed 3-byte `[y, xStart, xEnd]` values. An empty custom outline is valid and means no character. The union of all outline runs for one season is capped at **16,384 unique pixels** (one quarter of the 256 × 256 canvas), including appended/overlapping runs. Masks are expanded before the season starts into that season's own aligned 1,024-slot nibble-mask region, while the raw run chunks remain readable onchain through `seasonOutlineRuns(season)`.

Once a season starts, its outline and guest name are permanent. Frames always recompose with the outline belonging to their recorded season.

## Session keys

`startSession(owner, sessionKey, expiryBlock, maxUnits, nonce, deadline, sig)` verifies an EIP-712 owner signature through OpenZeppelin `SignatureChecker`, including ERC-1271 owners. The signature is domain-bound to chain ID and this contract, includes the per-owner nonce, and uses a unix-seconds deadline.

A session can only be activated by the **session key itself**: `msg.sender == sessionKey`. This prevents one wallet from registering an unrelated victim address as a burner. A key that has already painted as itself cannot become a session key. An active key cannot be reassigned to another owner.

The core no longer calls the Painter Pass during session setup. Pass ownership already implies paint history, so that external check was redundant; removing it also prevents a bad metadata/Pass address from bricking `startSession`.

An owner can call `incrementSessionNonce()` at any time to invalidate an unused signed authorization before its session starts. Starting a session also consumes the current nonce as normal.

A session lasts at most 24,000 blocks. A session-key paint:

- is attributed to the owner for budgets, active days, holder checks, statistics, and DF1 hand-offs;
- increments the owner's `sessionPaints`;
- consumes the owner's normal paint budget;
- also consumes the session's signed `maxUnits` allowance;
- may call `paint` only. It cannot mint frames or change face/background while active.

The owner may revoke an active session at any time. **Expired or revoked session entries are no longer special identities:** the address immediately behaves as a normal wallet again and may paint, mint frames, change face/background, or claim a pass if independently eligible.

## DF1 storms

Storms are deterministic and have no admin controls:

```text
STORM_PERIOD_BLOCKS = 200,000
STORM_LENGTH_BLOCKS = 600
storm = block.number % 200,000 < 600
```

Outside a storm, the existing regional hand-off-pressure rule determines DF1 AMOUNT. During a storm, AMOUNT is forced to `200`. `isStorm(blockNumber)` and `nextStormStart()` are public views. A successful paint during a storm increments the painter's `stormPaints`; frames minted during storm blocks record DF1 200 and metadata trait `Storm: yes`.

## Validator seal

`FrameInfo.proposer` stores `block.coinbase` at frame/finale mint time. Metadata exposes it as the checksummed `Sealed by` address.

**Before mainnet:** verify on Monad testnet that `block.coinbase` is in fact the proposing validator's beneficiary for the block semantics the app wants to describe. If Monad exposes different proposer semantics, treat this trait as beneficiary/coinbase instead of claiming validator identity. Do not paper over the distinction because marketing wanted a prettier noun.

## Renderer registry

`addRenderer(renderer, name)` is append-only and owner-only. `freezeRenderers()` permanently closes the registry.

A token holder selects their own renderer with:

```solidity
setTokenRenderer(tokenId, rendererId)
```

Setting renderer `0` resets to the built-in renderer. The selection persists through transfer; the new holder may change it. The contract owner has no override function.

## Lab registry and builder API

`addExperiment(address, name, uri)` and `retireExperiment(id)` are registry/metadata operations only. Registry membership grants **zero** permissions over pixels, frames, budgets, seasons, renderers, or ownership. No Lab has special powers over the canvas; Sleepwalker can write pixels only because the painter separately signs a normal core session for its deterministic key, and those writes spend that painter's normal budget.

Useful read APIs include:

- `frameData`, `frameData128`, `frameCompositeData`, `frameInfo`
- `painterStats`, including `sessionPaints` and `stormPaints`
- `seasonInfo`, `seasonOutlineRuns`, `seasonGuest`
- `sessionInfo`, `budgetOf`, `tileState`, `regionState`
- `regionWords(season, region)` → the region's 64 packed canvas words
- `regionBlankMask(season, region)` → 64 rows where bit `63-x` is 1 only for blank, non-outline cells
- `getBackgroundCanvas`, `getCanvas`, `df1Seed`
- `isStorm`, `nextStormStart`

`regionBlankMask` is deliberately view-only and exists so later Lab contracts such as independent region-local cellular automata can read where births are allowed without the immutable core ever calling those experiments.

**Registry launch policy: intentionally unfrozen.** `freezeExperiments()` exists, and no deployment script calls it. At initial launch the experiment registry is **left open on purpose**: it is a discovery/display registry, not a Paint permission boundary (see above), and future Monad-native peripherals need to be discoverable through the same architecture. The trade-off is explicit: the Paint owner (the Safe) keeps the ability to append and retire entries. The Launch Doctor reports `EXPERIMENTS · NOT FROZEN · policy INTENTIONAL` rather than a failure, and changing this policy requires a deliberate, documented decision. Renderer freezing is a separate decision, reviewed after full verification.

**Discovery scale.** `src/chain/contracts.ts` reads `experimentCount()` and then every `experimentInfo(i)` once per session and caches the result. At today's 16–17 entries that is cheap. If the registry ever grows significantly, discovery may need pagination, batching or an index in a future phase; nothing needs to change now.

### Monad hardware / active UI

The active frontend exposes **Explore Monad**, **System Information** and **Block Camera**. Earlier PAGE.EXE, Kernel Debugger and CARDMEM.EXE windows are retired, but their deployed backends are preserved where an active surface depends on them.

- Explore Monad's **Storage race** calls the PAGE.EXE experiment with read-only `eth_call`s to demonstrate MIP-8 page warming.
- **Block Camera** mints through `R3tardsLabs` and uses live block/proposer context.
- **System Information** reports measured, onchain, configured and unknown device state without pretending a missing probe succeeded.

The shared hardware model remains documented in [`docs/specs/MONAD_HW.md`](specs/MONAD_HW.md).

### Monad Card (CARD.DRV)

`R3tardsCardMemory` remains registered as `card-drv`. Every Monad Card id addresses one hashed, aligned 4 KiB page; only the card's current `ownerOf(cardId)` may write it. The card contract itself is never modified, wrapped or escrowed. The old CARDMEM.EXE programmer UI is retired.

CARD.DRV is still active infrastructure: Block Camera can include card context, the Painter Pass can expose the `MONAD CARD` stamp, and the `CARD CARRIER` quest checks ownership. Monad Cards are mainnet-only, so testnet uses `MockMonadCard`; the official chain-143 address is enforced by the driver constructor. See [`docs/specs/MONAD_CARD.md`](specs/MONAD_CARD.md).

### Operator record and system event

Phase OPERATOR adds two removable, adminless contracts. `R3tardsOperatorRecord` (`operator-record`) reads objective per-address facts from the existing Paint/Lab/hardware contracts and stores only the first block at which each subsystem was observed plus a prospective bitmap of paint seasons observed. Existing counters stay in their source contracts; there is no aggregate score or repetition counter.

`R3tardsSystemEvent` (`system-event`) is the permanent DEVICE 07 latch. On Monad mainnet it accepts only the Chainlink MON/USD proxy and can be activated permissionlessly once one fresh round is at or above the deployed milli-USD threshold (`333` by default, or `$0.333`). It has no owner, reset or fallback activation path.

My Pass exposes the address's record under the **Operator** tab and System Information exposes **DEVICE 07 · UNKNOWN DEVICE**. These active screens distinguish live onchain facts, derived values, deployment configuration and unknown data. The phase makes no promise about what, if anything, the record or event will be used for. See [`docs/specs/OPERATOR_RECORD.md`](specs/OPERATOR_RECORD.md) and [`docs/specs/SYSTEM_EVENT.md`](specs/SYSTEM_EVENT.md).

### CD-ROM (D:)

Burned CDs open in a Windows 98 CD-ROM drive: insert a CD your wallet holds and its tracks appear as `TRACKnn.BMP` files, readable in an Imaging viewer even after the CD is traded or a source frame is recycled. See [`docs/specs/CDROM.md`](specs/CDROM.md).

### Router Lab backend (ROUTER.EXE UI retired)

`R3tardsRouterLab` (`router-lab`) is a stateless read-only MRC-17 routing laboratory. One `eth_call` compares up to eight configured adapters against the same block state; every quote executes through an ordinary gas-capped child `CALL` that deliberately reverts so quote-side state cannot persist. The standalone ROUTER.EXE window is retired; **Explore Monad → Liquidity race** is the supported read-only view.

The lab has no owner, storage, custody, fees or persistent execution path. Mainnet venue addresses and runtime-code hashes come from the pinned Monoper deployment manifest; local/testnet uses mock venues. MRC-17 is a draft, and the adapters are third-party integration code under active development. See [`docs/specs/ROUTER_EXE.md`](specs/ROUTER_EXE.md).

### Launch tooling: Launch Doctor, DXDIAG.EXE, Run…

- **Launch Doctor** (`RPC_URL="$MONAD_RPC_URL" npm run -s launch:doctor -- --paint <0x…> [--expected-owner <0x…>] [--expected-chain <id>] [--json]`) is a read-only Node CLI for the deployer. It verifies ownership and pending owners, immutable wiring, the experiment and renderer registries, Pass pin capacity, CARD.DRV, Block Camera links, every Operator Record source pointer, the System Event feed, ROUTER adapter code hashes on mainnet, the release schedule and freeze readiness. Every check is `OK`, `WARN`, `FAIL` or `UNKNOWN`; the exit code is 1 only when something `FAIL`s. It never signs, never sends a transaction and never prints the RPC URL.
- **DXDIAG.EXE** (Start → System Tools) shows what this browser is connected to and which r3OS components it can see, reads once on open (Refresh to re-read) and copies a plain-text support report without RPC URLs or wallet data.
- **Run…** (Start menu) opens allowlisted programs and a few typed routes (`operator`, `frame <id>`, `auction <id>`) through the same release-aware path as every icon. It is not a shell: no URLs, no `javascript:`, no arbitrary hashes.

The canonical launch list is [`docs/PRE_MAINNET_CHECKLIST.md`](PRE_MAINNET_CHECKLIST.md).

## Palette

| # | Hex | Name |
|---:|---|---|
| 0 | background | background / eraser |
| 1 | `#000000` | black |
| 2 | `#965E4B` | trippie brown |
| 3 | `#877549` | old man olive |
| 4 | `#C52020` | juicy red |
| 5 | `#FEC343` | gold |
| 6 | `#EE93E3` | og pink |
| 7 | `#FFFFFF` | white |
| 8 | `#07992F` | green |
| 9 | `#A0055D` | nad magenta |
| 10 | `#694B87` | purple |
| 11 | `#5FEDDF` | DF1 cyan |
| 12 | `#F7931A` | BTC orange |
| 13 | `#C864AA` | waifu pink |
| 14 | `#9F70DA` | pill purple |
| 15 | `#D47827` | emoji orange |

## Build and tests

```bash
npm ci
npm run contracts:build
npm run contracts:test
npm run test:web
npm run generated:check
npm run build
```

`contracts:build` uses normal `forge build`, then `scripts/check-contract-sizes.mjs`, which enforces Monad's 131,072-byte runtime ceiling rather than Ethereum EIP-170's 24,576-byte threshold.

## Gas benchmark table

Foundry is pinned to **v1.8.3** and the suite runs with Monad rules: `network = "monad"` and `hardfork = "monad:MonadTen"`. MIP-8 page storage has been live since MonadTen on 2026-09-02, and the canvas/Flipbook layouts are deliberately 128-slot aligned so same-page accesses receive Monad's page-warming treatment.

Monad charges from the submitted **gas limit**, not merely gas used, including reverted transactions. The regression limits below therefore include measured headroom under Monad rules. Testnet still remains the final source for production gas-limit constants. See `docs/specs/GAS_LIMITS.md`.

`GasBenchmarks.t.sol` logs fresh, wet and dry paint paths separately. Full-canvas remains observation-only because production region caps intentionally make a single-transaction full-canvas paint impossible.

| Operation | Monad regression limit |
|---|---:|
| ~20 px fresh / wet / dry | `400k / 170k / 175k` |
| 128 px fresh / wet / dry | `800k / 250k / 260k` |
| 8,192 px fresh / wet / dry | `9.9M / 3.7M / 3.8M` |
| full canvas, benchmark caps raised | **log only** |
| core deploy | `< 20M` |
| `mintFrame()` | `< 8.5M` |
| `tokenURI(0)` / `tokenURI(frame)` | `< 10M / < 10M` |
| timelapse renderer | `< 13M` and `< 200 KB` output |
| exact DF1 renderer, default / arbitrary stored outline | `< 10M / < 10M` |
| opted-in timelapse via core `tokenURI` | succeeds under a `30M` call |
| outline set/append tx | `< 30M / tx` |
| Flipbook first paint in block, 64 px | `< 175k` |
| Flipbook later paint in same block, 64 px | `< 175k` |
| Flipbook worst case, 32 runs / 16 words / 64 px | `< 240k` |
| Flipbook `recentFrames(32)` | `< 330k` |
| Flipbook `mintReel`, 32 frames | `< 5M` |
| Labs `tokenURI`, 32-frame Flipbook reel | `< 11M` |
| Weeds `tick` / `plant` / `worldBitmap` | `< 600k / < 500k / < 1M` |
| Fork `forkFrame` / `forkFork` | `< 2.3M / < 1.6M` |
| Fork paint, 64 px one row / 32 rows | `< 250k / < 250k` |
| Labs `tokenURI`, Fork / Fork `stamp` | `< 2M / < 25k` |
| Brush `catchBrush` / verify 1 region / verify 4 regions / `stamp` | `< 160k / < 250k / < 400k / < 20k` |
| Finale auction `list` / bid / settle(43 bids) / withdraw | `< 300k / < 250k / < 350k / < 100k` |
| Quest claim, 1 core condition / 4 stamp conditions / `stamp` | `< 160k / < 250k / < 25k` |
| CD Burner `burnCD`, 12 tracks / Labs `tokenURI` | `< 6M / < 8M` |
| Recycle Bin `recycle(1)` / `recycle(50)` | logged regression values; production uses exact estimate + 10% |

Production gas limits must be re-measured on Monad testnet. In particular, Flipbook paint uses a fixed 240K limit rather than `eth_estimateGas`, because the transaction can land on either the new-frame copy path or the same-frame edit path depending on block placement.

## Deployment without raw private keys

Foundry deployment uses an unlocked Foundry account alias or a Ledger. No raw private key belongs in `.env`, shell history or the repo.

Required launch roles are independent:

```text
DEPLOYER_ADDRESS=<hardware-wallet / Foundry broadcaster>
TOKEN_ZERO_RECIPIENT=0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA
ROYALTY_RECEIVER=<Safe multisig>
FINAL_OWNER=<Safe multisig>
```

`TOKEN_ZERO_RECIPIENT`, `ROYALTY_RECEIVER` and `FINAL_OWNER` all default to `DEPLOYER_ADDRESS` so local/CI deploys keep working without extra environment variables. For mainnet, set them explicitly. `ROYALTY_RECEIVER` is immutable in Paint/Labs and therefore must be correct at deployment; use the intended Safe. `FINAL_OWNER` should also be the intended Safe.

The script temporarily deploys Paint with token #0 on the broadcaster so every owner-only renderer/Lab/quest wiring step can complete even when `TOKEN_ZERO_RECIPIENT` is a different address. After all wiring, token #0 is transferred to `TOKEN_ZERO_RECIPIENT`. Then the script calls `transferOwnership(FINAL_OWNER)` on every ownable day-1 contract: Paint, Labs, Painter Pass and Quests. Because they use `Ownable2Step`, the Safe must later call `acceptOwnership()` on each one. The script prints that checklist at the end.

Mainnet chain ID 143 additionally requires `CONFIRM_MAINNET=true` after the same deployment has been tested on testnet. Always deploy with `--account` or `--ledger`, never a raw private key.

Example:

```bash
FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$MONAD_TESTNET_RPC_URL" \
  --account r3tards-deployer \
  --broadcast
```

or:

```bash
FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$MONAD_TESTNET_RPC_URL" \
  --ledger \
  --broadcast
```

After deployment, verify token #0 ownership, immutable royalty receivers and every pending owner before accepting ownership from the Safe. Do not accept ownership until every contract address and registry entry has been checked.

`R3tardsLabs` and the Painter Pass expose ERC-7572 `contractURI()` metadata and owner-controlled external links. Labs royalties are fixed at 5% to `ROYALTY_RECEIVER`; the soulbound Pass reports 0%.

## Testnet and mainnet checklist

Step-by-step deploy commands and the testnet Vercel environment are in [`docs/TESTNET_DEPLOY.md`](TESTNET_DEPLOY.md). The single canonical launch list, including freeze policy, Pass capacity and every check that still needs real Monad data, is [`docs/PRE_MAINNET_CHECKLIST.md`](PRE_MAINNET_CHECKLIST.md). The items below are the original contract-level reminders it expands:

Before mainnet:

- verify Monad's EIP-2935 history contract at `0x0000F90827F1C53a10cb7A02335B175320002935` returns the same recent block hashes as RPC and confirm the effective 8,191-block history window under MonadTen;
- measure auction settlement inside native `blockhash`, through EIP-2935 history, and after the history window where the candle-start fallback is used;
- verify `block.coinbase` semantics for the validator seal;
- re-measure the active production gas policies in `docs/specs/GAS_LIMITS.md`; retained retired-contract benchmarks remain historical regression coverage;
- verify the mainnet `ROYALTY_RECEIVER`, `FINAL_OWNER` and `TOKEN_ZERO_RECIPIENT` values before broadcasting, then verify every `pendingOwner` before each Safe `acceptOwnership()`;
- run the full browser/testnet soak and re-check every registry address before `freezeRenderers()` is used. The experiment registry is intentionally **left unfrozen** at initial launch (see the checklist's freeze policy).

### Public-RPC launch checks

- With Paint plus one Lab open, use `rpcStats` over a 10-second idle window and keep HTTP JSON-RPC traffic at **6 calls/s or less**; websocket traffic is excluded.
- Run with `VITE_LOGS_RANGE=100` and confirm no `eth_getLogs` request spans more than 100 blocks and every Lab still loads.
- Set `VITE_DEPLOY_BLOCK` to the real deployment block before soak testing; no production path should reconstruct history from genesis.
- Run `scripts/auction-keeper.sh` during every finale auction so a permissionless settle is submitted as soon as the contract accepts it.
- On both testnet and mainnet run `cast code 0x0000F90827F1C53a10cb7A02335B175320002935 --rpc-url "$RPC_URL"` and record whether Monad's history-storage contract is present before relying on the extended auction hash window.

## Hackathon launch state

- **Engineering / contracts:** core and add-on architecture complete; direct UI for superseded experiments retired.
- **Performance:** boot prefetch, shared caches, local burner signing, action-RPC settlement and receipt-first UI are complete and measured in DXDIAG.
- **Phase 6:** cold-user / judge path plus repository hygiene complete.
- **Phase 7:** Live Mode hero pass implemented: persistent LIVE state, connect→quick-start handoff, two-browser remote-stroke proof, explorer/X-ray links, DXDIAG remote-event timing and demo choreography.
- **Phase 8 (next):** mainnet rehearsal, real community activity, final metrics, demo recording and Metropolis submission.

The product direction is deliberately narrower than the historical experiment set: the shared canvas and continuous onchain interaction are the centerpiece.

### Post-launch ideas (undefined, not scheduled)

- **CARD BUS:** CARD.DRV words W24–W27 stay reserved by spec; nothing reads or writes them yet.
- **DEVICE 07 next stage:** intentionally unknown.
- **Block Cinema:** concept only, POST-LAUNCH / UNDEFINED.

## Frontend: r3OS 98

The current frontend is a complete Windows 98-style desktop shell. `src/os/programs.ts` is the active program boundary; launch-critical modules are prefetched during the real boot sequence and resolved into the registry before the desktop appears.

Copy the supplied asset pack into `public/os/` before running the app. The app references those PNG/WebP/MP3 assets by URL and does not inline them.

Copy `.env.example` to `.env.local`; it contains the current public testnet defaults. `VITE_RPC_URLS` and `VITE_WS_URL` are app read endpoints. `VITE_WALLET_RPC_URL` is the only RPC URL the app will provide to `wallet_addEthereumChain`. Every `VITE_` value is public in the browser bundle.

`VITE_MULTICALL3_ADDRESS` is optional. On Monad mainnet (143) and testnet (10143) it defaults to the canonical Multicall3 address `0xcA11bde05977b3631167028862bE2a173976CA11`. The app checks that address for deployed code once before using it; if Multicall3 is missing or unavailable, Lab reads fall back to parallel `eth_call` reads with the same per-call failure semantics.

`VITE_REVEAL_ALL=true` bypasses `public/releases.json` and reveals every program. Dev mode does the same automatically for local/testnet work. Production otherwise fetches `public/releases.json` once at boot with `no-cache`; program ids missing from the file are available immediately, while listed ids stay hidden until their UTC timestamp.

If no app RPC is configured (`VITE_RPC_URL` and `VITE_RPC_URLS` are both empty) or the Paint address is missing, the desktop runs in demo mode with a local blank canvas and writes explain how to enable onchain mode.

```bash
npm ci
npm run check:web
```

`npm run repo:doctor` enforces repository hygiene (stale/dead files, duplicate Foundry trees, broken local Markdown links, README placeholders and retired UI reachability). `npm run check:web` runs that doctor, Vitest and the production build. `npm run check` remains the full release gate: repository hygiene, Foundry build/tests, web tests, generated outline/ABI checks and the Vite production build. The frontend imports contract ABIs exclusively from `src/lib/generated/abi.ts`; do not hand-maintain ABI fragments for protocol actions.

### RPC endpoints

The frontend uses an ordered public read pool instead of assuming one endpoint can serve every workload. `VITE_RPC_URL` is retained only as a backwards-compatible primary; `VITE_RPC_URLS` is the normal comma-separated pool. Empty values are dropped and duplicates removed.

`VITE_RPC_RPS` is a **per-endpoint** request budget with a FIFO limiter. `VITE_RPC_BATCH_SIZE` controls JSON-RPC batching. Historical logs are clamped to `VITE_DEPLOY_BLOCK` and `VITE_LOGS_RANGE`; the app never intentionally reconstructs history from genesis or issues unbounded art/metadata `Promise.all` work.

Interactive Live transactions use a separate action-RPC lane. The browser signs one raw transaction locally and may broadcast that same serialized transaction to multiple action endpoints; the fastest acceptance wins. General boot/background reads stay on the normal rate-limited pool.

`VITE_WALLET_RPC_URL` is separate and is the only endpoint exposed through wallet chain metadata. DXDIAG reports endpoint counts and RPC method counts, never the URLs themselves.

The public testnet values used by the current deployment live in `.env.example`. Mainnet endpoints and log-range assumptions are set during Phase 8 rehearsal from providers verified at that time, rather than being hard-coded into this reference.

Demo mode now means either no app RPC URL is configured at all (`VITE_RPC_URL` and `VITE_RPC_URLS` are both empty) or the Paint address is missing.


## Shell layout (2026-10-02 simplification)

The desktop holds only what defines r3OS, in judge-first order: **Paint, Explore Monad, My Frames, My Pass, Block Camera, CD-ROM (D:), Quests** and the **Recycle Bin**. **Auction** joins them only while a finale auction is live onchain. Start has **Programs ▸** (everything a person uses, including Burn a CD and Auction), **Explore Monad**, **System Tools ▸** (Monad X-ray, Network, DXDIAG.EXE, Sounds), Help and Run…. Burn a CD is also a toolbar button in My Frames. The layout lives in `src/os/layout.ts`; retired programs stay retired (`src/os/retired.ts`).

**Explore Monad** (the `monad-hw` program) opens on four one-button experiments; the previous Device Manager view is its **System Information** tab:

- **Block speed** reads the app's existing block stream (no extra RPC) and shows the cadence this browser measured next to the ~300 ms spec.
- **Storage race** runs three `eth_call`s on press: PAGE.EXE `benchRead` over 128 slots on one page vs one slot on 128 pages, plus `probePage`. It shows the measured gas and ratio (MIP-8); nothing is sent.
- **Block camera** shows the live block number and producer from the block stream and opens Block Camera (which owns the expensive viewfinder).
- **Liquidity race** (mainnet) runs one ROUTER-LAB `compare` `eth_call` over the MRC-17 adapters in the venue manifest for 1 WMON → USDC and ranks the **highest quoted output**; no approval, swap or transaction. Off mainnet it shows "MAINNET DEMO" (a dev build can run it against the test venues, labelled as such).

Each page load powers on like a 1998 PC (`src/os/BootScreen.tsx`) while real critical prefetch runs underneath. Cosmetic POST can be skipped, but a key/click cannot bypass critical readiness; the desktop appears when critical work settles or the absolute boot cap fires, with optional work continuing in the background. A first visit then offers three wallet-optional entries: **Paint together · See Monad live · 60-second tour**, stored in `r3os.firstRun.done`. If the visitor connects later, the account-specific prefetch pass runs at that point.
