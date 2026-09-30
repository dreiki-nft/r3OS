# Threat model notes

This is the Phase 2d contract-boundary threat model. The full economic wipe/repair analysis remains Phase 5 work and must use real Monad testnet measurements.

## Core freeze

`contracts/src/R3tardsPaint.sol` received its final pre-testnet SEC hardening before deployment: outline-density limits, experiment-registry freeze, session nonce cancellation, finale grace-period authorization and fail-safe renderer calls. Nothing is deployed yet. After day-1 deployment the core is frozen; later Labs integrate only through registries, view APIs, stamp sources and events already exposed by that contract.

## Administrative authority: `Ownable2Step`

Ownership transfer is two-step. The current owner nominates a pending owner; the pending owner must explicitly accept. A typo therefore does not immediately transfer control. `R3tardsPaint.renounceOwnership()` is disabled so a broken Lab can always be retired by a valid owner; ownership can still move through the two-step path.

The `R3tardsPaint` owner can:

- configure/append/clear **future-season** outlines before those seasons start, capped at 16,384 unique outline pixels per season;
- append optional renderer contracts and permanently freeze renderer additions;
- add/retire display-only Lab registry entries and permanently freeze new experiment additions.

The Painter Pass owner can append view-only `IStampSource` contracts, disable/re-enable a source, and update the marketplace external link. Stamp calls are gas-capped, malformed data is ignored, and disabled sources are skipped.

The owners cannot:

- paint, erase, recolor, or directly write canvas pixels through admin authority;
- modify a running or past season outline or exceed the future-season outline cap;
- mutate already-minted frame/background data or proposer records;
- override a token holder's renderer choice;
- replace renderer 0 or change the default renderer;
- unfreeze renderer or experiment additions;
- make a Lab registry or stamp-source address privileged merely by registering it;
- alter storm timing or force/non-force a storm;
- rewrite painter quest statistics;
- bypass budgets, wet paint, heat, region limits, cooldowns, or session limits;
- burn token #0 or a season finale.

An owner that separately owns an NFT only has the ordinary holder rights attached to that NFT.

## Future-season outline authority

Custom outlines are writable only before the target season starts. Their union is capped at **16,384 unique pixels**, preventing an owner from creating a future season whose entire 256 × 256 canvas is protected and therefore unpaintable. The genesis outline and shipped guest outlines remain below that cap.

The expanded mask is paid for during configuration, not by the season's first painter. Once the season starts, the custom/default selection, guest name, and effective outline are fixed. Frames recompose against their recorded season's fixed outline.

## Session-key registration and theft

A session key must send its own `startSession` transaction. An owner signature alone cannot register an unrelated victim address. This prevents the previous permanent-bricking attack where a malicious owner could label somebody else's wallet as a burner.

A key is rejected if it has already painted as its own identity. The former external Painter Pass lookup was redundant because claiming a Pass already requires paint history; removing that call also prevents an incorrectly configured external contract from bricking all future session starts. An active key cannot be overwritten with a different owner. Revoked and expired entries are treated as ordinary addresses by all action gates, so historical session participation does not brick a wallet.

Owners can call `incrementSessionNonce()` to invalidate signed but not-yet-started authorizations. While active, a stolen burner can spend the remaining signed session allowance painting as the owner. Damage is bounded by both the owner's ordinary budget and `maxUnits`, and the session expires at `expiryBlock`. The owner can revoke it at any time.

An active session key cannot use delegated identity to mint frames, flip face/background, or claim the Painter Pass. Frontend Phase 4 must revoke before sweeping unused MON.

## Painter Pass binding

There is no core Painter Pass pointer. Session safety depends only on core-owned paint/session state, so a separate metadata contract cannot become a liveness dependency for `startSession`.

The Painter Pass remains bound in the opposite direction through its immutable `PAINT` reference. That lets Pass metadata read the core without giving the Pass any authority over painting or session registration.

## Malicious external renderers

External renderers are opt-in per token. The holder chooses them; the owner cannot force one onto somebody else's token. New renderer registrations must point to deployed code. Metadata calls use a 14M-gas low-level `staticcall`, validate ABI return data before decoding, and fall back to permanent renderer 0 on revert, out-of-gas, empty or malformed output.

The timelapse renderer is additionally constrained to at most four 128×128 frames and has regression tests for `<13M` direct gas, `<200 KB` output, and successful routing under a 30M `eth_call` budget.

Renderer bugs affect optional metadata presentation, not frame/canvas storage. Renderer additions can be permanently frozen.

