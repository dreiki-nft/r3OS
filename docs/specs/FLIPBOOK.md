# Flipbook Lab

The Flipbook is a 32×32 block-rate animation canvas. The first successful Flipbook paint in a new Monad block copies the previous frame and starts a new frame; later paints in that block edit the shared frame. Monad block time therefore becomes stop-motion timing.

## NFT plumbing

Flipbook is **not** an ERC-721. Reels mint through the shared `R3tardsLabs` collection and all reel data remains keyed by that global Labs token ID.

Deployment is: deploy Flipbook with `R3tardsLabs`, register Flipbook in the core Lab registry, then call the permissionless one-time `bindExperimentId(id)`. Binding only accepts an active registry entry whose experiment address is this Flipbook contract.

`mintReel()` snapshots the immutable reel to `FrameStore`, asks `R3tardsLabs` to mint, then records the returned global token ID. Active session keys can paint but cannot mint reels. Reels remain non-burnable.

The legacy `balanceOf(address)` view now proxies `R3tardsLabs.balanceOfExperiment(experimentId, owner)` so the REEL MAKER quest keeps its original meaning without making Flipbook an NFT contract.

`labToken(id)` supplies the animated onchain SVG and Reel-specific marketplace traits to `R3tardsLabs`. See `LABS_NFT.md` for the common schema and buckets. Exact reel-wide distinct `Painters` / `Crowd` are intentionally omitted because immutable reel snapshots do not contain painter identities.

## Editor

- 32×32 grid using the core 16-colour palette.
- Tools: pencil, line, eraser (colour 0) and fill.
- One call: at most 32 runs and 64 pixels.
- Show the live write counter and run count.

## Frames and onion skin

Render the previous frame beneath the working frame at 30% opacity. `recentFrames(32)` provides the ring; `FrameStarted` and `FlipbookPainted` support incremental updates. Frame detail shows frame number, block, proposer, pixel count and painter count.

## Ink

`inkAvailable(owner)` exposes the 200-block window. New wallets have 64 ink; any address that has successfully painted the core gets 256 permanently. One resolved owner may paint only once per block.

The onboarding prompt is: **paint the canvas once to unlock 4× flipbook ink**.

## Live mode

The existing core burner/session key may paint Flipbook for its owner. It cannot mint reels.

## Mint rules

A reel needs 8–32 available frames. After the first reel, at least 32 new frames must exist so reel windows do not overlap. The caller must have painted inside the reel window and must satisfy the per-address reel cooldown.

The UI reports the exact blocking rule rather than a generic disabled state.

## Timing and metadata

Animation timing uses real block gaps, capped at eight ticks, with a four-tick final hold. `labToken` emits Frames, Length, Duration ms, Tempo, Longest hold ms, Blocks spanned, first/last frame and block, Validators, Validator mix, Pixels painted, Busiest frame painters and Storm frames.

## Gas

Flipbook paint uses a fixed **240K gas limit**. Do not call `eth_estimateGas` for paint: whether a transaction becomes the first paint in its landing block changes the path, and Monad charges the gas limit. Re-measure on testnet before launch.
