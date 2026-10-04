# Threat model notes

This is the contract-boundary threat model for the current r3OS release surface. Local Monad-mode tests are not treated as testnet or mainnet evidence; assumptions that depend on live chain behavior are labelled explicitly.

> **Deployment boundary:** current mainnet source omits discontinued experiments from source and deployment. The historical testnet is not mutated; frontend compatibility filters may still hide historical registry/subsystem entries there. This threat model covers the active mainnet surface plus compatibility assumptions that can affect the shipped frontend.

## Core freeze

The historical testnet Paint bytecode remains unchanged. Current mainnet source uses the r3OS product/protocol naming and two bounded mainnet-only holder bonuses while preserving historical deterministic namespaces. `contracts/src/R3OSPaint.sol` remains release-frozen unless a concrete blocking bug is found.

## Administrative authority: `Ownable2Step`

Ownership transfer is two-step. The current owner nominates a pending owner; the pending owner must explicitly accept. A typo therefore does not immediately transfer control. `R3OSPaint.renounceOwnership()` is disabled so a broken Lab can always be retired by a valid owner; ownership can still move through the two-step path.

The `R3OSPaint` owner can:

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

An active session key cannot use delegated identity to mint frames, flip face/background, or claim the Painter Pass. The frontend revokes before sweeping unused MON (Hardware Profiles → End session).

The EIP-712 domain is part of the signed-session security boundary. Existing chain-10143 Paint keeps the deployed `r3tards paint` / version `2` domain; fresh local/mainnet `R3OSPaint` uses `r3OS paint` / version `2`. The frontend selects by chain id. A silent domain rename on the existing testnet contract would invalidate signatures and is explicitly forbidden.

## Partner holder bonuses

Current mainnet Paint includes fixed mainnet-only holder reads for Skrumpeys (`0xb0dad798c80e40dd6b8e8545074c6a5b7b97d2c0`) and Monad Cards (`0x0000CA12D5c07085022eBC74867157449919Fd67`). Each currently-held collection adds **128 px per UTC day per wallet**, compared with the stronger r3tards tier of **512 px per UTC day per supplied/owned token** in the launch configuration. The partner constants are part of the mainnet bytecode, not owner-configurable allowlists.

The partner contracts are external liveness dependencies only for the **optional bonus check**. Each `balanceOf(owner)` probe is a read-only, **50,000-gas-capped `staticcall`** with strict 32-byte return validation; revert, malformed/no-code behaviour or an unavailable collection fails closed to **no bonus**. `_spendUnits` does not probe either collection at all when ordinary hourly + supplied r3tard quota already covers the action, so an external partner failure cannot brick the common Paint path. Launch Doctor verifies the exact chain-143 addresses, code presence and 128 px constants for a deployment.

The partner quota is intentionally wallet/day-accounted rather than token-id-accounted. This keeps Skrumpeys and non-enumerable Monad Cards automatic and preserves the existing `paint(bytes,uint256[])` ABI, but a transferable partner NFT can make a second wallet eligible later in the same UTC day. This is **not** treated as Sybil resistance. The cap is deliberately only one 128 px bonus per wallet/collection/day; r3tards remains the only per-token holder tier with quota persistence across transfers. Monad Cards are additionally handled as a wallet-holder bonus rather than requiring token-id discovery.

## Painter Pass binding

The core retains a one-time `painterPass` **discovery pointer**, but session safety no longer calls through it. Session registration depends only on core-owned paint/session state, so a broken Pass cannot become a liveness dependency for `startSession`.

The Painter Pass is also bound in the opposite direction through its immutable `PAINT` reference. That lets Pass metadata read the core without giving the Pass any authority over painting or session registration.

## Malicious external renderers

External renderers are opt-in per token. The holder chooses them; the owner cannot force one onto somebody else's token. New renderer registrations must point to deployed code. Metadata calls use a 14M-gas low-level `staticcall`, validate ABI return data before decoding, and fall back to permanent renderer 0 on revert, out-of-gas, empty or malformed output.

The timelapse renderer is additionally constrained to at most four 128×128 frames and has regression tests for `<13M` direct gas, `<200 KB` output, and successful routing under a 30M `eth_call` budget.

Renderer bugs affect optional metadata presentation, not frame/canvas storage. Renderer additions can be permanently frozen.

## Validator seal caveat

