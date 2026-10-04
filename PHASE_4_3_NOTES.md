# Phase 4.3 — funded burner visibility barrier

## Why this exists
A fresh Live Mode start could still fail immediately after the wallet funded the burner with a generic
`Missing or invalid parameters` error, then succeed when the user clicked Start Live Mode again.

The prior fix refreshed fee caps and retried after a fixed 180 ms delay. That was still a guess. On a fast
chain with multiple public RPCs, the funding receipt can be visible while the action RPC used for the next
estimate/broadcast is briefly behind on the burner's balance/state.

## Fix
- Adds an action-RPC balance visibility barrier.
- As soon as the wallet broadcasts burner funding, r3tardOS begins polling the preferred low-latency action
  RPC until it can see the exact funded burner balance.
- Once that balance is visible, r3tardOS performs a **full fresh `startSession` estimate**. This validates the
  funded sender balance, contract state, gas limit and current EIP-1559 fee caps together.
- The balance wait + fresh estimate run while the funding receipt is being awaited when possible, hiding most
  of the work behind the wallet/chain confirmation already in progress.
- The old fixed 180 ms retry is removed. If the raw `startSession` is still transiently rejected, the one
  bounded recovery now re-proves the burner balance and fully re-estimates before signing again.
- A 5 s bounded timeout produces a specific safe error instead of Viem's generic invalid-parameters dialog.

## Safety / protocol
- Frontend only.
- No Solidity changes.
- No ABI changes.
- No deployment changes.
- 1 MON burner cap unchanged.
- Session authorization, nonce sequencing and redundant raw-tx broadcast are unchanged.

## Browser acceptance
Fresh browser/burner:
1. Start Live Mode.
2. Sign the session authorization.
3. Confirm the burner funding transaction.
4. r3tardOS must proceed to LIVE automatically with no generic error and no second click.
