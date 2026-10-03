import { describe, expect, it } from 'vitest'
import type { CanvasActivity } from './canvasStore'
import { observedRegionUsage } from './livePreflight'

function painted(blockNumber: bigint, runs: `0x${string}`): CanvasActivity {
  return { eventName: 'Painted', blockNumber, runs }
}

describe('Live Paint preflight', () => {
  it('counts only Painted runs from the current block and splits them at 64px region boundaries', () => {
    const items: CanvasActivity[] = [
      painted(10n, '0x003e410100404101'),
      painted(9n, '0x00000501'),
      { eventName: 'FrameMinted', blockNumber: 10n },
    ]
    const usage = observedRegionUsage(items, 10n)
    expect(usage.get(0)).toEqual({ block: 10n, pixels: 2 })
    expect(usage.get(1)).toEqual({ block: 10n, pixels: 4 })
    expect(usage.size).toBe(2)
  })
})
