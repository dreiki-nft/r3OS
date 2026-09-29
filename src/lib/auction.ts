import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'

export const BIDDING_BLOCKS = 288_000n
export const CANDLE_BLOCKS = 12_000n
export const MIN_RAISE_BPS = 500n
export const REVEAL_WINDOW = 256n
export const HISTORY_WINDOW = 8_191n
export const HISTORY_STORAGE_ADDRESS = '0x0000F90827F1C53a10cb7A02335B175320002935' as Address

export function minNextBid(reserve: bigint, highest: bigint, hasBids: boolean): bigint {
  if (!hasBids) return reserve
  const raise = (highest * MIN_RAISE_BPS + 9_999n) / 10_000n
  return highest + raise
}

export function candleEndBlock(closeBlockHash: Hex, auctionId: bigint, closeBlock: bigint): bigint {
  const entropy = BigInt(
    keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [closeBlockHash, auctionId])),
  )
  return closeBlock - (entropy % CANDLE_BLOCKS)
}

export interface AuctionBid {
  bidder: Address
  blockNumber: bigint
  total: bigint
}

export function winnerAt(bids: readonly AuctionBid[], endBlock: bigint): AuctionBid | null {
  let lo = 0
  let hi = bids.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (bids[mid].blockNumber <= endBlock) lo = mid + 1
    else hi = mid
  }
  return lo === 0 ? null : bids[lo - 1]
}

export function candleWindow(startBlock: bigint): { closeBlock: bigint; candleStartBlock: bigint } {
  const closeBlock = startBlock + BIDDING_BLOCKS - 1n
  return { closeBlock, candleStartBlock: closeBlock - CANDLE_BLOCKS + 1n }
}

export type AuctionSettleWindow = {
  state: 'burning' | 'random' | 'fallback'
  randomUntil: bigint
  blocksLeft: bigint
  fallbackEnd: bigint
}

export function auctionSettleWindow(
  closeBlock: bigint,
  head: bigint,
  historyAvailable: boolean,
): AuctionSettleWindow {
  const randomUntil = closeBlock + (historyAvailable ? HISTORY_WINDOW : REVEAL_WINDOW)
  const fallbackEnd = closeBlock - CANDLE_BLOCKS + 1n
  if (head <= closeBlock) return { state: 'burning', randomUntil, blocksLeft: 0n, fallbackEnd }
  if (head <= randomUntil) {
    return { state: 'random', randomUntil, blocksLeft: randomUntil - head, fallbackEnd }
  }
  return { state: 'fallback', randomUntil, blocksLeft: 0n, fallbackEnd }
}
