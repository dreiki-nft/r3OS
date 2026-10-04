import { useEffect, useState } from 'react'
import { publicClient } from '../chain/clients'
import { useRefreshTick } from '../chain/refreshTick'
import { R3OS_FINALE_AUCTION_ABI } from '../lib/generated/abi'
import { labAddress } from './labCommon'

/** True only while the newest finale auction is live onchain (state 1). Unknown or offline counts as false. */
export function auctionIsLive(count: bigint, latestState: number | undefined) {
  return count > 0n && latestState === 1
}

/**
 * Whether a finale auction is running right now, so the desktop can show the Auction icon only when there is
 * something to do there. Two small reads, refreshed every ~1,000 blocks; nothing runs when no auction exists.
 */
export function useAuctionLive() {
  const tick = useRefreshTick(1_000)
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (!publicClient) return
    const client = publicClient
    let cancelled = false
    void (async () => {
      const address = await labAddress('finale auction')
      const count = (await client.readContract({
        address,
        abi: R3OS_FINALE_AUCTION_ABI,
        functionName: 'auctionCount',
      })) as bigint
      let state: number | undefined
      if (count > 0n) {
        const info = (await client.readContract({
          address,
          abi: R3OS_FINALE_AUCTION_ABI,
          functionName: 'auctionInfo',
          args: [count],
        })) as { state?: number | bigint }
        state = info.state == null ? undefined : Number(info.state)
      }
      if (!cancelled) setLive(auctionIsLive(count, state))
    })().catch(() => {
      if (!cancelled) setLive(false)
    })
    return () => {
      cancelled = true
    }
  }, [tick])
  return live
}
