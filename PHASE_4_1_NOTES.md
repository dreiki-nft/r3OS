# Phase 4.1 — finish the Live hot path

## What the testnet report proved

Phase 4 fixed the RPC broadcast tail: Live `burner-broadcast` was tightly clustered around ~187–208 ms. The remaining multi-second `tx-submit` spikes were almost entirely inside `burner-sign`, which reached 5,007 ms. That cannot be secp256k1 work; the current code was routing signing through a WalletClient backed by the general app transport.

The same report exposed two UX bugs:

1. A successful first Quick Start could still show an error after `startSession` had already confirmed, because the post-receipt `refreshLiveStatus()` used a public RPC that could lag or fail. The second click then saw the already-active session and appeared to "fix" it.
2. Hardware Profiles refused an entered `1 MON` top-up whenever the burner still had any dust, because `currentBalance + 1 MON` exceeded the hard 1 MON cap. That disabled the quote/send path before MetaMask was ever called.

## Changes

### Pure local burner signing

- `src/chain/tx.ts` no longer uses `burnerWallet().signTransaction()` for Live sends.
- It signs directly with the `LocalAccount` returned by `privateKeyToAccount` using all already-known EIP-1559 fields.
- No RPC transport is involved in the signing stage.
- The existing redundant raw-tx broadcast remains unchanged.
- `burner-sign` now measures actual local signing instead of WalletClient/transport behavior.
- Removed the now-unused `burnerWallet()` helper and its general app transport dependency.
- Added a tx regression test proving the burner path calls the local account signer and then broadcasts the exact serialized transaction.

### Quick Start cannot report failure after a confirmed start

- After funding confirms, the prior `startSession` quote is rebased to the funding receipt block. This prevents `usableQuote()` from immediately re-estimating against an RPC that may still report the pre-funding burner balance.
- After `startSession` succeeds, any follow-up status refresh failure is non-fatal.
- The successful receipt is committed into the Live store as an active session, then normal event/read reconciliation continues afterward.

### Top up to the cap instead of silently refusing

- Entering `1 MON` now means "send up to 1 MON" while preserving the existing 1 MON browser-key balance ceiling.
- Example: if 0.007 MON remains, entering `1` sends 0.993 MON instead of disabling Send.
- The dialog shows the actual clamped transfer amount.
- Successful top-ups seed both the burner balance cache and visible Live balance from the confirmed receipt instead of immediately replacing them with a potentially stale RPC read.

## Security / scope

- The 1 MON browser-key cap is intentionally unchanged in this patch.
- No Solidity changes.
- No ABI changes.
- No redeployment.
- No wallet RPC exposure changes.

## What to measure after applying

Clear DXDIAG and do 20–30 Live strokes. Focus on:

- `burner-sign · paint` — should collapse from hundreds/thousands of ms to local-signing territory.
- `burner-broadcast · paint` — Phase 4 already showed ~187–208 ms and should stay there.
- `tx-receipt · paint`
- `tx-total · paint · burner`
- `ui-settle · paint`

Also reproduce:

1. Fresh Quick Start requiring funding: one click should proceed through funding into LIVE with no false error and no second click.
2. Spend the burner low, open Top up, enter `1`: MetaMask should open; if dust remains the dialog should show a slightly smaller actual transfer that respects the cap.
