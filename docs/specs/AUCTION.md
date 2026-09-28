# Finale Candle Auction

Phase 3 UI specification for `R3tardsFinaleAuction`.

## What this is

Season finales can be listed in a permissionless candle auction. Bidding remains open for 288,000 blocks, roughly 24 hours at Monad's target block time, but the real end is hidden somewhere inside the last 12,000 blocks. Nobody knows the exact end while bidding.

After `closeBlock`, `settle` uses the close block hash to draw the candle end. The winner is the **last standing bid at or before that drawn block**. A bid submitted later in the final hour can therefore be validly accepted by the contract yet turn out to have landed after the candle was already out.

If nobody settles while the close block hash is still available, the contract deliberately falls back to `closeBlock`. It never uses a later hash that a settler could choose by waiting.

## Auction screen

Show:

- reserve;
- current standing high bid and `minNextBid`;
- `startBlock`, `closeBlock`, and the final-hour `candleStartBlock`;
- a live candle bar across those final 12,000 blocks;
- bid history by block;
- whether the drawn end is known;
- settlement state, winner, price, royalty and fallback status.

The drawn end appears as soon as the block after `closeBlock` is available through `previewEndBlock`. During the reveal window the site should send `settle` immediately after the close. Anyone can settle, so this automation is convenience rather than authority.

Copy next to bidding: **Your bid is locked until settlement.** Every deposit might turn out to be the winning historical bid, so losing deposits cannot be withdrawn early.

Also warn: **A bid placed during the final hour might land after the candle.** The bidder cannot know that until the close hash exists.

## Bidding

Bids are top-ups, not replacement payments. The user's standing bid is `depositOf(auctionId, account) + msg.value`.

The first bid must meet reserve. Every later standing bid must be at least 5% above the current highest, rounded up. The current leader may top up under the same rule.

Show the exact minimum before opening the wallet.

## Settlement and withdrawals

After settlement:

- the winning historical amount pays for the finale;
- any winner top-up submitted after the candle remains withdrawable;
- every losing bidder withdraws their full deposit;
- seller and royalty payouts use `withdrawCredits`;
- if no bid existed at or before the candle, the finale returns to the seller.

Expose separate **Withdraw bid** and **Withdraw proceeds** controls when balances are non-zero.

## Seller flow

1. Pick a finale owned by the connected wallet.
2. Approve `R3tardsFinaleAuction` for that token.
3. Choose a non-zero reserve.
4. List immediately or choose a start block no more than 2,016,000 blocks, about seven days, ahead.

The auction contract has no owner or admin.

## Gas

Use `eth_estimateGas + 10%` for `list`, `bid`, `cancel`, `settle`, `withdraw`, and `withdrawCredits`, with a preflight call where useful. Monad charges against the submitted gas limit, so display the maximum MON cost before every wallet prompt.
