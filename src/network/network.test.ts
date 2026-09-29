import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import {
  appendHeader,
  backfillHeaders,
  framesByProducer,
  heartbeatPath,
  heartbeatPositions,
  producerColour,
  producerStats,
} from './network'

const A = '0x1000000000000000000000000000000000000001' as Address
const B = '0x2000000000000000000000000000000000000002' as Address

function header(number: number, miner = A, timestamp = number) {
  return { number: BigInt(number), timestamp: BigInt(timestamp), miner }
}

describe('producer window', () => {
  it('adds headers and drops the oldest past the window', () => {
    let rows = [header(1), header(2)]
    rows = appendHeader(rows, header(3), 2)
    expect(rows.map((row) => row.number)).toEqual([2n, 3n])
  })

  it('counts producers over the current window', () => {
    const stats = producerStats([header(1, A), header(2, B), header(3, A)])
    expect(stats[0]).toMatchObject({ address: A, blocks: 2, share: 2 / 3, lastBlock: 3n })
    expect(stats[1]).toMatchObject({ address: B, blocks: 1 })
  })
})

describe('backfill', () => {
  it('caps concurrent header requests at 8', async () => {
    let active = 0
    let peak = 0
    const client = {
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        active += 1
        peak = Math.max(peak, active)
        await Promise.resolve()
        active -= 1
        return { number: blockNumber, timestamp: blockNumber, miner: A }
      },
    }
    const rows = await backfillHeaders(client as never, 31n, 32, 8)
    expect(rows).toHaveLength(32)
    expect(peak).toBeLessThanOrEqual(8)
  })
})

describe('producer colour and frames', () => {
  it('is stable and never uses excluded black, white, brown or olive', () => {
    const colour = producerColour(A).toLowerCase()
    expect(producerColour(A).toLowerCase()).toBe(colour)
    expect(['#000000', '#ffffff', '#965e4b', '#877549']).not.toContain(colour)
  })

  it('counts frame proposers from frame info', () => {
    const fake = [{ proposer: A }, { proposer: B }, { proposer: A }] as any[]
    const counts = framesByProducer(fake)
    expect(counts.get(A.toLowerCase())).toBe(2)
    expect(counts.get(B.toLowerCase())).toBe(1)
  })
})

describe('heartbeat', () => {
  it('uses larger spacing for a slower block', () => {
    const positions = heartbeatPositions([header(1, A, 10), header(2, A, 10), header(3, A, 12)])
    expect(positions[1] - positions[0]).toBeLessThan(positions[2] - positions[1])
  })

  it('removes the animated spike shape for reduced motion', () => {
    const rows = [header(1, A, 10), header(2, A, 11)]
    expect(heartbeatPath(rows, false)).toContain('L10 6')
    expect(heartbeatPath(rows, true)).not.toContain(' 6')
  })
})