Frames record `block.coinbase` as `proposer` and expose it as `Sealed by`. The `Sealed by` label assumes `block.coinbase` corresponds to the proposer beneficiary in the intended Monad context. Where that relationship is not established by live-chain evidence, the UI/docs must describe the field as coinbase/beneficiary rather than inventing validator identity.

No owner can modify a stored frame proposer after mint.

## DF1 storms

Storm timing is purely block-number-derived: `block.number % 200,000 < 600`. There is no owner or oracle input. During a storm DF1 AMOUNT is 200; outside storms the hand-off-pressure rule remains unchanged.

A user can predict storms exactly and coordinate activity around them. That is intentional game design, not randomness or anti-MEV protection. Storm participation is public and increments per-address `stormPaints`.

## Lab read APIs

`regionWords` and `regionBlankMask` are view-only. They create no callback path from the core into an external experiment and registry membership grants no Paint permissions. The APIs remain available for active/future read-only composition.

`regionBlankMask` considers a cell available only when the background nibble is zero and the season outline does not cover it. Its SWAR result is tested against a naive reference.

## Painter Pass and external stamp sources

The Painter Pass is soulbound and grants no privileges. Its built-in stamps are derived live from core stats. External `IStampSource` entries are view-only, holder-independent presentation extensions. Calls use a fixed gas cap; revert, empty/malformed return data or a disabled source is ignored instead of bricking `tokenURI`.

The Pass owner can disable or re-enable an existing source. That is explicitly a metadata availability power: disabling a source makes its stamp appear unearned/skipped but cannot change core state or grant/revoke paint permissions.

A burned Pass cannot be re-claimed by the same address.


## Exact DF1 renderer

`DF1Renderer` is optional per token and therefore inherits the core renderer-registry safety boundary: holder opt-in only, a 14M gas cap, and fallback to permanent renderer 0 on failure. It cannot mutate a frame or canvas.

The DF1 algorithm is frozen v1 mulberry32 and the renderer exposes both its pre-DF1 64×64 RGB source and post-DF1 RGB output for independent byte comparison. The 64×64 onchain resolution is chosen to stay inside the immutable renderer gas cap. A future 256×256 site preview must be labelled as client-rendered and cannot be represented as the onchain token image.

Shared `FrameTraits` rebuilds the built-in immutable frame traits for optional renderers. A renderer bug can therefore affect presentation, but not the underlying frame record.


## Collaboration / offensive content

Future guest outlines are an owner-curated surface. Canvas pixels remain permissionless within budget/heat rules, so offensive user-created frames remain possible. Frontend moderation is UI-only and cannot delete onchain frames.

## Live-network assumptions

These items depend on observed network behavior or external infrastructure and are intentionally distinguished from locally proven code invariants.

| Item | Status |
|---|---|
| Quantified full-canvas wipe time/gas for 1 / 100 / 1,000 wallets, fresh vs aged trust, repair speed | **TESTNET REQUIRED** (needs real gas and inclusion data; local numbers are not a substitute) |
| Production gas limits from observed distributions for active wallet actions | **TESTNET REQUIRED** (`docs/specs/GAS_LIMITS.md`) |
| `block.coinbase` meaning for "Sealed by" | **TESTNET REQUIRED** |
| EIP-2935 history correctness and 8,191-block window; auction fallback path | **TESTNET REQUIRED** |
| Public-RPC load: bounded `getLogs`, idle rate, websocket → polling | **CODE-BOUNDED** · live-network soak required |
| Official Monad Card behaviour | **RESOLVED** on a mainnet fork (2026-10-01: soulbound by `Soulbound()` revert, no ERC-5192 interface) |
| Real MRC-17 adapters and quote isolation | **RESOLVED** on a mainnet fork (2026-10-01, `RouterLabFork`); **MAINNET-FORK VERIFIED 2026-10-01** |
| MON/USD feed freshness and heartbeat | **MAINNET REQUIRED** (oracle check) |
| Session-key user warnings | **RESOLVED** in UI (Live wizard, Hardware Profiles cancel/revoke) · warnings are implemented in the Live wizard and Hardware Profiles |
| Offensive canvas content | **OPERATIONAL POLICY** (no onchain censorship mechanism exists or is planned; UI-only hiding cannot delete onchain frames) |
| Auction keeper and support/recovery process | **OPERATIONAL POLICY** (`scripts/auction-keeper.sh` exists; who runs it is an ops decision) |


## Monad gas-limit model

