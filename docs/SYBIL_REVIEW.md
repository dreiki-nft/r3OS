# Sybil and integrity review

What coordinated wallets can do to r3OS, what it costs them, and what to change before the next prize-bearing event. Every number comes from the Paint contract's rules and fees measured on mainnet. Rerun them with `node scripts/sybil-sim.mjs` (offline). The rules people play by are in [`FAIR_PLAY.md`](FAIR_PLAY.md).

**Contract rules that matter here** (R3OSPaint, mainnet values):
- **Budget per wallet:** a new wallet gets 512 units an hour, plus 32 for each active day, up to 2,048. A blank pixel or one's own wet pixel costs 1 unit; overwriting a dry pixel costs 2.
- **Tile heat**, shared by everyone on a 16×16 tile: +1 for a blank pixel, +2 for a dry one, at most 512, cooling 2 per block.
- **Region cap:** at most 512 changed pixels per 64×64 region per block.

Measured fees: about **0.03 MON per paint transaction** (season 2 human average), and 0.0021 MON to fund a fresh wallet. MON was about $0.0166.

## 1. Canvas griefing

Overwriting the whole painted canvas (65,536 dry pixels = 131,072 units):

| Fresh wallets | Time | Fees | |
| ---: | ---: | ---: | ---: |
| 10 | 25.6 hours | ~26 MON | ~$0.43 |
| 100 | 2.6 hours | ~26 MON | ~$0.43 |
| 1,000 | ~16 minutes | ~28 MON | ~$0.46 |

**The per-wallet budget is the only real brake, and wallets are free to make.** More wallets buy speed, not cost. Tile heat stops one spot being hammered in a single burst, but once a tile is hot it still accepts about 150 dry pixels a minute from everyone together. It limits hot spots; it doesn't stop griefing.

**The most exposed moment is the end of a season.** The finale NFT is the canvas at the season's last block, and nothing stops a last-minute wipe. The replay keeps every stroke, so nothing is ever lost from history, but the finale would be. Season 1 had no such attack. Options for a future Paint contract (the current one is immutable):
- take the finale from a **randomly chosen block in the last hour** (commit, then reveal), so nobody can aim at it;
- make dry overwrites cost more in the final hour.

## 2. Per-wallet rewards (raffle tickets, badges)

Storm Season gave 1 ticket per wallet per storm, for a single pixel. Against the 156 honest tickets:

| Throwaway wallets | Tickets | Chance to win | Cost |
| ---: | ---: | ---: | ---: |
| 10 | 210 | 57% | ~6 MON (~$0.10) |
| 100 | 2,100 | 93% | ~63 MON (~$1) |
| 1,000 | 21,000 | 99% | ~632 MON (~$10) |

**That is the weakest design r3OS has run.** The data shows nobody abused it: every one of the 22 ticket holders painted on at least 3 different days of the season (most on 9 or more), and no minimal or throwaway wallets show up. For next time:
- **Prefer rewards that splitting can't increase:** pro-rata shares, ranks by MON burned or damage, or pixels that changed the canvas.
- **When per-wallet rewards are worth having, set the eligibility before the announcement:** a wallet that painted on 3+ days before the event was announced, or holds a Painter Pass minted before it. This raises the cost from zero to days of preparation.
- **Run `scripts/integrity-review.mjs` before every draw** and apply the one-person rule.

## 3. AGENT.EXE

- **Prizes ranked by MON burned resist Sybils.** Splitting your damage across wallets only lowers each one's rank.
- **The pro-rata war chest is split-proof.** 1,000 damage in one wallet or 500 + 500 in two earns exactly the same.
- **Badges are per wallet.** They carry no money of their own, because the war chest is pro rata, so they're cosmetic but farmable.
- **Automation pays.** The chest paid 0.008 MON per damage pixel, while human fees ran about 0.003 MON per damage pixel (fees through November 7, scaled to the whole battle). That's roughly **2.7× back for every MON of fees**, so a script that breaks pixels around the clock would collect most of the chest. "No bots" therefore has to be enforced, and the rhythm signal plus the review in `FAIR_PLAY.md` are how. For the next battle, consider capping any one person's share of the chest (for example at 40%), or taxing each extra hour of damage on a falling scale.

## 4. Leaderboards by paint count

Repainting your own wet pixels costs 1 unit and no heat, so paint counts are cheap to inflate without changing the canvas. **Rank by pixels that changed the canvas, or by distinct pixels, not by transactions.** The farming signal measures exactly this. In the AGENT.EXE review it fired on a top wallet whose scribbling repainted its own pixels; that never touched its damage, so it was cleared.

## 5. The raffle contract

[`R3tardsRaffle`](../contracts/deployed/R3tardsRaffle.sol) is fair if it's run honestly, and [`scripts/raffle-verify.mjs`](../scripts/raffle-verify.mjs) checks that it was. Three trust points to remove in the next version:

1. **`finalizeSnapshot` stores the list's hash but doesn't check it.** Fix: compute a running hash while loading and require it to equal `snapshotHash` when finalizing.
2. **`recoverPrize` works after the random number has arrived**, so the owner could see the winner, pull the prize back and draw again. The checker catches it afterwards. Fix: only allow recovery before `requestDraw`, or only after a long timeout with the snapshot locked.
3. **`getDrawFee()` returns a fixed 0.6 MON**, while Pyth's fee was 1.4 MON at the draw. Fix: read `getFee(provider)` from Pyth Entropy and refund any excess.

## Before the next prize-bearing event

- [ ] Rewards chosen so splitting can't increase them, or per-wallet eligibility fixed and published before the announcement.
- [ ] `node scripts/sybil-sim.mjs` rerun with the event's numbers: prize size, expected entrants, MON price.
- [ ] Rules link to `FAIR_PLAY.md`.
- [ ] `node scripts/integrity-review.mjs` run on the event's paints before payouts. Every flag that touches a prize is reviewed by a person, and decisions are published.
- [ ] For draws: `node scripts/raffle-verify.mjs` with the event's record in `docs/raffles/`.
