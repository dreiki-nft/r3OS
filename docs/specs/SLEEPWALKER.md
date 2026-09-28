# Sleepwalker Lab

Sleepwalker lets a painter hand the canvas a stencil before bed and let other players crank that stencil onto the real canvas overnight.

It has no privileged paint path. **No Lab has special powers over the canvas; Sleepwalker only paints through your own signed session, with your own budget.** Every successful step is an ordinary `R3tardsPaint.paint` call made by a deterministic session-key clone that the owner authorized with the core's normal EIP-712 `StartSession` signature.

## The rule: paint to dream

Sleepwalker separates today's core pixel count into:

```text
human pixels today = core pixelsToday(owner) - Sleepwalker dream pixels today
```

A step is allowed only after the owner has already painted at least `MIN_PIXELS_FOR_ACTIVE_DAY` non-Sleepwalker pixels during the current UTC day. Dream paint therefore cannot be the paint that creates an active day.

Once the gate is open, today's dream allowance is:

```text
dream allowance = 2 × human pixels today - dream pixels today
```

`DREAM_RATIO` is 2. If the owner paints 20 pixels by hand, at most 40 successful dream pixels can land that UTC day. At UTC midnight both the core's `pixelsToday` view and Sleepwalker's daily dream counter roll to zero; another human paint is required before the dream can continue.

A UTC day is counted as a **dreaming day** the first time a Sleepwalker step successfully changes at least one core pixel that day.

## Deterministic session key

Each owner has one predictable EIP-1167 clone address:

```text
keyOf(owner)
```

The clone salt is the owner's address. The clone is deployed lazily by `sleep`, so the site can compute its address before any transaction and ask the owner to sign sessions for that exact address.

`SleepwalkerKey` accepts calls only from `R3tardsSleepwalker`. Its two operational actions are:

- `start(...)` → `R3tardsPaint.startSession(owner, key, ...)`;
- `paint(runs, holderIds)` → `R3tardsPaint.paint(runs, holderIds)`.

The Lab checks `sessionInfo(key)` before every paint. It never calls `key.paint` unless the core reports an active session whose owner is the sleeper. This matters because an expired/revoked core session key becomes a normal wallet again; painting from it without an active session would incorrectly create painter history for the key itself.

## Going to sleep

```solidity
sleep(stencilRuns, holderIds, sessions, tipPerStep) payable
```

### Stencil

The stencil uses the frozen core's 4-byte run format:

```text
[y, x0, x1, colour]
```

Sleepwalker applies the same coordinate/colour validity rules as the core and adds a stricter dream cap of **4,096 submitted pixels**. The complete run blob is stored once in an SSTORE2-style immutable data contract through the existing `FrameStore` helper.

The stored `holderIds` are the optional r3tard IDs whose normal daily quota the owner wants the core paint call to use. `sleep` asks `budgetOf` to validate ownership and duplicate IDs up front; the core validates them again on every actual paint, so transferring a listed NFT overnight can make a later step return a budget/core failure instead of bypassing ownership.

### Pre-signed sessions

A dream stores 1–4 normal core `StartSession` authorizations. For each authorization the owner signs:

- `owner`;
- the deterministic Sleepwalker key;
- `expiryBlock`;
- `maxUnits`;
- `nonce`;
- `deadline`.

The first nonce must equal `core.sessionNonces(owner)` and later nonces must be consecutive. The first expiry must be inside the core's `MAX_SESSION_BLOCKS` window. Every later expiry is exactly `MAX_SESSION_BLOCKS` after the previous expiry. With Monad's target block time, one maximum session is about two hours and four cover about eight hours.

`sleep` deploys the clone if necessary and starts session 1 immediately through the clone. A later session is not started while the key's current session is active. Once the current session expires, `step` starts the next authorization only when:

- its nonce equals the core's current session nonce;
- its expiry is now inside the core's allowed start window;
- it has not expired by block or deadline.

If ordinary Live Mode consumed one or more nonces during the night, Sleepwalker skips stored authorizations whose nonce is now stale. It never rewinds or fabricates a nonce.

If nobody cranks during an entire expected session window, the next stored authorization is now ahead of the core's current nonce. The dream becomes **stalled** instead of wasting transactions on a permanent nonce gap. The owner can either `wake()` or call `resume(sessions[])` with fresh consecutive signatures. Resume keeps the stencil cursor, dream counters and deposit.

### Deposit and tips

