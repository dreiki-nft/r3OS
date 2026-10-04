# Gas-limit policy

Phase 3 implementation specification. Monad charges `gasLimit × price`, including reverted transactions, so every wallet prompt must use a tight action-specific gas limit and show the maximum MON cost before signing.

## Flipbook paint

**Do not use `eth_estimateGas`.** A Flipbook transaction can land as either the first successful paint in a new block, which copies the carried frame, or as a later paint editing the already-created frame. The block used for estimation is not the block in which the transaction necessarily lands.

Use:

```ts
const FLIPBOOK_PAINT_GAS_LIMIT = 240_000n
```

This value comes from Monad-rule Foundry measurements with headroom. Re-measure it on Monad testnet before launch.

## Core paint

Use `eth_estimateGas`, then add deterministic DF1 corruption headroom before the final 10% margin. The transaction may land in a storm or under different crowd pressure than the estimation block.

```text
kMax = min(32, floor(px * 0.0198) + 1)
headroom = kMax * CORRUPTION_WRITE_GAS
limit = (estimate + headroom) * 1.10
```

Until testnet measurement replaces it, use:

```ts
const CORRUPTION_WRITE_GAS = 12_000n
```

Preflight with `eth_call` remains mandatory so user transactions do not intentionally enter known revert paths.

## Weeds

For `R3OSWeeds.tick(region)` and `plant(region, x, y, pattern)`, use `eth_estimateGas` plus **10%**. These actions do not have Flipbook's first-paint/new-frame ambiguity. Keep the usual `eth_call` preflight so known cooldown, region and `NothingPlanted` failures never become paid reverts.

## Other actions

For `mintFrame`, `paintAndMintFrame`, `mintReel`, `setFace`, `setBackground`, `startSession`, Painter Pass `claim`, and `setTokenRenderer`, use `eth_estimateGas` plus **10%**.

## Wallet UX

Before every wallet prompt, show the maximum possible fee in MON:

```text
max cost = gas limit × maxFeePerGas
```

Do not present gas-used estimates as the amount the user will necessarily be charged.

## Launch status: what still needs testnet data

Every number in this file is either a **local Monad-mode measurement** or a **policy**. None is a final production limit until it has been observed on Monad testnet. Before day-1 launch, record the gas-used distribution for each action below on testnet (fresh and repaint paths, storm and crowd conditions) and update the constant if the observed worst case is not comfortably inside it. The canonical tick-list is section F8 of [`docs/PRE_MAINNET_CHECKLIST.md`](../PRE_MAINNET_CHECKLIST.md).

| Action | Current policy | Status |
|---|---|---|
| Core paint | preflight simulation + `CORRUPTION_WRITE_GAS` headroom | TESTNET REQUIRED |
| Flipbook paint | fixed `FLIPBOOK_PAINT_GAS_LIMIT` = 240K | TESTNET REQUIRED |
| Fork paint | fixed 250K (local worst case about 200K) | TESTNET REQUIRED |
| Sleepwalker step | fixed 1,000,000 (local worst case about 820K) | TESTNET REQUIRED |
| Auction `list` / `bid` / `settle` / withdrawals | `eth_estimateGas` + 10% | TESTNET REQUIRED (record distributions, incl. settle via EIP-2935 and fallback) |
| Kernel Debugger `ping` / `run` | fixed 40K / 160K | TESTNET REQUIRED (with MIP-4 enforcement) |
| CARD.DRV write, Block Camera capture, Operator RECORD | `eth_estimateGas` + 10% (`estimate` kind; RECORD with all 16 bits new measured 658K locally) | TESTNET REQUIRED |
| ROUTER.EXE RUN | `eth_call` only, about 5.9M requested for 5 venues at 1M/frame | RESOLVED for mainnet adapters on a fork (2026-10-01); confirm public-RPC acceptance on testnet |

Do not replace a number here with a guess. If a value still lacks real data at launch, say so in the checklist rather than writing a final-looking figure.

## Forks

Fork `paint` uses a fixed gas limit and must **not** use `eth_estimateGas`:

```ts
const FORK_PAINT_GAS_LIMIT = 250_000n
```

The shared fork block budget and first-paint accounting depend on the block where the transaction lands. As with Flipbook, an estimate against one block is not a reliable prediction for the landing block. Fork runs are sorted by row so each storage row is loaded and written at most once; the measured worst case after that change is about **200K gas**. Keep the fixed 250K limit and re-measure it on Monad testnet.

