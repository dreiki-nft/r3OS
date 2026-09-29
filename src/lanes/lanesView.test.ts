import { describe, expect, it } from 'vitest'
import type { Address, Hex } from 'viem'
import { blockDetails, mapLaneWindow, mergeLaneTxs } from './lanesView'
import type { LaneTx } from '../lib/lanes'

const A = '0x1000000000000000000000000000000000000001' as Address
const B = '0x2000000000000000000000000000000000000002' as Address

function tx(byte: string, blockNumber: bigint, region: number, owner: Address): LaneTx {
  return {
    txHash: `0x${byte.repeat(64)}` as Hex,
    blockNumber,
    firstLogIndex: 0,
    kinds: new Set(['paint']),
    owner,
    sender: owner,
    regionsMask: 1 << region,
    pixels: 12,
    corrupted: 2,
  }
}

describe('Lanes window mapping', () => {
  it('merges logs from one transaction across event sources', () => {
    const one = tx('9', 100n, 0, A)
    const two = { ...tx('9', 100n, 1, A), kinds: new Set(['quest'] as const), regionsMask: 0, pixels: 0 }
    const merged = mergeLaneTxs([one], [two as LaneTx])
    expect(merged).toHaveLength(1)
    expect([...merged[0].kinds]).toEqual(['paint', 'quest'])
  })

  it('maps fake events to lane marks', () => {
    const mapped = mapLaneWindow([tx('1', 100n, 3, A)], 100n, 100)
    expect(mapped.marks).toHaveLength(1)
    expect(mapped.marks[0]).toMatchObject({ blockNumber: 100n, lane: 3, kind: 'canvas' })
  })

  it('scrolls columns as the head advances', () => {
    const rows = [tx('1', 1n, 0, A), tx('2', 101n, 1, B)]
    expect(mapLaneWindow(rows, 100n, 100).from).toBe(1n)
    const next = mapLaneWindow(rows, 101n, 100)
    expect(next.from).toBe(2n)
    expect(next.marks.map((mark) => mark.blockNumber)).toEqual([101n])
  })

  it('builds block detail rows from fake data', () => {
    const mapped = mapLaneWindow([tx('1', 100n, 2, A), tx('2', 100n, 2, B)], 100n)
    const details = blockDetails(mapped.blocks.at(-1)!)
    expect(details).toHaveLength(2)
    expect(details[0]).toMatchObject({ action: 'paint', lanes: 'R2', pixels: 12, glitches: 2 })
    expect(details[0].conflicts).toBe(1)
  })
})
