import { describe, expect, it } from 'vitest'
import {
  agoLabel,
  mergeStrokes,
  regionBoxes,
  strokeFromActivity,
  strokeFromRuns,
  summarize,
  windowLabel,
  type Stroke,
} from './presence'

const stroke = (owner: string, block: bigint, pixels = 4, key = `${owner}:${block}`): Stroke => ({
  key,
  owner,
  block,
  pixels,
  box: { x0: 0, y0: 0, x1: 1, y1: 1 },
})

describe('presence', () => {
  it('measures a stroke from its runs (y, x0, x1, colour)', () => {
    const runs = new Uint8Array([10, 5, 9, 3, 12, 7, 7, 3])
    expect(strokeFromRuns(runs)).toEqual({ pixels: 6, box: { x0: 5, y0: 10, x1: 9, y1: 12 } })
    expect(strokeFromRuns(new Uint8Array())).toBeUndefined()
    expect(strokeFromRuns(new Uint8Array([1, 9, 2, 3]))).toBeUndefined()
  })

  it('counts different wallets and pixels inside the window only', () => {
    const rows = [stroke('a', 990n), stroke('a', 995n), stroke('b', 1_000n, 10), stroke('c', 10n, 99)]
    expect(summarize(rows, 1_000n, 100n)).toEqual({ painters: 2, pixels: 18, strokes: 3 })
    expect(summarize(rows, 1_000n, 1n)).toEqual({ painters: 1, pixels: 10, strokes: 1 })
    expect(summarize([], 1_000n)).toEqual({ painters: 0, pixels: 0, strokes: 0 })
  })

  it('merges live and look-back strokes without duplicates, newest first', () => {
    const merged = mergeStrokes(
      [stroke('a', 5n, 1, 'x'), stroke('b', 7n)],
      [stroke('a', 5n, 1, 'x'), stroke('c', 9n)],
    )
    expect(merged.map((row) => row.owner)).toEqual(['c', 'b', 'a'])
    expect(mergeStrokes([], [stroke('a', 1n), stroke('b', 2n), stroke('c', 3n)], 2)).toHaveLength(2)
  })

  it('turns a Painted activity into a stroke with a lower-cased owner', () => {
    const row = strokeFromActivity({
      eventName: 'Painted',
      owner: '0xABCDEF0000000000000000000000000000000001',
      runs: '0x0a050903',
      blockNumber: 42n,
      logIndex: 3,
      transactionHash: '0x01',
    })
    expect(row).toMatchObject({
      owner: '0xabcdef0000000000000000000000000000000001',
      pixels: 5,
      key: '0x01:3',
    })
    expect(strokeFromActivity({ eventName: 'FrameMinted', blockNumber: 1n })).toBeUndefined()
  })

  it('maps a regions mask to 64 × 64 boxes', () => {
    expect(regionBoxes(0b1000_0000_0000_0001)).toEqual([
      { x0: 0, y0: 0, x1: 63, y1: 63 },
      { x0: 192, y0: 192, x1: 255, y1: 255 },
    ])
  })

  it('labels time from the measured block time', () => {
    expect(windowLabel(1_000n, 400)).toBe('~7 min')
    expect(windowLabel(1_000n, 300)).toBe('~5 min')
    expect(windowLabel(1_000n, Number.NaN)).toBe('~7 min')
    expect(agoLabel(100n, 120n, 400)).toBe('8 s')
    expect(agoLabel(0n, 600n, 400)).toBe('4 min')
    expect(agoLabel(200n, 100n, 400)).toBe('0 s')
  })
})