The Foundry suite is pinned to v1.8.3 and runs with MonadTen rules (`network = "monad"`). MIP-8 page storage has been live since 2026-09-02, so the 128-slot-aligned layouts are security/economic assumptions we test directly rather than Ethereum-priced approximations.

Monad charges from the submitted gas limit, including reverted transactions. Over-padding therefore burns real MON. Core Paint keeps preflight simulation plus explicit DF1 corruption headroom; other active wallet actions use exact-action estimation plus bounded headroom. Production policy is calibrated against live-network observations during release rehearsal; local regression tests do not substitute for RPC/inclusion measurements.



## Finale Candle Auction

`R3OSFinaleAuction` has **no owner or admin**. A finale holder explicitly approves and escrows only the finale they list. The auction cannot seize unapproved tokens or alter the Paint core.

The candle end depends on the closing block hash. The proposer of that exact block could theoretically try to influence its block contents or withhold a block, so the mechanism is not treated as cryptographic randomness for high-value adversarial games. Here it only selects one of 12,000 possible historical end points after a public 24-hour bidding window.

Settlement first uses native `blockhash` while the close block is inside the 256-block window, then Monad's EIP-2935 history contract while the hash remains within its 8,191-block ring. If settlement misses both, the deterministic fallback end is `candleStartBlock`, not `closeBlock`. A late bidder therefore cannot turn delayed settlement into a guaranteed win; bids after the candle start lose under the fallback. No later block hash is used, so a settler cannot choose or grind a replacement randomness source by timing settlement. Shill bidding still cannot be prevented: bidders control their own accounts and may bid against themselves by paying/locking capital.

Bid deposits stay escrowed until settlement because a bidder who looks outbid at the visible close may still become the candle winner. Seller proceeds and ERC-2981 royalties use pull-payment credits. `bid`, `settle`, deposit withdrawal and credit withdrawal are guarded against reentrancy; state/balances are zeroed or finalized before external value transfers, and the winning NFT uses `transferFrom` rather than a receiver callback. The accounting invariant is that contract MON equals all unwithdrawn bidder deposits plus all outstanding credits.

## Quests Lab

`R3OSQuests` uses `Ownable2Step`, but its owner power is **append-only**: the owner may add a new display quest and may transfer ownership, but cannot edit, delete, revoke or retroactively complete an existing quest. Quests grant no pixels, NFT control, budgets, auction rights, Lab rights, funds or other protocol permissions.

Quest conditions are read-only `staticcall`s with a fixed gas cap and copy only one requested 32-byte return word. Reverting targets, missing words and return-bomb attempts therefore fail the condition without giving an external contract an unbounded metadata/claim callback. Completion is stored on the resolved painter address; active session keys can claim for their owner but cannot redirect the completion.


## Monad hardware experiments

The active Monad hardware contracts grant no new authority over Paint. `R3OSPageExe` has no owner/admin, holds no funds and can write only the caller's deterministic 128-word page. Its benchmark-write path always reverts, so measurement state cannot accumulate. `PageWritten` deliberately publishes written words: page contents are public onchain data and must never be treated as private storage.

`R3OSBlockCamera` can mint only through its bound `R3OSLabs` experiment id. Proposer/validator id is **not randomness**: a proposer can influence transaction inclusion, and the portrait uses proposer identity only as art/provenance. Parent hash, epoch and proposer availability are recorded with explicit known/unknown flags so missing device support does not silently become fake zero-valued provenance.

PAGE.EXE benchmark calls and System Information device probes are read-only except for an explicit user page write or Block Camera capture. Live device semantics and public-RPC acceptance are treated as network observations rather than extrapolated from local Monad mode.

## Monad Card / CARD.DRV

`R3OSCardMemory` is ownerless and has no upgrade, payable, approval or signature path. A page write is authorized only by the official/mock card contract's current `ownerOf(cardId)` result and exact `msg.sender`; Paint session keys and ERC-721 approvals do not grant CARD.DRV write authority. On chain 143 the constructor rejects every card address except the official Monad Card contract.

CARD.DRV memory is **public and permanently replayable**. `CardWritten` emits the full written words, so overwriting a label, message or USER byte does not erase the old value from chain history. Users must never put secrets, private keys, passwords or private messages in the page. LABEL and MESSAGE are untrusted user text and the frontend renders them only as text; they are never interpreted as HTML.