## Validator seal caveat

Frames record `block.coinbase` as `proposer` and expose it as `Sealed by`. Before mainnet, verify on Monad testnet that `block.coinbase` corresponds to the proposing validator beneficiary in the way the UI intends to describe it. If it does not, the UI/docs must describe the field accurately as coinbase/beneficiary rather than inventing validator identity.

No owner can modify a stored frame proposer after mint.

## DF1 storms

Storm timing is purely block-number-derived: `block.number % 200,000 < 600`. There is no owner or oracle input. During a storm DF1 AMOUNT is 200; outside storms the hand-off-pressure rule remains unchanged.

A user can predict storms exactly and coordinate activity around them. That is intentional game design, not randomness or anti-MEV protection. Storm participation is public and increments per-address `stormPaints`.

## Lab read APIs

`regionWords` and `regionBlankMask` are view-only. They create no callback path from the core into a Lab contract and no Lab contract receives core permissions. `R3tardsWeeds` and later experiments consume these views from their own contracts.

`regionBlankMask` considers a cell available only when the background nibble is zero and the season outline does not cover it. Its SWAR result is tested against a naive reference.

## Painter Pass and external stamp sources

The Painter Pass is soulbound and grants no privileges. Its built-in stamps are derived live from core stats. External `IStampSource` entries are view-only, holder-independent presentation extensions. Calls use a fixed gas cap; revert, empty/malformed return data or a disabled source is ignored instead of bricking `tokenURI`.

The Pass owner can disable or re-enable an existing source. That is explicitly a metadata availability power: disabling a source makes its stamp appear unearned/skipped but cannot change core state or grant/revoke paint permissions.

A burned Pass cannot be re-claimed by the same address.

## Flipbook Lab

`R3tardsFlipbook` has **no owner and no admin functions**. If its rules or renderer need a v2, deploy a new Lab and retire the old display entry in the core registry. Registry retirement does not mutate the old contract or its reels.

Active core session keys are paint-only in Flipbook as well: they resolve to the core session owner for ink and painter stats and cannot call `mintReel`. A stolen burner can therefore scribble within the Flipbook owner's remaining ink window, but cannot mint a reel. Core session expiry/revocation immediately removes that delegated identity.

Sybil scribbling is bounded per resolved wallet by the 200-block ink window: 64 writes for a wallet with no core paint day, 256 after it has painted the core. This is not Sybil resistance; many wallets can still coordinate. The surface is intentionally self-healing because the ring advances as new blocks receive paints and retains only the latest 32 live frames.

Minted reels are immutable FrameStore snapshots. Later Flipbook activity cannot alter a reel's frame bytes, block/proposer metadata or tokenURI animation.

Flipbook reads core session state, `daysPainted` and palette data, but **never writes the core**. Its aligned frame/meta pages live only in the Flipbook contract. The frame ring is prefilled at deploy and frame words are XOR-encoded so white rows are not zero storage slots; this shifts storage-growth cost away from launch-day painters. Same-block Flipbook paints intentionally collide with each other because they share the current frame; Flipbook storage and core canvas storage never overlap.

## Exact DF1 renderer

`DF1Renderer` is optional per token and therefore inherits the core renderer-registry safety boundary: holder opt-in only, a 14M gas cap, and fallback to permanent renderer 0 on failure. It cannot mutate a frame or canvas.

The DF1 algorithm is frozen v1 mulberry32 and the renderer exposes both its pre-DF1 64×64 RGB source and post-DF1 RGB output for independent byte comparison. The 64×64 onchain resolution is chosen to stay inside the immutable renderer gas cap. A future 256×256 site preview must be labelled as client-rendered and cannot be represented as the onchain token image.

Shared `FrameTraits` rebuilds the built-in immutable frame traits for optional renderers. A renderer bug can therefore affect presentation, but not the underlying frame record.

## Weeds Lab

`R3tardsWeeds` has **no owner and no admin functions**. It reads `currentSeason` and `regionBlankMask` from the core and never writes the core. A broken Weeds deployment is replaced and the old Lab registry entry can be retired without mutating either contract.

Each region's Life world and generation metadata live in that region's own aligned 128-slot page. Different-region world writes are disjoint. Per-address gardening statistics are separate account state, so activity attributed to the same resolved owner may still share that stats slot; the Lanes visualization remains an estimate from known app storage, not a claim about Monad's actual executor schedule.

A tick reads canvas soil. Therefore a Weeds tick and a canvas paint touching the same region may conflict and be re-executed by Monad. Weeds/Flipbook/mint/reel storage is otherwise separate by the app's model.