`msg.value` is the owner's tip deposit. `tipPerStep` must be non-zero. A cranker gets exactly `tipPerStep` only after a successful core paint and only when the remaining deposit covers it. A failed readiness gate or reverted core paint pays nothing and does not advance the stencil.

Sleepwalker is adminless. No owner or operator can seize, redirect or edit another sleeper's deposit or dream.

## `step(owner)`

Anyone can crank a sleeper. The function returns a `StepCode` plus optional raw core revert data and emits the same status through `StepResult`.

Normal not-ready conditions return rather than revert:

- `NoDream` — the owner is not sleeping;
- `NoSession` — no active/usable signed session is available yet;
- `Stalled` — an expected session window was missed, so fresh owner signatures are required;
- `NotPaintedToday` — human pixels are below the core active-day threshold;
- `Allowance` — today's 2× dream allowance is used;
- `Pace` — fewer than `MIN_STEP_BLOCKS = 100` blocks have passed since this owner's last successful step;
- `Budget` — the core reports no spendable hourly/holder budget, or the stored holder IDs are no longer valid;
- `CoreRejected` — `key.paint` reverted, with the raw revert bytes included for UI-friendly decoding.

A ready step:

1. ensures the deterministic key has an active owner session, starting the next stored authorization when necessary;
2. checks the human-day gate and 2× allowance;
3. checks the 100-block pace window;
4. reads the owner's live core budget;
5. takes whole stencil runs from the cursor, splitting the final run when needed, up to the smallest of:
   - remaining dream allowance;
   - `STEP_MAX_PX = 64`;
   - half the core's reported available units;
   - half the active session's remaining units.

The `/ 2` caps are deliberate: repainting dry non-background pixels costs two core units per changed pixel. Sizing chunks for that worst case prevents a low-budget dream from retrying the same oversized chunk forever.
6. calls `core.paint` through the active key;
7. measures the exact before/after `painterStats(owner).pixelsToday` delta and records only that delta as dream pixels;
8. advances the stencil cursor across the submitted chunk, records the successful caller, and counts the dreaming day if needed;
9. pays the caller's tip if the deposit covers it.

`Dreamt(owner, cursorFrom, cursorTo, pixels, blockNumber)` records every successful step. `pixels` is the exact core `pixelsToday` delta, while the cursor advances across the submitted stencil chunk. This distinction matters when the core protects outline pixels or otherwise writes fewer pixels than were submitted.

`step` uses a fixed **1,000,000 gas limit** in the frontend/cranker path (not an estimate, because of the try/catch around the core paint). See `GAS_LIMITS.md`.

## Completion and wake

When the cursor reaches the end, Sleepwalker emits `DreamComplete`, marks the owner as no longer sleeping, deletes every unused signed session and stored holder ID, and attempts to refund the remaining tip deposit. A rejecting owner cannot block completion: failed pushes are credited to `refunds(owner)` and can later be pulled with `withdrawRefund()`.

The completed stencil pointer and its counters remain until the owner mints the Dream NFT, explicitly calls `wake`, or starts another dream. This is the one intentional difference between automatic completion cleanup and manual wake: it preserves enough immutable data to mint after `DreamComplete`.

`wake()` is owner-only. It:

- deletes the stencil reference and current dream state;
- deletes every unused signature;
- deletes the stored holder IDs;
- refunds the remaining deposit.

The Lab cannot revoke the currently active core session because `R3tardsPaint.revokeSession` is owner-only. The 3c UI therefore revokes the key from the owner's wallet **before** calling `wake`. Even if the user calls `wake` alone, Sleepwalker has deleted the signatures and state and will never call that key again.

## Views

### `dreamOf(owner)`

Returns:

- immutable stencil pointer;
- current pixel cursor;
- total stencil pixels;
- remaining tip deposit;
- tip per successful step;
- unused stored sessions;
- earliest block for the next paced step;
- whether the dream is stalled.

### `allowanceOf(owner)`

Returns:

- human pixels today;
- Sleepwalker dream pixels today;
- remaining 2× allowance;
- whether today's human-paint gate is open.

### `stepReady(owners[])`

Batch-friendly Night Shift view. It mirrors every normal early exit in `step`: no dream, stalled, no startable session, day gate, allowance, pace, conservative budget/session-unit chunk capacity and completion. It performs no writes and starts no session.

### `dreamingDays(owner)` and Pass stamp

`dreamingDays` is lifetime state. The Pass stamp is:

