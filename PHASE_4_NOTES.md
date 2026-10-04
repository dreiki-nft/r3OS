# Phase 4 — Action RPC + mainnet resilience

## Goal
Make Live Mode's transaction path consistently fast and resilient instead of allowing one slow public RPC to add multi-second submit spikes.

## What changed

### 1. Dedicated action RPC pool
- Each configured `VITE_RPC_URLS` endpoint gets its own unbatched, retry-free HTTP client.
- Per-request timeout is 1.5 seconds.
- These clients never sit behind the app's background batching/rate-limit queue.
- Boot prewarming probes all action endpoints once, which both measures them and warms DNS/TLS connections before the first visible action.

### 2. Local endpoint health + adaptive reads
- r3tardOS keeps local-only latency/success/failure state for each action endpoint.
- Action reads prefer the healthy endpoint with the best latency EWMA.
- Infrastructure errors fail over to the next endpoint.
- Contract/execution errors do **not** get retried against every RPC; a valid revert means the endpoint responded correctly.
- Repeated infrastructure failures put an endpoint into a short local cooldown.

### 3. Redundant Live raw-transaction broadcast
- Burner transactions are signed locally exactly once.
- The exact same serialized transaction is broadcast concurrently to every configured action RPC.
- First valid acceptance wins.
- `already known` / already-imported responses count as success for the same expected tx hash.
- Returned hashes are checked against the locally computed transaction hash.
- Chain-level errors such as `nonce too low` are preserved so the existing nonce manager can resync once and retry.

This is safe because every RPC receives identical signed bytes, so every accepted copy has the same nonce and transaction hash.

### 4. Receipt resilience
- Receipt polling is no longer tied to a single fallback client's long-lived waiter.
- It polls the current best endpoint locally.
- If a receipt has still not appeared after 900 ms, it hedges against the second-best endpoint too.
- Infrastructure failures automatically shift the next poll to a healthier endpoint.
- A 15-second unreadable receipt produces an explicit "sent but receipt unreadable" error rather than encouraging blind resubmission.

### 5. Better Live performance telemetry
DXDIAG now separates:
- `burner-sign` — local browser signing only;
- `burner-broadcast` — signed raw tx to first RPC acceptance;
- existing `tx-submit`, `tx-receipt`, `tx-total`, and `ui-settle` remain.

This should make the remaining latency obvious instead of hiding it inside `tx-submit`.

### 6. DXDIAG Action RPC health
Performance now shows only anonymous labels (`RPC #1`, `RPC #2`, …), latency EWMA, successes, failures, and health state.

There is also an explicit `Probe RPCs` button.

**No RPC URLs are displayed or copied into the report.**

### 7. Graceful degraded-mode errors
- If no action RPC confirms broadcast acceptance, r3tardOS tells the user to wait/check the explorer before retrying.
- If the tx was sent but its receipt cannot be read, r3tardOS explicitly says the transaction was sent and warns against blind retrying.

## Scope
Frontend only.

- No Solidity changes.
- No ABI changes.
- No redeployment.
- Frozen Paint core untouched.
- Burner funding cap remains 1 MON.

## Local validation
Run after extracting over the current Phase 3.2 repo:

```bash
npx vitest run \
  src/chain/actionRpc.test.ts \
  src/chain/tx.test.ts \
  src/live/nonce.test.ts \
  src/chain/perf.test.ts

npm run test:web
npm run build
git diff --check
```

Expected new test additions: one `actionRpc.test.ts` file with 5 tests.

## Browser acceptance pass — only after all local tests are green
Clear DXDIAG timings, then:

1. `Performance -> Probe RPCs`; confirm all configured endpoints show anonymously and no URL appears.
2. Start Live Mode from a burner that already has MON.
3. Do at least 20 strokes, including rapid consecutive strokes.
4. Capture:
   - `burner-sign · paint`
   - `burner-broadcast · paint`
   - `tx-submit · paint · burner`
   - `tx-receipt · paint`
   - `tx-total · paint · burner`
   - `ui-settle · paint`
5. Confirm there are no multi-second broadcast spikes under normal endpoint conditions.
6. Temporarily make the first configured HTTP RPC unavailable **only if convenient**; Live should continue through the other endpoints instead of hanging for several seconds.
7. Copy DXDIAG and verify it contains no endpoint URL or secret.

Do not make speed claims from synthetic/unit tests. Use the real testnet DXDIAG run.
