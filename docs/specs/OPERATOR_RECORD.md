# Operator Record

`R3OSOperatorRecord` is an adminless, composable history primitive for r3OS. It does not award anything, compute a score, rank addresses or copy activity counters into new state. It reads objective facts from the contracts that already own them and stores only when a fact was first **observed** plus a prospective bitmap of paint seasons observed after the recorder exists.

The frontend registers it under the Paint experiment name `operator-record`.

## What the record means

There are two different kinds of time in this system:

- **exact first-use time** when an existing source contract already stores it;
- **first-observed time** when `record(address)` first saw a live predicate as true.

Only Paint's `firstPaintBlock` and CARD.DRV's `firstWriteBlock` are exact historical first-use blocks. For every other subsystem, `firstObservedBlock` means exactly that: the subsystem was demonstrably in use by that block. It does not claim the action first happened in that block.

`usedBefore(operator, subsystem, blockNumber)` therefore returns both `proven` and `exact`. A false result means “not proven by this record,” never “the address did not use it.”

## Retroactive, prospective and unsupported data

| Class | Data | Meaning |
|---|---|---|
| **A. Stored prospectively** | first-observed block per subsystem; paint seasons observed; first/last record block | Begins when Operator Record exists and somebody calls `record`. |
| **B. Derived from existing state** | all counters and last-block fields exposed by `facts`; exact first Paint block; exact first CARD.DRV write | Read live from the source contracts. No duplicate counter state is created. |
| **C. Bounded logs only, not used by this phase** | Block Camera capture count; CD burns; PAGE.EXE write count | These can exist in bounded event history, but Operator Record does not scan logs or pretend to have lifetime coverage. |
| **D. Not supported** | first boot; complete historical seasons painted before recording; off-chain activity | The chain does not contain a trustworthy per-address fact for these, so the UI does not invent one. |

## Subsystems

The 16 fixed v1 ids are listed below. Phase 7.6 does **not** reinterpret them: ids belonging to discontinued experiments remain reserved historical slots, and fresh mainnet passes zero source addresses for those slots. The frontend hides them from the current product surface.

| Id | Subsystem | Live predicate |
|---:|---|---|
| 0 | PAINT | `painterStats(operator).firstPaintBlock != 0` |
| 1 | FRAMES | `painterStats(operator).framesMinted >= 1` |
| 2 | PASS | `hasClaimed(operator)` |
| 3 | QUESTS | `completedCount(operator) >= 1` |
| 4 | FLIPBOOK | `painterInfo(operator).framesPainted >= 1` |
| 5 | WEEDS | plants or ticks >= 1 |
| 6 | FORKS | forks painted >= 1 or last fork block != 0 |
| 7 | BLOCK DNA | catches >= 1 |
| 8 | AUCTION | bids placed >= 1 |
| 9 | SLEEPWALKER | dreaming days >= 1 |
| 10 | RECYCLE BIN | burned count >= 1 |
| 11 | BLOCK CAMERA | last capture block != 0 |
| 12 | KERNEL DEBUGGER | process count >= 1 |
| 13 | PAGE.EXE | any word in the wallet page is non-zero |
| 14 | CARD.DRV | indexed card exists and its page is formatted |
| 15 | MONAD CARD | card balance >= 1; identity signal only, excluded from subsystem-use count |

Every source read is gas-capped. A missing, reverting, malformed or out-of-gas source is marked unanswered instead of reverting `facts`, `usedMask` or `record`.

## Recording

`record(operator)` is permissionless. The caller does not provide any facts. The contract re-reads the registered source contracts and can only set a subsystem bit whose live predicate is true.

For each newly true bit:

- the corresponding first-observed word is set to the current block;
- that word can never be moved earlier or later;
- the observed bit is never cleared even if a reversible source later becomes false.

This matters for PAGE.EXE: a wallet can write a page, be observed, then zero it. The live PAGE.EXE predicate becomes false again, but the historical observation remains.

Repeat calls do not make an address more significant. Once a subsystem bit is set, performing the same action again adds no new subsystem state.

`recordMany` performs the same operation for at most 32 addresses.

## Paint seasons observed

The recorder stores a 256-bit season bitmap prospectively.

