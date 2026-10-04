# Quests

Phase 3 UI specification for `R3OSQuests`.

## Model

Quests are small display-only goals. Each quest has one to four immutable conditions that read one ABI word from the core or a Lab contract for the resolved painter address.

The quest owner is append-only through `Ownable2Step`: it can add new quests, including later-season goals, but can never edit, remove or revoke an existing quest. Quests grant no paint budget, NFT permission, token entitlement, or other advantage.

Claims are explicit transactions. Once claimed, completion is stored as one bit, which lets the Painter Pass show a cheap `QUESTS n` badge instead of performing thirteen cross-contract checks inside `tokenURI`.

Active core session keys may claim for their owner.

## Board

For every quest show:

- name;
- active block window, if bounded;
- every condition with its threshold;
- the current value from `progress`;
- a per-condition progress bar and pass/fail state;
- completed state;
- claim availability.

Use `claimable(account)` to highlight immediately claimable quests. A **claim all** action is a sequence of separate `claim(questId)` transactions, not one bundled contract call.

## Day-1 quests

| # | Quest | Goal |
|---:|---|---|
| 0 | MONTH IN | 30 active core days |
| 1 | STORM REGULAR | 50 storm paints |
| 2 | LIVE WIRE | 500 session paints |
| 3 | 10K PIXELS | 10,000 total core pixels |
| 4 | ARCHIVIST | 10 core frames minted |
| 5 | ANIMATOR | 100 Flipbook frames painted |
| 6 | REEL MAKER | own at least one Flipbook reel |
| 7 | GREEN THUMB | 25 Weeds plants |
| 8 | TIMELINES | paint 10 distinct forks |
| 9 | DNA HUNTER | 10 lifetime verified Block DNA brushes |
| 10 | LAB RAT | earn FLIPBOOK, GARDENER, FORKER and BLOCK DNA stamps |
| 11 | PADDLE UP | place at least one finale-auction bid |
| 12 | RECYCLER | burn 100 frames through the Recycle Bin |

All day-1 quests are unbounded in block time.

## Painter Pass

After the first completed quest, the live Pass stamp is `QUESTS 1`; it increments with lifetime quest completions. The stamp is display-only.

## Gas and errors

Use `eth_estimateGas + 10%` for claims. If a condition target reverts, returns too little data, or exhausts its 150K condition gas cap, that condition simply evaluates as not met and the claim reverts with `ConditionNotMet`.


## CARD CARRIER

`DeployMonadCard.s.sol` appends **CARD CARRIER** after the base suite; with the current deployment it is quest id 13 and is not part of `Deploy.s.sol`'s day-one quest list. It is unbounded in block time and has two conditions:

1. the configured Monad Card contract `balanceOf(painter)` return word 0 is at least 1;
2. `R3OSPaint.painterStats(painter)` return word 2 (`totalPixelsPainted`) is at least 143.

The quest therefore means: **hold a Monad Card and paint 143 pixels**. On testnet the first condition points to `MockMonadCard`; mainnet uses the official card address supplied to CARD.DRV.