```text
DREAMING DAYS N
```

and is earned once `N >= 1`.

## Dream NFTs

Sleepwalker is an `ILabTokenSource`. It mints through the shared `R3tardsLabs` collection using its bound core experiment ID.

`mintDream()` is owner-only and can be used once per dream:

- while the owner is still sleeping, before `wake`; or
- after `DreamComplete`, while the completed stencil is retained.

The NFT snapshots:

- successful dream pixels;
- successful steps;
- sessions actually started (`Nights`);
- distinct successful step callers (`Helpers`);
- whether the stencil was complete;
- the owner's lifetime dreaming-day count at mint;
- survival at mint;
- stencil colour statistics.

The token remains valid after `wake`. Dream tokens are burnable through `R3tardsLabs`.

### Survival sampling

At mint, Sleepwalker samples `min(128, stencilPixels)` evenly spaced pixel ordinals across the stencil, including its ends when there is more than one sample. Each sample compares the stencil colour with `core.pixelAt(core.currentSeason(), x, y)`.

The immutable `Survived at mint` trait is:

- **Intact** — at least 90% of samples match;
- **Scarred** — 50–89% match;
- **Ghost** — below 50% match.

The NFT image is a cropped onchain SVG of the stencil. Base runs use the core palette. Sampled pixels that failed survival are overlaid in DF1 cyan `#5feddf` at 35% opacity. The mismatch sample mask is frozen at mint, so later canvas changes do not rewrite the Dream NFT.

### Dream traits

The Lab source returns these type-specific traits to `R3tardsLabs`:

| Trait | Values |
|---|---|
| Pixels dreamt | number |
| Size | Nap (<256) · Dream (256–1,023) · Epic dream (1,024+) |
| Nights | sessions actually started |
| Steps | successful step count |
| Helpers | distinct successful step callers |
| Night shift | Alone (0–1) · Helped (2–5) · Crowd (6+) |
| Complete | yes · no |
| Dreaming days | owner's lifetime total at mint |
| Survived at mint | Intact (≥90%) · Scarred (50–89%) · Ghost (<50%) |

`dominantColour` and `coloursUsed` come from the stencil and feed the common Labs traits.

## 3c r3tardOS window

### Intro bar

Lead:

> Your drawing paints itself while you sleep. You have to paint to dream: every pixel you paint by hand earns 2 dream pixels.

On Monad:

> every step is a real transaction, cranked by other players for tips; 3 blocks a second makes the replay look drawn, not stepped.

**How it works** shows four rules:

1. paint enough by hand today to open the day gate;
2. every human pixel earns two dream pixels for that UTC day;
3. pre-sign 1–4 roughly two-hour sessions before bed;
4. crankers earn the configured tip only when a step actually paints.

### Tonight

Paint's File menu gets **Dream this…**. It hands the current pending drawing to Sleepwalker as stencil runs instead of painting them immediately.

The Tonight tab shows:

- human pixels today;
- remaining dream allowance;
- 1–4 session count;
- tip per step;
- tip deposit;
- **Go to sleep**.

Before **Go to sleep**, if the previous dream is complete but its Dream NFT was not minted, warn: **"sleeping again discards the mint option for your last dream"**.

The setup signs every session for `keyOf(owner)` before calling `sleep`.

### Morning

Replay `Dreamt` events in block order so the stencil fills step by step. Show:

- current replay/cursor progress;
- `X% of your dream survived`, computed in the browser against the live canvas;
- lifetime dreaming days;
- Dream NFT mint state;
- if stalled: **"Your dream stopped at block N: nobody stepped for 2 hours. Resume with new signatures, or wake up"**;
- if `refunds(owner) > 0`, the pending refund and a **Withdraw** button;
- **Wake up**.

A stalled dream can call `resume(sessions[])` without losing progress. **Withdraw** calls `withdrawRefund()`. Wake up revokes the active key from the owner's wallet first, then calls `wake()` to delete unused signatures and refund the remaining deposit.

### Night Shift

The Night Shift tab batches `stepReady(owners[])` and shows sleepers that can currently be cranked, their tip, and a **Step** button.

When ordinary Live Mode is active, the UI may offer an opt-in **help sleepers while I paint** toggle. The local burner may submit `Sleepwalker.step(owner)` calls for tips, but it gets no special Sleepwalker authority: `step` is permissionless for everyone.

Use the normal r3tardOS 98 neutral chrome and DF1 cyan selection. No purple UI chrome.