For season `s`, `seasonFirstRecordBlock[s]` is the first block in which any record call ran during that season. An operator receives the bit only when its live `lastPaintBlock` is at or after that boundary.

This gives a sound proof that the operator painted during that season after recording was possible. It intentionally has false negatives: a paint made earlier in the season, before the first record call, is not credited unless the operator paints again later in the same season.

Seasons `>= 256` are not stored in this v1 bitmap.

## Storage layout

Each operator gets one 128-word aligned MIP-8 page:

```text
base = uint256(keccak256(abi.encode("r3tards.operator.record.v1", operator))) & ~uint256(127)

W0      magic "OPR1" << 224
        firstRecordBlock uint48 << 176
        lastRecordBlock  uint48 << 128
        observedMask     uint16 << 112

W1      seasonsObserved uint256 bitmap
W2-W15  reserved, zero
W16-W31 firstObservedBlock[0..15], uint48 stored in each word
W32-W127 reserved, zero
```

The contract performs assembly storage writes through one bounded slot helper only. Different operator pages are 128-aligned and are disjoint absent a keccak collision.

## Attribution

History belongs to the actor address represented by the source contracts.

Paint and Labs that support Paint session keys already resolve the session key to its owner. Labs that do not support session keys reject them. Operator Record therefore queries the owner address, not a session-key address, and does not add a second attribution layer.

Contract-wallet addresses are ordinary operators. Safe, ERC-4337 and 7702-style owners are not excluded. Because recording is permissionless, a contract wallet does not need to send a transaction merely to have an existing fact observed.

## Transfers

No historical fact follows a transferable NFT to its new holder. The record is keyed by the address that performed or owns the source-account state.

The MONAD CARD signal is different because CARD.DRV treats that card as the wallet's soulbound identity device. Operator Record does not infer identity from transferable Labs tokens.

## Sybil characteristics

These are observations about the signals, not policy:

- cheap per wallet among active sources: Pass, Quests, PAGE.EXE, Block Camera and recording itself;
- time-gated and difficult to compress: Paint `activeDays`, observed paint seasons and an old exact first-paint block;
- external and scarce: MONAD CARD.

The contract stores no aggregate score and no action counter. Repeating the same action cannot increase the observed subsystem mask.

## Privacy

There is no private profile. Source facts, Operator Record storage and `OperatorRecorded` events are public blockchain data. The UI states this directly.

## Future reads

A future contract can ask whether a historical fact was established by a particular block without depending on frontend state:

```solidity
(uint48 eventBlock) = SYSTEM_EVENT.activatedBlock();
(bool proven, bool exact) = OPERATOR_RECORD.usedBefore(operator, subsystemId, eventBlock);
```

`exact` must be respected. For most subsystems, the proof is “observed by this block,” not an exact first-use timestamp.

## Versioning policy: v1 is fixed

**Operator Record v1 represents the original 16 participation domains and is intentionally immutable as a historical primitive.**

- `SUBSYSTEM_COUNT = 16`, `IDENTITY_MASK = 1 << 15`, the `uint16 observedMask`, `uint48[16] firstObserved`, and the fixed-length loops are the v1 ABI. Ids 0–15 are all occupied and **never change meaning**.
- `usedBefore` and `firstObservedBlock` reject ids ≥ 16, and that is correct: there is no id 16 in v1.
- The page has unused physical words (W2–W15 and W32–W127). **Unused words are not permission to reinterpret the v1 ABI.** No later contract, frontend or document may assign meaning to them under the v1 name.
- **ROUTER is not retrofitted into v1.** Neither is any later program.
- A future extension, if one is ever justified, is a **separate companion contract with its own namespace and version** (for example an `OPERATOR-EXT-1` record keyed by the same operator address). Readers that want the full picture query v1 **plus** the extension contracts and label each fact with the record it came from.

Stable semantics are worth more than infinite extensibility: a v1 record read in five years must mean exactly what it means today.

## Measured (Monad-mode anvil, 2026-09-30)

- `record()` with every source live and all 16 bits new: about 658,000 gas (16 fresh words dominate). Later records that add nothing only rewrite the header word.
- `facts()` makes one gas-capped staticcall per source view (PAINT uses `painterStats` once plus `daysPainted`).
- `firstSeenBlock` ignores MONAD CARD: holding the identity card is not r3OS use.
