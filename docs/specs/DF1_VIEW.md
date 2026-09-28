# DF1 view

Phase 3 UI specification for the optional exact DF1 v1 renderer.

## Onchain view

Frame holders can opt their frame into `DF1Renderer` through the core renderer selector. The onchain renderer reconstructs a 64×64 RGB source from the immutable frame background plus that frame's season outline, applies the frozen DF1 v1 mulberry32 algorithm, and returns a fully onchain 24-bit BMP inside the usual SVG/JSON wrappers.

The 64×64 resolution is deliberate. Exact per-pixel DF1 is expensive onchain; 64×64 fits below the frozen core's 14M external-renderer gas cap with margin. The SVG scales it to 1024×1024 with nearest-neighbour pixel rendering.

For frames and finales:

- seed = `df1Seed(tokenId)`;
- amount = `max(100, frameInfo(tokenId).df1Amount)`;
- storm frames therefore render at 200%.

For token #0:

- seed = `df1Seed(0)`, so the live view changes with the block number;
- amount = 200 during a deterministic storm, otherwise 100.

## Toggle

Add a **DF1 view** toggle on live canvas and frame surfaces. For owned tokens, the marketplace-visible onchain version uses `setTokenRenderer`. A local preview may be shown before the user commits that renderer choice.

The UI must distinguish:

- **onchain DF1**: the contract's exact 64×64 render;
- **site preview**: optional full-resolution 256×256 client-side DF1 using the same seed and v1 algorithm.

Never imply that the 256×256 site preview is the onchain image.

## Verify

Add a **verify DF1** action:

1. call `DF1Renderer.source64(core, tokenId)`;
2. run the frozen `src/lib/df1.ts` locally using the returned seed and amount;
3. compare the resulting RGB bytes with `DF1Renderer.df1Rgb64(core, tokenId)`;
4. show byte equality / mismatch plainly.

This is a reproducibility check, not a trust badge. Anyone can perform it without owning the token.

## Source reconstruction

The client reads **both** `frameData(tokenId)` and `genesisFrameData(season)`. The latter is the core's already-expanded 256×256 season outline image, where outline nibbles are 1 and everything else is 0. That is the same source used by the onchain `Source64` library.

`src/lib/df1View.ts` mirrors `Source64.rows` exactly:

- frame/background data is 256×256, 4bpp, BMP bottom-up;
- each 64×64 source cell samples the top-left background pixel of a 4×4 block;
- a source cell becomes the face colour when at least 6 **distinct** outline pixels in that 4×4 block are present in `genesisFrameData`;
- palette entry 0 resolves to the frame/live background colour;
- outline cells use that season's stored face colour.

This makes renderer cost independent of how many packed outline runs were used to create the season mask. Overlapping runs count once because the core outline is already OR-composited.

`outlineGenesisFromRuns(runs)` exists only for previewing a future outline that is **not onchain yet**. Once a season outline exists onchain, read `genesisFrameData(season)` instead of reconstructing from raw runs.

The client implementation and renderer are regression-tested against the same DF1 golden vectors.
