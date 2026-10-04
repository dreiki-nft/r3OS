# Quests

`R3OSQuests` provides small, display-only onchain goals. Each quest has one to four immutable conditions that read one ABI word from Paint or another configured contract for the resolved painter address.

The quest owner is append-only through `Ownable2Step`: it can add quests but cannot edit, remove, revoke or retroactively complete an existing quest. Quests grant no Paint budget, NFT permission, token entitlement or economic advantage.

Claims are explicit transactions. Once claimed, completion is stored as one bit so Painter Pass can expose `QUESTS n` without re-running every condition during `tokenURI`. Active Paint session keys may claim for their resolved owner.

## Board

For each quest the UI shows name, optional block window, conditions, current values, pass/fail state, completion and claimability. `claimable(account)` is used for highlighting. Claim-all is a sequence of ordinary `claim(questId)` transactions, not a hidden batch transaction.

## Fresh-mainnet base quests

| # | Quest | Goal |
|---:|---|---|
| 0 | MONTH IN | 30 active Paint days |
| 1 | STORM REGULAR | 50 storm paints |
| 2 | LIVE WIRE | 500 session paints |
| 3 | 10K PIXELS | 10,000 total Paint pixels |
| 4 | ARCHIVIST | 10 Paint frames minted |
| 5 | PADDLE UP | place at least one finale-auction bid |
| 6 | RECYCLER | burn 100 frames through Recycle Bin |

All base quests are unbounded in block time.

## CARD CARRIER

`DeployMonadCard.s.sol` appends **CARD CARRIER** after the base suite, making it quest id **7** in a canonical fresh deployment. It has two conditions:

1. configured Monad Card `balanceOf(painter) >= 1`;
2. Paint `painterStats(painter)` word 2 (`totalPixelsPainted`) >= 143.

So the requirement is: **hold a Monad Card and paint 143 pixels**. Testnet points to `MockMonadCard`; mainnet uses the official card contract.

## Painter Pass

After the first completed quest, the live external Pass stamp is `QUESTS 1`; the number rises with lifetime completions. It is presentation-only.

## Gas and failure isolation

Claims use the normal exact-action `eth_estimateGas + 10%` policy. Each condition is a gas-capped `staticcall` that copies only one requested 32-byte return word. Reverting, missing, malformed, oversized or gas-burning targets fail the condition rather than creating an unbounded callback or bricking unrelated reads.