Use `eth_estimateGas + 10%` for `forkFrame`, `forkFork`, `setOpen` and `seal`.

## Sleepwalker

`R3OSSleepwalker.step(owner)` uses a fixed gas limit:

```ts
const SLEEPWALKER_STEP_GAS_LIMIT = 1_000_000n
```

Do **not** estimate it per step. A ready step can start the next pre-signed session, slice up to 64 stencil pixels, call the core paint path, update dream accounting and pay a tip. In-test Foundry benchmarks (about 505K) under-count it because storage is already warm in a test. A real fresh transaction on a local chain cost **675K** for a step that completed a 61 px dream and refunded the deposit, with Ethereum pricing; Monad-rules cold measurements run about 1.2× Ethereum on this path, so the real worst case is about 820K before a session start. The limit is therefore **1,000,000**. **TESTNET REQUIRED:** re-measure the worst path (session start + 64 px + completion + refund) on Monad testnet and tighten it.

`step` wraps the core paint in try/catch, so `eth_estimateGas` is **not** safe here: the estimator finds a lower limit at which the inner paint fails and the step returns `CoreRejected` without painting. Tips should cover the cranker's max cost (`SLEEPWALKER_STEP_GAS_LIMIT × maxFeePerGas`), or nobody will crank. A failed readiness gate is a view/preflight concern and should not be intentionally submitted as a paid transaction.

Use `eth_estimateGas + 10%` for `sleep`, `wake` and `mintDream`; those actions are user-driven setup/cleanup rather than cranker hot paths.

## Block DNA Brushes

Use `eth_estimateGas + 10%` for `catchBrush` and `verify`. Stamping a brush is a normal core `paint`, so it uses the core-paint policy, including DF1 corruption headroom and the final 10% margin.

The UI should preflight verification against the already-rendered live canvas so an obviously overwritten brush does not become a paid revert.

## Finale auction

Use `eth_estimateGas + 10%` for `list`, `bid`, `cancel`, `settle`, `withdraw` and `withdrawCredits`. Settlement cost grows only logarithmically with bid count for winner lookup; real testnet distributions are still **TESTNET REQUIRED**. Bid deposits are value, not gas, and remain locked until settlement.

## Quests

Use `eth_estimateGas + 10%` for `claim`. Each condition staticcall is capped at 150K inside the contract. `addQuest` is an owner/admin authoring action rather than an end-user transaction, but should still be estimated tightly because Monad charges by submitted gas limit.

## Recycle Bin

Use `eth_estimateGas + 10%` for `recycle(ids)`. Cost scales with the number of frames (1–50), so quote the exact submitted list rather than using a blanket batch limit. A direct `safeTransferFrom` drop is quoted as the core ERC-721 transfer transaction; the Bin receiver callback burns and records the frame inside that same transaction.

## CD Burner

Use `eth_estimateGas + 10%` for `burnCD(frameIds, label)`. Minting samples the top-left pixel of every 8 × 8 source block, keeps only compact per-track metadata plus colour pairs, and writes one small `FrameStore` snapshot. Cost still scales with the submitted 1–12 tracks, so quote the exact list.

The 12-track Foundry regression target is **≤ 3.5M gas** (measured 3.1M). `tokenURI` is a view call; the full 12-track Labs `tokenURI` has a separate **≤ 9M gas** regression target (measured 8.3M, under the 14M Lab gas cap).


## Kernel Debugger

`R3OSKernelDebugger.ping()` and `run()` deliberately use fixed limits and **must not** use `eth_estimateGas`:

```ts
const KERNEL_PING_GAS = 40_000n
const KERNEL_RUN_GAS = 160_000n
```

The process key creates the meaningful reserve context by sending `ping` and `run` back-to-back with consecutive nonces. Estimating `run` in isolation simulates an emptying transaction and may choose the wrong branch. The UI therefore quotes fees from the fixed limit and the current max fee.

`BURST NAIVE` is intentionally a possible revert path. The user must be warned before submission that Monad charges the submitted gas limit even when the chain rejects the uncorrected reserve dip at transaction end. `BURST GRACEFUL` uses the same fixed limit but refunds/unwinds value when the reserve device reports a dip.

PAGE.EXE `writePage` and Block Camera `capture` use the normal `eth_estimateGas + 10%` policy. PAGE.EXE benchmark writes are `eth_call` measurements that always revert with `BenchWriteResult` and are never wallet transactions.