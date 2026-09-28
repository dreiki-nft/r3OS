import { describe, expect, it } from 'vitest'
import {
  chunkBlockRanges,
  clearMatchingInFlight,
  createSerialQueue,
  logSetsDiffer,
  reloadOnSpeculativeMismatch,
  tileNeedsFetch,
  tilesTouchedByPainted,
  type TileCacheEntry,
} from './canvasStore'

describe('canvas store helpers', () => {
  it('chunks log ranges at 1,000 blocks', () => {
    expect(chunkBlockRanges(1n, 2_501n)).toEqual([
      { fromBlock: 1n, toBlock: 1_000n },
      { fromBlock: 1_001n, toBlock: 2_000n },
      { fromBlock: 2_001n, toBlock: 2_501n },
    ])
  })

  it('keeps re-edited pixels pending while clearing unchanged in-flight pixels', () => {
    const background = Uint8Array.from([4, 5, 6])
    const working = Uint8Array.from([7, 9, 8])
    const sent = new Map([
      [0, 7],
      [1, 8],
    ])
    expect([...clearMatchingInFlight(working, background, sent)]).toEqual([4, 9, 8])
  })

  it('serializes queued reconciliation jobs', async () => {
    const enqueue = createSerialQueue()
    const events: string[] = []
    let release!: () => void
    const first = enqueue(async () => {
      events.push('first:start')
      await new Promise<void>((resolve) => {
        release = resolve
      })
      events.push('first:end')
    })
    const second = enqueue(async () => {
      events.push('second:start')
      events.push('second:end')
    })
    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    release()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('fetches a hover tile only when missing, stale or older than ten blocks', () => {
    const entry: TileCacheEntry = { state: { heat: 1, wetBitmap: 0n }, block: 100n, stale: false }
    expect(tileNeedsFetch(entry, 105n)).toBe(false)
    expect(tileNeedsFetch(entry, 110n)).toBe(false)
    expect(tileNeedsFetch(entry, 111n)).toBe(true)
    expect(tileNeedsFetch({ ...entry, stale: true }, 101n)).toBe(true)
    expect(tileNeedsFetch(undefined, 101n)).toBe(true)
  })

  it('detects a speculative log mismatch in the reconcile overlap', async () => {
    expect(logSetsDiffer(new Set(['0xaaa:1', '0xbbb:2']), new Set(['0xaaa:1', '0xccc:3']))).toBe(true)
    expect(logSetsDiffer(new Set(['0xaaa:1']), new Set(['0xaaa:1']))).toBe(false)
    let reloads = 0
    await expect(
      reloadOnSpeculativeMismatch(['0xaaa:1', '0xbbb:2'], ['0xaaa:1', '0xccc:3'], async () => {
        reloads++
      }),
    ).resolves.toBe(true)
    expect(reloads).toBe(1)
  })

  it('marks exactly the tiles touched by runs and corruptions', () => {
    const runs = Uint8Array.from([0, 0, 20, 1, 32, 32, 33, 2])
    const corruptions = Uint8Array.from([255, 255, 3])
    expect([...tilesTouchedByPainted(runs, corruptions)].sort((a, b) => a - b)).toEqual([0, 1, 34, 255])
  })
})
