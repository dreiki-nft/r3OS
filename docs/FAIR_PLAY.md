# Fair play in r3OS events

r3OS is an open canvas: anyone can paint, with any number of wallets. Prize-bearing events (raffles, battles, leaderboards with rewards) add rules on top, and this page is how they are enforced. The numbers behind it are in [`SYBIL_REVIEW.md`](SYBIL_REVIEW.md).

## Rules for events with prizes

1. **One prize per person.** Wallets that belong to the same person count as one entrant. They keep the best place any of them earned, and receive one prize. Pro-rata payouts (like a war chest split by damage) are unaffected, because splitting the same work over several wallets never changes a pro-rata share.
2. **No bots.** Every stroke is chosen by a person. Live Mode, the app's drawing tools and holder budgets are fine. A script or program that sends paints on its own is not.
3. **Team and project wallets never win and are never ranked.** They are listed publicly in [`wallets.json`](wallets.json).
4. **Per-wallet rewards can have eligibility rules**, such as tickets or badges that every qualifying wallet gets. These are fixed and published before the event is announced, never changed during it.
5. **Using a bug to gain a reward** doesn't earn the reward. Report it instead; bug reports are rewarded separately.

## How fairness is checked

Before any payout, the event's paints are run through [`scripts/integrity-review.mjs`](../scripts/integrity-review.mjs). It reads only public data (the season replay file) and raises four kinds of flags:

| Signal | What it looks for | Flag when |
| --- | --- | --- |
| Rhythm | timing no person keeps up | 300+ paints with gaps more regular than a coefficient of variation of 0.25, or painting in 20+ different hours of a day on 2+ days |
| Farming | paints that mostly repaint the wallet's own still-wet pixels (1 budget unit, no heat), which inflates paint counts without changing the canvas | 2,000+ pixels and 60%+ of them own wet repaints |
| Pair | two wallets that look like one person | each has 10+ sessions, they never paint in the same minute, and they hand over to each other within 10 minutes 5+ times (storm overlap shown when known) |
| Minimal | throwaway wallets | 3 or fewer paints, all inside event windows |

**A flag is a lead, never a verdict.** High activity alone is never a flag. Neither is painting a lot, painting fast with Live Mode, or winning. The thresholds are in [`integrity-lib.mjs`](../scripts/integrity-lib.mjs) and are tested.

Then a person reviews every flag that touches a prize:

1. **Look at the evidence** in public data: the replay (when and what each wallet painted), how the wallets were funded (on the explorer), their history in earlier events.
2. **Decide only on solid ground.** That means at least two independent signals pointing the same way (for example, handovers plus a shared funding wallet), or direct evidence. One weak signal is not enough.
3. **Ask the participant first**, on Discord or X, when there is a way to reach them.
4. **Publish decisions, not suspicions.** The event's results list each decision: the wallet, the rule, and a one-line reason. Wallets that were reviewed and cleared are not named. The tool's output stays private (`integrity-out/` is gitignored).
5. **Appeals:** 72 hours after the results are published. A reversed decision is paid in full.
6. **Timing:** payouts go out within 72 hours of the end. If a review is still open, the delay is announced with the reason.

**Outcomes:** a bot loses its prize and its pro-rata share, and the share is redistributed to everyone else pro rata. Several wallets of one person are merged as one entrant and keep one prize. A team wallet is excluded.

## Reviews so far

- **AGENT.EXE (November 5–8, 2026).** One pair flag: two badge-holding wallets in the top four never painted in the same minute, handed over 13 times, and had caught exactly the same 20 storms in season 1. Merged, they would still have placed third, and the war chest is pro rata, so no one else was affected. No disqualification. One farming flag on a top wallet: its scribbling repaints its own wet pixels, which raises its paint count but not its damage or MON burned, the only things the battle paid for. Cleared.
- **Storm Season raffle (drawn November 9, 2026).** The winning wallet raised no flag. The draw itself is checked by [`scripts/raffle-verify.mjs`](../scripts/raffle-verify.mjs).
