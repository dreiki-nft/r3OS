# Lanes UI spec

Phase 3/4 UI specification only. The estimator is implemented in `src/lib/lanes.ts`.

## Layout

Render **19 horizontal lanes** across roughly the last 100 blocks, about 30 seconds at Monad's 300 ms block target:

- lanes 0–15: the canvas's sixteen 64×64 regions;
- lane 16: Flipbook / reel storage;
- lane 17: frame and finale mints;
- lane 18: Lab actions for Forks, Block DNA Brushes, finale auctions, and Quests.

Weeds shares lanes 0–15 with the canvas region it ticks or plants. A brush verification appears on the Lab lane and on every canvas-region lane it reads. A brush catch is Lab-lane only. Fork actions are Lab-lane only. Auction and Quest actions are Lab-lane only.

Blocks scroll left in real time.

Each transaction appears in every lane it touched:

- **Independent:** solid cell.
- **Collided:** amber outline with a thin connector to each transaction it conflicts with.
- **Chord:** gold burst only when at least three distinct owners paint one canvas region in the same block.
- **Storm:** tint the whole block column.

Chords remain paint-only.

## Header counters

Show:

- app transactions in the last 10 seconds;
- estimated independent share;
- observed blocks per second;
- chords today.

Clicking a block column opens its transaction list: hash, owner, sender, lanes, pixels, corruptions, and estimated conflicts.

## Parallel-execution copy

Keep this wording accurate and modest:

> Estimated from this app's storage layout. Monad executes everything optimistically in parallel and re-runs what collides.

The UI must not claim to know Monad's actual executor schedule. Lanes visualizes conservative collision relationships implied by this app's known state access.

## Global sender rule

Two transactions with the same **known, non-zero sender** always collide in the estimator, regardless of app action, because they share that account's nonce and balance. Zero address means the sender is unknown and two unknown senders do not match merely because both are zero.

For `SeasonFinaleMinted`, the event exposes the recipient but not the caller. Keep `sender = 0x000…000`; the recipient is not assumed to be the sender.

## Collision model

Existing core rules remain:

- paint × paint: region masks overlap **or** same resolved owner;
- paint × mint: yes, because frame minting fingerprints the canvas;
- mint × mint: yes;
- flipbook × flipbook: yes, because same-block paints share the current frame slots;
- flipbook × reel: yes;
- reel × reel: yes;
- other core/Flipbook pairs: no unless the global same-sender rule applies.

### Weeds

- weeds × weeds: same region **or same resolved gardener owner**;
- weeds × paint: overlapping region masks, because Weeds reads the canvas soil that paint writes;
- weeds × everything else: no, absent the same-sender rule.

The same gardener can therefore collide across different regions even when actions arrive through different senders, because both update `_gardeners[owner]`.

### Forks

- fork × fork: same `forkId`, same resolved owner, **or both transactions create forks**;
- fork × everything else: no, absent the same-sender rule.

Two creations always collide because both increment the global `forkCount`, even for different creators and source frames. The owner rule is conservative because fork first-paint accounting and creator/painter state are per owner.

### Block DNA Brushes

- brush × brush: same resolved owner, because one owner box page is shared;
- brush verification × paint: region masks overlap, because verification reads those canvas regions;
- brush catch × paint: no canvas conflict because catches never read canvas pixels;
- brush × everything else: no, absent the same-sender rule.


### Finale auction

- auction × auction: same `auctionId`;
- auction × everything else: no, absent the same-sender rule or the Quest owner rule below.

A bid, settlement, or cancellation for one auction does not share auction storage with a different auction.

### Quests

A Quest claim collides with **any** app transaction attributed to the same resolved owner because the claim reads that owner's stats from the core/Labs and writes that owner's quest completion state. Different-owner Quest activity is otherwise Lab-local, subject to the global sender rule.

## Weeds "tick all 16"

**Tick all 16** sends 16 separate transactions, one per region. It's a convenience button. Transactions from one wallet share a nonce and balance, so Lanes shows them chained. The parallel picture appears when different people tick different regions in the same block, and that's what the Weeds page should point at.

## Finality animation

Feature-detect Monad's `monadLogs` subscription. Where supported:

- proposed transactions are hollow;
- voted transactions begin filling;
- finalized transactions are solid;
- supporting copy may say `Watch a block finalize in ~600 ms.`

If `monadLogs` is unavailable, use standard `logs` subscriptions. If subscriptions are unavailable, poll `eth_getLogs` in chunks of no more than 100 blocks. Never fake proposed/voted states when the RPC does not expose them.
