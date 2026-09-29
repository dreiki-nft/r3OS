# Finale Candle Auction

Phase 3 UI specification for `R3tardsFinaleAuction`.

## What this is

Season finales can be listed in a permissionless candle auction. Bidding remains open for 288,000 blocks, roughly 24 hours at Monad's target block time, but the real end is hidden somewhere inside the last 12,000 blocks. Nobody knows the exact end while bidding.

After `closeBlock`, `settle` uses the close block hash to draw the candle end. The winner is the **last standing bid at or before that drawn block**. A bid submitted later in the final hour can therefore be validly accepted by the contract yet turn out to have landed after the candle was already out.

The auction reads the close hash directly with `blockhash` for the first 256 blocks after close, then uses Monad's EIP-2935 history contract at `0x0000F90827F1C53a10cb7A02335B175320002935` while that hash remains inside the 8,191-block history window. If neither source can return the close hash, the contract deliberately falls back to **`candleStartBlock`**, never `closeBlock` and never a later hash. That means a missed settlement cannot hand the auction to a last-second bidder: only bids at or before the first possible candle block remain eligible.

## Auction screen

Show:

- reserve;
- current standing high bid and `minNextBid`;
- `startBlock`, `closeBlock`, and the final-hour `candleStartBlock`;
- a live candle bar across those final 12,000 blocks;
- bid history by block;
- whether the drawn end is known;
- settlement state, winner, price, royalty and fallback status.

The drawn end appears as soon as the close hash is readable through `previewEndBlock`. The site should still send `settle` promptly after close, but settlement is not limited to the native 256-block `blockhash` window: EIP-2935 extends close-hash recovery to 8,191 blocks. Anyone can settle, so this automation is convenience rather than authority. If that history is also missed, show the deterministic fallback end at `candleStartBlock`.

Copy next to bidding: **Your bid is locked until settlement.** Every deposit might turn out to be the winning historical bid, so losing deposits cannot be withdrawn early.

Also warn: **A bid placed during the final hour might land after the candle.** The bidder cannot know that until the close hash exists. If settlement misses all available close-hash history, every bid placed after `candleStartBlock` loses by definition.

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

### Settlement window and keeper

The frontend checks once whether Monad's EIP-2935 history-storage contract exists at `0x0000F90827F1C53a10cb7A02335B175320002935`.

While an auction is live it shows one of three settlement states:

1. **candle burning** before `closeBlock`;
2. **settle now** after close while the close-block hash is still available, including the remaining block/time estimate;
3. **random end expired** after the usable hash window, explicitly showing that settlement now uses `candleStartBlock` as the safe fallback end.

`previewEndBlock(auctionId)` remains the contract-authoritative drawn end. The UI does not reproduce the random draw.

Connected users may opt into **Settle for me when bidding closes**. The preference is stored per auction in localStorage. If the Auction window remains open when bidding closes, the frontend attempts `settle(auctionId)` once for that auction during the browser session. This is not unattended signing: the wallet still prompts.

`scripts/auction-keeper.sh <auction address> <auction id>` is the launch keeper. It uses `cast` with a Foundry keystore account, never a raw private key, simulates `settle` every two seconds, sends when the simulation succeeds, and exits once `auctionInfo().state` reports the auction settled.

## Seller flow

1. Pick a finale owned by the connected wallet.
2. Approve `R3tardsFinaleAuction` for that token.
3. Choose a non-zero reserve.
4. List immediately or choose a start block no more than 2,016,000 blocks, about seven days, ahead.

The auction contract has no owner or admin.

## Gas

Use `eth_estimateGas + 10%` for `list`, `bid`, `cancel`, `settle`, `withdraw`, and `withdrawCredits`, with a preflight call where useful. Monad charges against the submitted gas limit, so display the maximum MON cost before every wallet prompt.