Planting is permissionless and not Sybil-resistant. The 100-block cooldown is per resolved owner, so coordinated wallets can plant more often. Patterns are restricted to eight fixed 8×8 bitmaps and can only add cells on current soil. Painting can crowd cells out; the next tick kills any live cell whose canvas pixel is no longer soil.

Active core session keys resolve to their owner for Weeds plants/ticks, so a stolen live burner can garden within the owner's plant cooldown/stat identity until revocation/expiry. Weeds grants no frame, pixel-budget, token or ownership permissions. The `GARDENER` stamp is display-only.

## Collaboration / offensive content

Future guest outlines are an owner-curated surface. Canvas pixels remain permissionless within budget/heat rules, so offensive user-created frames remain possible. Frontend moderation is UI-only and cannot delete onchain frames.

## Deferred Phase 5 analysis

Phase 5 still needs quantified full-canvas wipe time/gas for 1/100/1,000 wallets, fresh vs aged trust, repair speed, and the final session-key/offensive-content operational analysis using Monad testnet measurements.


## Monad gas-limit model

The Foundry suite is pinned to v1.8.3 and runs with MonadTen rules (`network = "monad"`). MIP-8 page storage has been live since 2026-09-02, so the 128-slot-aligned layouts are security/economic assumptions we test directly rather than Ethereum-priced approximations.

Monad charges from the submitted gas limit, including reverted transactions. Over-padding therefore burns real MON. Flipbook paint deliberately uses a fixed 240K limit because whether a transaction lands on the first-paint copy path or later same-block path cannot be predicted reliably by estimating against the previous block. Core paints keep preflight simulation plus explicit DF1 corruption headroom. Testnet soak in Phase 5 must update every production limit from observed distributions.

## Forks Lab

`R3tardsForks` has no owner/admin and cannot write the core. It reads immutable frame data only when seeding a fork. The resulting fork lives entirely in the Lab contract.

Open forks are deliberately griefable: any resolved painter can edit them. The NFT owner can close a fork to make painting owner-only or seal it permanently. The shared 256 px/block budget slows a coordinated wipe but is not Sybil resistance.

Fork spam costs roughly the measured fork-creation gas and additionally requires an address that has painted the core plus a 600-block per-creator cooldown. Multiple Sybil painters can still create more forks by paying their own gas and satisfying the core-paint gate.

A stolen active session key may paint an eligible open fork, or a closed fork belonging to its resolved owner, until the core session expires/revokes. It cannot create fork NFTs or operate direct-owner controls. Approved ERC-721 operators likewise cannot close/reopen/seal; those controls require the direct owner.

Sealed forks cannot be reopened. Forks may still be created from closed or sealed parents because the picture and lineage are public. Forks hold no funds beyond ordinary ERC-721 ownership and fixed ERC-2981 royalty metadata.

## Block DNA Brushes Lab

`R3tardsBrushes` has no owner/admin, holds no funds, and never writes the core. A brush is deterministic from a recent block hash. A validator could theoretically withhold a block in an attempt to steer that single block's brush; the game provides no economic reward for a particular brush, so this is not treated as secure randomness.

A brush may be verified only for the resolved owner whose box contains it. Stamping uses ordinary core paint, so another painter or DF1 corruption can change a filled cell before verification. Verification is intentionally current-season-only; season rollover invalidates old unstamped/unverified canvas placements.

Active session keys may catch and verify for their owner. Compromise therefore exposes the owner's box-game actions until session expiry/revocation, but grants no special core paint authority beyond the existing session itself.

Phase 5 must verify that contract `blockhash(n)` matches recent RPC block hashes on Monad and confirm the effective 256-block catch window.

## Finale Candle Auction

`R3tardsFinaleAuction` has **no owner or admin**. A finale holder explicitly approves and escrows only the finale they list. The auction cannot seize unapproved tokens or alter the Paint core.

The candle end depends on the closing block hash. The proposer of that exact block could theoretically try to influence its block contents or withhold a block, so the mechanism is not treated as cryptographic randomness for high-value adversarial games. Here it only selects one of 12,000 possible historical end points after a public 24-hour bidding window.

Settlement first uses native `blockhash` while the close block is inside the 256-block window, then Monad's EIP-2935 history contract while the hash remains within its 8,191-block ring. If settlement misses both, the deterministic fallback end is `candleStartBlock`, not `closeBlock`. A late bidder therefore cannot turn delayed settlement into a guaranteed win; bids after the candle start lose under the fallback. No later block hash is used, so a settler cannot choose or grind a replacement randomness source by timing settlement. Shill bidding still cannot be prevented: bidders control their own accounts and may bid against themselves by paying/locking capital.

