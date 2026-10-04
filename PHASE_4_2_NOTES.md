# Phase 4.2 — finish Live start + remove Paint preflight latency

## Why this exists
The Phase 4.1 browser trace proved that local signing and redundant RPC broadcast are now fast and stable:

- burner signing: ~0–2 ms
- burner broadcast: ~182–188 ms
- receipt: usually ~0.2–0.7 s
- UI settle: ~5 ms

Two issues remained:

1. A freshly funded Live session could fail its first `startSession` broadcast with a generic
   `Missing or invalid parameters` error, then succeed immediately on the second click.
2. Live painting still felt slower than the transaction timings implied because the Paint program did
   pre-send work outside `tx-total`: the 120 ms coalescing window, gas quote wait, and a network read of
   all 16 region counters.

## Live-start fix
- A `startSession` gas limit validated before the wallet funding prompt is kept, but its EIP-1559 fee caps
  are refreshed as soon as the wallet has broadcast the funding transaction.
- That fee refresh runs while the funding receipt is being awaited, so it normally adds no visible delay.
- The code no longer marks the old pre-wallet fee quote "fresh" just because funding later confirmed.
- If the just-funded `startSession` raw transaction receives one transient invalid-params / insufficient-
  funds / underpriced / RPC-acceptance style rejection, Quick Start waits 180 ms, refreshes only the fee
  caps, and retries the same authorized session once. Arbitrary actions are never auto-retried this way.
- Once `startSession` has a successful receipt, the UI flips to LIVE immediately. A follow-up public-RPC
  read is no longer on the critical path.

## Live-paint latency fix
- Live auto-paint debounce: 120 ms -> 60 ms.
- At pointer-up, r3tardOS immediately starts the exact `eth_estimateGas` for the completed stroke and hides
  that RTT behind the 60 ms coalescing window.
- The normal React quote effect reuses that in-flight quote instead of starting a duplicate estimate.
- Paint quotes are now explicitly keyed to the patch bytes, so a quote for the previous stroke can never be
  reused for a newer stroke.
- The synchronous Live preflight no longer performs a 16-region Multicall before every send. It derives
  best-effort current-block region usage from `Painted` events this tab already observed. The contract remains
  authoritative and still enforces the region cap onchain.
- New DXDIAG metric: `paint-preflight · live`, measuring the remaining pre-send wait after the coalescing
  window. This exposes latency that `tx-total` intentionally did not include.

## Safety / protocol
- No Solidity changes.
- No ABI changes.
- No deployment changes.
- Burner funding cap remains 1 MON.
- Nonce manager remains strictly sequential through raw-transaction acceptance.
- Receipt-driven canonical canvas settlement is unchanged.

## Browser acceptance test
After clearing DXDIAG timings:

1. Start Live Mode from a burner that requires funding. One click must carry the flow through funding and
   `startSession`; no second click and no invalid-parameters dialog.
2. Draw 20–30 strokes naturally.
3. Confirm `burner-sign` remains ~0–2 ms and `burner-broadcast` remains ~180–250 ms.
4. Inspect `paint-preflight · live`; the target is normally below one RPC RTT because the quote starts at
   pointer-up, with no multi-region RPC waterfall.
5. Confirm `ui-settle · paint` remains in the low-ms range.
6. Exhaust/top up the burner and continue painting without restarting the session.
