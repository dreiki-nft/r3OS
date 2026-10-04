# Forks Lab

A saved r3OS paint frame can become a separate 64×64 side canvas. Forks never write the core canvas and remain renderable even after the Forks registry entry is retired.

## NFT plumbing and ownership

Forks is **not** an ERC-721. Every fork token lives in the shared `R3OSLabs` collection. Fork storage is keyed by the global Labs token ID returned by `R3OSLabs.mint`.

Deployment is: deploy Forks with `R3OSLabs`, register Forks in the core Lab registry, then call the permissionless one-time `bindExperimentId(id)`. Binding only accepts the active core-registry entry that points back to this Forks contract.

All ownership rules read `R3OSLabs.ownerOf(forkId)`. A transfer therefore moves closed-fork paint authority, open/close authority and seal authority to the new token owner automatically. Forks remain non-burnable.

## Creating and lineage

A wallet must have painted the core at least once (`daysPainted >= 1`). Active session keys cannot create forks.

- `forkFrame(frameId)` creates depth 0 internally and marketplace depth 1 (`Original`). Token #0 is not forkable.
- `forkFork(parentForkId)` copies the parent's current 64×64 rows, increments depth and increments the parent's live `timesForked` counter.
- Closed and sealed parents may still be forked.
- A creator may make at most one fork every 600 blocks.

`ForkCreated` logs retain source frame, parent, creator and depth for indexing and lineage views.

## Painting

Fork runs use `[y, x0, x1, colour]` on 64×64. One call contains at most 32 runs and 64 pixels, and runs must be sorted by non-decreasing `y`. Each fork has a shared 256-pixel per-block limit.

Open forks are public. Closed forks may be painted only by the Labs token owner's resolved identity, including that owner's active core session key. Sealed forks are immutable. A resolved owner may paint a given fork at most once per block but may paint different forks in the same block.

Every paint updates `Paints`, `Painters`, `Crowd` and `Activity` metadata and emits collection-level ERC-4906 `MetadataUpdate` through `R3OSLabs`.

## Owner controls

Only the direct `R3OSLabs.ownerOf(forkId)` may call `setOpen` or `seal`; approved operators and session keys are intentionally insufficient.

`State` is a live marketplace trait: Open, Closed or Sealed. Sealing records `Sealed block` once and permanently disables further paint or reopening.

## Rendering and traits

`forkBMP(forkId)` remains the 64×64 4bpp onchain renderer with palette entry 0 resolved to the inherited background. `labToken(id)` wraps it in a nearest-neighbour SVG and supplies Fork-specific metadata to the shared collection.

Traits are State, Depth, Lineage, Source frame, Source season, optional Parent fork, From storm frame, From finale, Painters, Crowd, Paints, Activity, Times forked, Forked, Created block and optional Sealed block. Full common traits and bucket edges are in `LABS_NFT.md`.

The `FORKER` Painter Pass stamp remains earned after painting at least three distinct forks.

## Gas policy

Fork `paint` uses a fixed **250K gas limit**. Never use `eth_estimateGas` for fork paint; shared per-block state and first-paint accounting can change between estimation and landing. Use estimate + 10% for `forkFrame`, `forkFork`, `setOpen` and `seal`. Re-measure production limits on Monad testnet before launch.
