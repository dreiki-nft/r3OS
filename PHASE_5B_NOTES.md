# Phase 5B — Boot Prefetch Engine

Goal: spend the boot screen on real startup work so r3tardOS reaches the desktop already hot, while keeping the boot screen under 10 seconds even if RPCs are slow.

## What changed

- New `src/os/bootPrefetch.ts` orchestrates an idempotent startup pass.
- Full boot is hard-capped at 9.5 seconds including the fade budget; any key/click still skips immediately and prefetch continues in the background.
- The splash now shows real startup work and progress instead of only a decorative loading bar.
- Launch-critical program chunks are downloaded during boot: Paint, My Pass, My Frames, Frame Properties, Block Camera, CD-ROM, Burn a CD, Explore Monad, Network Neighborhood, Quests, Auction, Recycle Bin, DXDIAG, Monad X-ray, Live Mode and Help.
- Desktop/Start-menu hover and keyboard focus prewarm a program as a fallback if boot did not finish its chunk.
- Boot warms action RPC ranking, contract discovery/core constants, canvas state, fee data and the frame index in parallel.
- Silent wallet restoration gets a short window during boot. If an account is restored, boot also warms My Frames ownership and r3tards holder-token discovery.
- Up to six recent owned frame metadata/images are cached in the background after the critical boot pass.
- Boot stages are recorded as `boot-prefetch` performance measurements in DXDIAG.
- DXDIAG now includes the per-method RPC breakdown in addition to the total call count.
- `prewarmActionFees(false)` lets boot avoid probing the action RPCs twice.

## Important behavior

The boot screen waits for the critical startup tasks only after its normal cosmetic minimum. Errors settle a task instead of trapping the user. If critical work is still unfinished, the hard time cap releases the desktop and the work keeps running behind it.

Recent frame-art caching is explicitly noncritical and never holds the desktop hostage.

No Solidity, ABI or deployment changes.

## Validation gate

```bash
npx vitest run \
  src/os/bootPrefetch.test.ts \
  src/os/bootState.test.ts \
  src/diagnostics/diagnostics.test.ts \
  src/chain/tx.test.ts

npm run test:web
npm run build
git diff --check
```

## Browser acceptance

1. Hard reload / new tab so the full boot appears.
2. Do not skip it on the first run. Confirm the splash lists actual startup stages and never remains up for 10 seconds.
3. Immediately after the desktop appears, open Paint, My Frames, Burn a CD, Recycle Bin, DXDIAG and Frame Properties.
4. Compare `program-open` cold numbers with the old ~300–325 ms values. Launch-critical programs should now behave much closer to warm opens.
5. With a remembered wallet, My Frames should already know ownership or finish almost immediately.
6. In DXDIAG check `boot-prefetch` timings and the new RPC-method breakdown.
7. Wait one clean 10-second window after boot before judging steady-state RPC volume, because the boot pass is intentionally front-loaded.
