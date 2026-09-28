# Weeds Lab

Phase 3/4 UI specification for `R3tardsWeeds`.

## Concept

The live canvas has 16 independent 64×64 regions. Weeds gives every region its own toroidal Conway's Game of Life world. A cell can live only where the current canvas is blank and the season outline does not cover it.

Painting therefore crowds weeds out. A fresh season exposes new soil. The Weeds contract reads the core but never writes it.

## Overlay

Read `worldBitmap()` and draw the 256×256 one-bit map over the live canvas. The bitmap is top-down and row-major; within each byte the most-significant bit is the left pixel.

Use a distinct treatment for live weeds while keeping the underlying canvas legible. The contract itself stores no colour; the site may use DF1 cyan for consistency with the Lab identity.

Show per-region:

- generation;
- population;
- whether that region already ticked in the current block.

## Tick controls

Each region gets a **tick** control. `tick(region)` advances only that region by one Life generation and can succeed at most once per region per block.

**Tick all 16** sends 16 separate transactions, one per region. It's a convenience button. Transactions from one wallet share a nonce and balance, so Lanes shows them chained. The parallel picture appears when different people tick different regions in the same block, and that's what the Weeds page should point at.

Gas policy: `eth_estimateGas` + 10%, with the same preflight/error handling used by other non-Flipbook actions. Testnet soak replaces the final production limit.

## Planting

Expose the eight built-in 8×8 patterns:

1. glider
2. LWSS
3. R-pentomino
4. blinker
5. acorn
6. block
7. beehive
8. diehard

The user chooses a region, pattern and top-left cell. Placement wraps around that 64×64 torus. Cells that are not current soil are silently excluded by the contract. If no new live cell remains, the transaction reverts `NothingPlanted`.

Show the 100-block per-owner plant cooldown. Active core session keys resolve to their owner for gardening stats and cooldowns.

## Lanes

Weeds uses the same region lanes as canvas paint:

- weeds × weeds conflicts only in the same region;
- weeds × paint conflicts when their region masks overlap because a tick reads the canvas soil that paint writes;
- Weeds does not collide with Flipbook, frame mints or reels by this app's storage-layout estimate.

The UI must continue to label this as an estimate from the app's storage layout. Monad's executor determines the real optimistic-parallel schedule.

## Gardener stamp

The Painter Pass obtains the view-only `GARDENER` stamp from the Lab when the address has either:

- planted at least 5 times; or
- ticked at least 25 generations.

The stamp grants no permissions or economic advantage.
