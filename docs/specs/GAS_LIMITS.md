# Gas-limit policy

Monad charges from the submitted gas limit, including reverted transactions. r3OS therefore keeps wallet-facing limits tight, preflights known revert paths, and shows the maximum MON cost before signing.

Phase 7.6 removes gas policies for discontinued experiments. This file covers only actions reachable from the fresh-mainnet product.

## Core paint

Core Paint uses `eth_estimateGas`, then adds deterministic DF1 corruption headroom before the final 10% margin. A transaction can land in a storm or under different crowd pressure than the estimation block.

```text
kMax = min(32, floor(px * 0.0198) + 1)
headroom = kMax * CORRUPTION_WRITE_GAS
limit = (estimate + headroom) * 1.10
```

Until Phase 8 replaces the local value with real mainnet-rehearsal data:

```ts
const CORRUPTION_WRITE_GAS = 12_000n
```

`paintAndMintFrame` uses the same Paint headroom. Preflight `eth_call` remains mandatory so known failures are rejected before a wallet/burner transaction is submitted.

## Other wallet actions

All other production wallet actions use the exact-action `eth_estimateGas` result plus 10% unless a contract-specific note below says otherwise. This includes:

- `mintFrame`, `setFace`, `setBackground`, `startSession`, revoke/cancel session operations;
- Painter Pass claim;
- Quests claim;
- finale-auction list/bid/settle/withdraw paths;
- Recycle Bin `recycle(ids)` and frame safe-transfer drops;
- CD Burner `burnCD(frameIds,label)`;
- Block Camera capture;
- PAGE.EXE `writePage`;
- CARD.DRV writes;
- Operator `RECORD`;
- renderer selection and other ordinary admin/user writes.

Batch actions must quote the **actual submitted list**, not a generic maximum batch.

## Read-only experiments

PAGE.EXE benchmark reads/writes are `eth_call` measurements. `benchWrite` always reverts with `BenchWriteResult` so benchmark state never persists.

Explore Monad's Router Lab comparison is also `eth_call` only. Its outer simulation deliberately reverts after bounded child calls, so approvals, balances and quote-side venue state cannot survive.

## Wallet UX

Before every wallet prompt show the maximum possible fee:

```text
max cost = gas limit × maxFeePerGas
```

Do not present gas-used estimates as guaranteed user cost. Live Mode's burner funding remains separately capped by the application.

## Regression targets

Foundry targets protect the implementation from obvious regressions; they are not substitutes for live-network measurements.

| Action | Local regression / policy | Launch status |
|---|---|---|
| Core paint | estimate + DF1 corruption headroom + 10% | Phase 8 measurement required |
| Frame / Pass / Quest / ordinary writes | exact estimate + 10% | Phase 8 measurement required |
| Finale Auction | exact estimate + 10%; exercise native history, EIP-2935 and fallback settlement paths | Phase 8 measurement required |
| Recycle Bin | exact estimate + 10%; measure representative 1–50 frame batches | Phase 8 measurement required |
| CD Burner | exact estimate + 10%; 12-track Foundry mint/render caps remain in tests | Phase 8 measurement required |
| Block Camera / PAGE.EXE / CARD.DRV / Operator | exact estimate + 10% for transactions | Phase 8 measurement required |
| Router Lab | `eth_call` only | confirm public-RPC acceptance |

The canonical launch tick-list is section F8 of [`docs/PRE_MAINNET_CHECKLIST.md`](../PRE_MAINNET_CHECKLIST.md). Do not replace missing live data with a neat-looking guess. Computers already produce enough fiction without our assistance.