Bid deposits stay escrowed until settlement because a bidder who looks outbid at the visible close may still become the candle winner. Seller proceeds and ERC-2981 royalties use pull-payment credits. `bid`, `settle`, deposit withdrawal and credit withdrawal are guarded against reentrancy; state/balances are zeroed or finalized before external value transfers, and the winning NFT uses `transferFrom` rather than a receiver callback. The accounting invariant is that contract MON equals all unwithdrawn bidder deposits plus all outstanding credits.

## Quests Lab

`R3tardsQuests` uses `Ownable2Step`, but its owner power is **append-only**: the owner may add a new display quest and may transfer ownership, but cannot edit, delete, revoke or retroactively complete an existing quest. Quests grant no pixels, NFT control, budgets, auction rights, Lab rights, funds or other protocol permissions.

Quest conditions are read-only `staticcall`s with a fixed gas cap and copy only one requested 32-byte return word. Reverting targets, missing words and return-bomb attempts therefore fail the condition without giving an external contract an unbounded metadata/claim callback. Completion is stored on the resolved painter address; active session keys can claim for their owner but cannot redirect the completion.


## Monad hardware experiments

The Monad hardware suite is removable and grants no new authority over the Paint core. `R3tardsPageExe` has no owner/admin, holds no funds and can write only the caller's deterministic 128-word page. Its benchmark write path always reverts, so benchmark state cannot accumulate. The page log deliberately publishes the written words; page contents are public onchain data and must never be treated as private storage.

`R3tardsBlockCamera` can mint only through its bound `R3tardsLabs` experiment id. Proposer/validator id is **not randomness**: a proposer can influence transaction inclusion, and the portrait uses proposer identity only as art/provenance. Parent hash, epoch and proposer availability are recorded with explicit known/unknown flags so a missing precompile does not silently become a fake zero-valued device.

`R3tardsKernelDebugger` has no admin. It may retain only `credits[msg.sender]`, which that same sender can withdraw. Its optional state step is an external self-call so a failure is isolated from the primary frame. A graceful reserve-dip path must successfully refund before it can continue; a rejecting refund receiver therefore reverts the whole run rather than pretending the unwind succeeded.

The Kernel **process key is a hot localStorage key**, in the same risk class as the Paint burner but in a separate namespace: `r3os.kernel.key.<chainId>.<owner>`. Browser compromise or malicious same-origin script can steal it. It must be funded only with the tiny amount needed for the experiment, kept below 10 MON, and swept back after use. It has no Paint session authority.

The naive burst is intentionally expected to revert when Monad enforces an uncorrected reserve dip. Because a reverted transaction has no surviving `ProcessReport`, the frontend may say only that the receipt is *consistent with* the reserve rule; it must label that statement as inference and must not fabricate a measured reserve result.

## Monad Card / CARD.DRV

`R3tardsCardMemory` is ownerless and has no upgrade, payable, approval or signature path. A page write is authorized only by the official/mock card contract's current `ownerOf(cardId)` result and exact `msg.sender`; Paint session keys and ERC-721 approvals do not grant CARD.DRV write authority. On chain 143 the constructor rejects every card address except the official Monad Card contract.

CARD.DRV memory is **public and permanently replayable**. `CardWritten` emits the full written words, so overwriting a label, message or USER byte does not erase the old value from chain history. Users must never put secrets, private keys, passwords or private messages in the page. LABEL and MESSAGE are untrusted user text and the frontend renders them only as text; they are never interpreted as HTML.

The testnet identity device is `MockMonadCard`, not the official card. UI provenance must therefore keep manufacturer and soulbound claims `unknown` unless an onchain ERC-5192 probe supports them; only the official chain-143 address may use the documented-spec fallback.

The `MONAD CARD` Painter Pass stamp source performs a gas-capped external staticcall through the existing Pass machinery. CARD.DRV's own `stamp` catches card-contract failure and returns false, so a malformed/unavailable card response cannot brick Pass metadata.

There is no admin path to edit, clear or migrate CARD.DRV pages. The only mutable storage outside the pages is the writer-to-last-card discovery index; it grants no authority and is revalidated against `ownerOf` before the frontend treats it as a present card. Block Camera card shots store the page hash/write count at capture time and never read mutable CARD.DRV state during later rendering.