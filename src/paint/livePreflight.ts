import { hexToBytes } from 'viem'
import type { CanvasActivity } from './canvasStore'
import type { RegionUsage } from './split'

/**
 * Best-effort current-block region usage from Painted events this tab has already observed.
 * The contract remains authoritative. This intentionally avoids putting a 16-region RPC read
 * in front of every Live stroke on a chain whose block can change while that read is in flight.
 */
export function observedRegionUsage(
  activities: readonly CanvasActivity[],
  currentBlock: bigint,
): Map<number, RegionUsage> {
  const out = new Map<number, RegionUsage>()
  for (const activity of activities) {
    if (activity.eventName !== 'Painted' || activity.blockNumber !== currentBlock || !activity.runs) continue
    const bytes = hexToBytes(activity.runs)
    for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
      const y = bytes[offset]
      const x0 = bytes[offset + 1]
      const x1 = bytes[offset + 2]
      let x = x0
      while (x <= x1) {
        const region = (y >> 6) * 4 + (x >> 6)
        const end = Math.min(x1, ((region & 3) + 1) * 64 - 1)
        const count = end - x + 1
        const previous = out.get(region)?.pixels ?? 0
        out.set(region, { block: currentBlock, pixels: previous + count })
        x = end + 1
      }
    }
  }
  return out
}