The testnet identity device is `MockMonadCard`, not the official card. UI provenance must therefore keep manufacturer and soulbound claims `unknown` unless an onchain ERC-5192 probe supports them; only the official chain-143 address may use the documented-spec fallback.

The `MONAD CARD` Painter Pass stamp source performs a gas-capped external staticcall through the existing Pass machinery. CARD.DRV's own `stamp` catches card-contract failure and returns false, so a malformed/unavailable card response cannot brick Pass metadata.

There is no admin path to edit, clear or migrate CARD.DRV pages. The only mutable storage outside the pages is the writer-to-last-card discovery index; it grants no authority and is revalidated against `ownerOf` before the frontend treats it as a present card. Block Camera card shots store the page hash/write count at capture time and never read mutable CARD.DRV state during later rendering.

## Operator record and system event

`R3OSOperatorRecord` is permissionless to record but cannot accept caller-supplied facts. Each observation is reconstructed with gas-capped `staticcall`s against the configured source contracts, and a first-observed block can move only from zero to the block in which the predicate was actually observed. Repeating the same action does not add another subsystem bit. Missing, reverting, malformed or gas-burning sources are treated as unanswered rather than converted into false facts.

The record is **public history**. Its storage page and `OperatorRecorded` events are readable by anyone, and the Operator tab says so explicitly. It must not be described as private analytics. Session-key-capable sources already attribute their state to the Paint owner; contract-wallet addresses remain valid operators and do not need to originate the recording transaction themselves.

`R3OSSystemEvent` trusts the configured Chainlink MON/USD proxy and one fresh round that satisfies the deployed threshold. On chain 143 the contract hard-requires the verified proxy address. Activation is permissionless and permanent: there is no owner, pause, reset, feed migration or manual fallback. The consequence is intentional liveness risk: if the oracle stops returning fresh rounds before the condition is reached, this deployment cannot be repaired to force activation.

The UI keeps the oracle condition separate from the latch itself: **CONDITION MET** is not **ACTIVATED** until an `activate()` transaction succeeds. After activation, DEVICE 07 still says its driver is not installed and its next stage is unknown. Operator / DEVICE 07 copy is centralized and regression-tested against prohibited marketing vocabulary, and the Operator tab includes the explicit no-promise line required by the product spec.

## Router Lab / MRC-17

`R3OSRouterLab` treats every configured adapter as hostile. Quote calls run with an explicit gas cap inside an external self-call that always reverts, and the parent accepts only its own structured revert envelope. Adapter revert data is copied only up to 512 bytes; successful quote returndata is rejected above the configured cap and strictly ABI-validated before use. One reverting, gas-burning or malformed venue therefore remains isolated from the other venue reports as long as the top-level call satisfies the lab's preflight gas budget.

The lab never uses `delegatecall`, never pulls user tokens, has no owner/config storage and exposes no persistent routing/execution entry point. `simulateNativeIn` is payable only for an `eth_call` execution preview and always reverts. Its per-venue WMON deposit, exact approval, adapter execution and received output also occur inside a self-call that always reverts. A real transaction to this function must fail, restoring the sender's value; the contract must never retain MON, token balances or allowances after the frame unwinds.

Adapter addresses are external configuration, not trust anchors. Mainnet configuration includes expected runtime-code hashes so the UI can flag code that differs from the pinned deployment manifest, but a matching hash does not make an adapter audited or trustworthy. Upgradeable dependencies beneath an adapter can still change independently. Local/testnet directories are mocks and are labelled as such.

Results are only as honest and complete as the RPC state used for the `eth_call`. Router Lab pins a comparison to one block number when the provider supports it and explicitly reports when the provider forces a latest-state retry. The optional Monoper comparison is a separate call pinned to the same block, not part of the lab's atomic comparison.

MRC-17's guarantee is sensitive to caller and state. The lab uses itself as `msg.sender` for quote and execution preview so the two paths share caller semantics, but an observed preview is still not a later execution. Liquidity, oracle state, proposer ordering and venue dependencies can change by the next block. A displayed quote or QUOTE SCOPE result must therefore never be presented as a future-block guarantee.

The transaction-forwarding information shown in Monad Hardware is documentation/research context, not an execution guarantee. Monad's local-mempool forwarding reduces the resemblance to Ethereum's global public mempool, but the RPC operator and upcoming leaders see transactions before inclusion. Historical measurements of sandwich activity describe observed attacker behavior in the study window, not impossibility.
