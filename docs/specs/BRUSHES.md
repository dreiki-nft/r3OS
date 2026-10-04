# Block DNA Brushes

Phase 3 UI specification for `R3OSBrushes`.

## Concept

Every Monad block produces a deterministic 8×8 **Block DNA** brush from its block hash. A new one therefore appears with every incoming block header, roughly every 300 ms at Monad's target block time.

The loop is:

1. **catch** a recent brush into your eight-slot box;
2. **stamp** it onto the live core canvas using an ordinary core `paint` transaction;
3. **verify** that the expected non-transparent brush cells are still present on the current season canvas.

Three successful verifications earn the display-only `BLOCK DNA` Painter Pass stamp. There is no brush NFT and the Lab has no admin.

## Live brush strip

For every new block header, compute:

```ts
brushFromBlockhash(header.hash, header.number)
```

Show the newest brushes as an incoming strip with the source block number, filled-cell count and mono/duo/trio colour classification. A brush can be caught only while its source block remains within the 256-block catch window. Show the remaining blocks/seconds clearly.

The contract's `previewBlock` may be used for recent onchain confirmation. Phase 5 must verify that recent `blockhash(n)` values match the RPC block hashes on Monad.

## Catch

`catchBrush(blockNumber)` stores the exact deterministic brush in the resolved owner's circular box of eight slots. Active core session keys may catch for their owner.

Rules the UI should surface before sending:

- source must be a prior block;
- source must be no more than 256 blocks old;
- the same owner can catch at most once per block;
- the same source block cannot already be in that owner's box;
- overwriting a slot clears that slot's current verified marker, but the lifetime verified total never decreases.

## Stamp

Use `brushRuns(brush, x, y)` / the identical `src/lib/brushes.ts` helper to produce ordinary core paint runs. The brush top-left must fit within `(0..248, 0..248)`.

Stamping is **not** a special core privilege. It spends the user's normal paint budget:

- every filled brush cell consumes normal core units;
- dry overwrites can cost double;
- holder quota/trust/wet paint/heat/region caps all still apply;
- DF1 corruption, especially during a storm, can damage the intended pattern.

A brush usually contains roughly 24–48 filled cells. Show the exact previewed cost against the launch budget (512 px/hour base, rising by 32 per active day to 2,048) and suggest r3tard holder quota where applicable.

## Verify

Verify immediately after stamping. Anyone may paint over the canvas before verification, and a storm can corrupt cells.

The site already has the live canvas, so pre-check all filled cells client-side and highlight mismatches before sending `verify(slot, x, y)`. Transparent brush cells do not matter.

Before allowing a stamp position, run `brushOutlineConflict(brush, x, y, genesisFrameData(season))`. Any non-null result is a **no-stamp zone** and the UI must block that placement. **The face outline is protected paint; nothing lands under it.** The core masks writes below the season outline, so such a brush could never verify. Show the protected outline in the placement preview.

Verification reads only the **current season** through `regionWords`. A pattern stamped in an earlier season cannot be verified after rollover.

For display, show:

- filled cells;
- distinct used colours as mono / duo / trio;
- source block;
- slot verification state;
- lifetime verified count.

## Gas policy

Use `eth_estimateGas + 10%` for `catchBrush` and `verify`, with the normal `eth_call` preflight. Testnet measurements replace launch constants during Phase 5.
