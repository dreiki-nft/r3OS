import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import {
  CD_BURNED,
  FRAME_MINTED,
  PAINTED,
  CACHE_OVERLAP,
  DEFAULT_CACHE,
  TRANSFER,
  cacheKey,
  chunks,
  emptyCache,
  markdown,
  mergeCache,
  readCache,
  scanStart,
  unpackLog,
  writeCache,
  parseArgs,
  perWallet,
  runPixels,
  summarize,
  windowMarkdown,
  windowStats,
} from './community-stats-lib.mjs'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const ME = '0x00000000000000000000000000000000000000ee'
const ZERO = '0x0000000000000000000000000000000000000000'
const DAY = 86_400n

function painted(owner: string, runs: `0x${string}`, blockTimestamp: bigint) {
  return {
    topics: encodeEventTopics({
      abi: [PAINTED],
      eventName: 'Painted',
      args: { season: 0n, owner, sender: owner },
    }),
    data: encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint32' }, { type: 'uint16' }],
      [runs, '0x', 10, 1],
    ),
    blockTimestamp,
  }
}
const frame = (minter: string, id: bigint) => ({
  topics: encodeEventTopics({
    abi: [FRAME_MINTED],
    eventName: 'FrameMinted',
    args: { frameId: id, season: 0n, minter },
  }),
  data: encodeAbiParameters([{ type: 'uint256' }], [0n]),
})
const cd = (owner: string, id: bigint) => ({
  topics: encodeEventTopics({ abi: [CD_BURNED], eventName: 'CDBurned', args: { owner, tokenId: id } }),
  data: encodeAbiParameters([{ type: 'uint8' }, { type: 'string' }], [2, 'MIX']),
})
const transfer = (from: string, to: string, id: bigint) => ({
  topics: encodeEventTopics({ abi: [TRANSFER], eventName: 'Transfer', args: { from, to, tokenId: id } }),
  data: '0x' as const,
})

describe('community stats', () => {
  it('counts pixels from (y, x0, x1, colour) runs', () => {
    expect(runPixels('0x0a050903')).toBe(5)
    expect(runPixels('0x0a0509030b000003')).toBe(6)
    expect(runPixels('0x0a090503')).toBe(0)
    expect(runPixels('0x')).toBe(0)
  })

  it('counts distinct and returning painters, paints, pixels, frames, CDs and Pass mints without the builder', () => {
    const stats = summarize(
      {
        painted: [
          painted(A, '0x0a050903', 1_000n * DAY),
          painted(A, '0x0b000003', 1_001n * DAY),
          painted(B, '0x0c000003', 1_000n * DAY),
          painted(ME, '0x0d00ff03', 1_000n * DAY),
        ],
        frames: [frame(A, 1n), frame(A, 2n), frame(ME, 3n)],
        cds: [cd(B, 7n), cd(ME, 8n)],
        passes: [transfer(ZERO, A, 1n), transfer(ZERO, ME, 2n), transfer(A, B, 1n)],
      },
      [ME.toUpperCase().replace('0X', '0x')],
    )
    expect(stats).toEqual({
      painters: 2,
      returningPainters: 1,
      paints: 3,
      pixels: 7,
      frames: { count: 2, owners: 1 },
      cds: { count: 1, owners: 1 },
      passes: { count: 1, owners: 1 },
      excluded: 1,
      daily: [
        { day: '1972-09-27', painters: 2, newPainters: 2, paints: 2, pixels: 6 },
        { day: '1972-09-28', painters: 1, newPainters: 0, paints: 1, pixels: 1 },
      ],
    })
    const text = markdown(stats, { fromBlock: 10n, toBlock: 20n, asOf: '2026-10-08 00:00 UTC' })
    expect(text).toContain('| Painters (distinct wallets) | 2 |')
    expect(text).toContain('not counting 1 builder/test wallet')
  })

  it('splits block ranges and validates flags without echoing values', () => {
    expect(chunks(1n, 5n, 2)).toEqual([
      { fromBlock: 1n, toBlock: 2n },
      { fromBlock: 3n, toBlock: 4n },
      { fromBlock: 5n, toBlock: 5n },
    ])
    expect(parseArgs(['--exclude', `${A}, ${B}`, '--range', '500']).exclude).toEqual([A, B])
    expect(() => parseArgs(['--exclude', 'nope'])).toThrow('--exclude is not an address')
    expect(() => parseArgs(['--rpc=https://secret.example/key'])).toThrow('unknown flag --rpc')
    expect(() => parseArgs(['--rpc=https://secret.example/key'])).not.toThrow(/secret/)
  })

  it('measures a launch window: hourly activity, new painters and painters who came back an hour later', () => {
    const launch = 1_000n * DAY
    const H = 3_600n
    const window = windowStats(
      [
        painted(A, '0x0a050903', launch - DAY), // A painted before launch
        painted(A, '0x0b000003', launch + 10n),
        painted(B, '0x0c000003', launch + 20n),
        painted(B, '0x0c000103', launch + 2n * H), // B comes back two hours later
        painted(ME, '0x0d00ff03', launch + 30n),
        painted(B, '0x0c000003', launch + 25n * H), // after the window
      ],
      { fromTime: launch, toTime: launch + 24n * H, exclude: [ME] },
    )
    expect(window.painters).toBe(2)
    expect(window.newPainters).toBe(1)
    expect(window.cameBackLater).toBe(1)
    expect(window.paints).toBe(3)
    expect(window.pixels).toBe(4)
    expect(window.hourly).toHaveLength(24)
    expect(window.hourly[0]).toEqual({ hour: 0, paints: 2, pixels: 2, painters: 2 })
    expect(window.peakHour.hour).toBe(0)
    const text = windowMarkdown(window)
    expect(text).toContain('| New to r3OS (first stroke ever) | 1 |')
    expect(text).toContain('| Came back 1+ hour after their first stroke | 1 |')
  })

  it('reads a launch window from --since and --hours', () => {
    const options = parseArgs(['--since', '2026-10-10T21:00:00Z', '--hours', '24'])
    expect(options.since).toBe(BigInt(Date.parse('2026-10-10T21:00:00Z') / 1_000))
    expect(options.hours).toBe(24)
    expect(() => parseArgs(['--since', 'tomorrow-ish'])).toThrow('--since must be a date/time')
    expect(() => parseArgs(['--hours', '24'])).toThrow('--hours needs --since')
  })
})

describe('community stats cache', () => {
  const contracts = {
    paint: '0x' + '1'.repeat(40),
    cdBurner: '0x' + '2'.repeat(40),
    pass: '0x' + '3'.repeat(40),
  }
  const at = (log: object, blockNumber: bigint, logIndex = 0) => ({ ...log, blockNumber, logIndex })
  // A season of paints over blocks 1_000 … 3_000, one a day per 100 blocks.
  const all = [
    at(painted(A, '0x01020304', 0n), 1_000n),
    at(painted(B, '0x01020304', 0n), 1_000n, 1),
    at(painted(A, '0x0100ff04', DAY), 1_900n),
    at(painted(ME, '0x01020304', DAY), 2_300n),
    at(painted(B, '0x01000004', 2n * DAY), 2_800n),
    at(painted(A, '0x01000004', 2n * DAY), 3_000n),
  ]
  const day = (b: bigint) => BigInt(Math.floor(Number(b - 1_000n) / 900)) * DAY
  const withTimes = (logs: { blockNumber: bigint }[]) =>
    logs.map((l) => ({ ...l, blockTimestamp: day(l.blockNumber) }))
  const between = (from: bigint, to: bigint) =>
    all.filter((l) => l.blockNumber >= from && l.blockNumber <= to)

  it('is on by default, can be moved or switched off', () => {
    expect(parseArgs([]).cache).toBe(DEFAULT_CACHE)
    expect(parseArgs(['--cache', 'x/y.json']).cache).toBe('x/y.json')
    expect(parseArgs(['--no-cache']).cache).toBeUndefined()
  })

  it('a run on top of the cache counts exactly what a full scan counts, overlap included', () => {
    const full = summarize({ painted: withTimes(all) }, [ME])
    const key = cacheKey(contracts, 1_000n)
    // First run up to block 2_000, second run up to 3_000 re-reading the overlap.
    let cache = mergeCache(emptyCache(key, 1_000n), { painted: between(1_000n, 2_000n) }, 1_000n, 2_000n)
    expect(cache.lastBlock).toBe('2000')
    const from = scanStart(cache, 1_000n)
    expect(from).toBe(2_000n - CACHE_OVERLAP + 1n)
    cache = mergeCache(cache, { painted: between(from, 3_000n) }, from, 3_000n)
    expect(cache.logs.painted).toHaveLength(all.length)
    const again = summarize({ painted: withTimes(cache.logs.painted.map(unpackLog)) }, [ME])
    expect(again).toEqual(full)
    expect(again.painters).toBe(2)
    expect(again.returningPainters).toBe(2)
  })

  it('round-trips through the file and ignores a cache for other contracts or a broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-cache-'))
    const path = join(dir, 'nested', 'cache.json')
    const key = cacheKey(contracts, 1_000n)
    const cache = {
      ...mergeCache(emptyCache(key, 1_000n), { painted: all }, 1_000n, 3_000n),
      times: { '1000': '0' },
    }
    writeCache(path, cache)
    expect(readCache(path, key)).toEqual(cache)
    expect(readCache(path, cacheKey({ ...contracts, paint: '0x' + '9'.repeat(40) }, 1_000n))).toBeUndefined()
    expect(readCache(path, cacheKey(contracts, 999n))).toBeUndefined()
    expect(readCache(join(dir, 'missing.json'), key)).toBeUndefined()
    writeFileSync(path, '{not json')
    expect(readCache(path, key)).toBeUndefined()
  })

  it('never stores an RPC URL', () => {
    const cache = mergeCache(
      emptyCache(cacheKey(contracts, 1_000n), 1_000n),
      { painted: all },
      1_000n,
      3_000n,
    )
    expect(JSON.stringify(cache)).not.toMatch(/https?:/)
  })
})

describe('per-wallet season numbers', () => {
  it('counts each painter, skips excluded wallets and ranks by paints (ties share)', () => {
    const t0 = 1_760_000_000n
    const rows = perWallet(
      {
        painted: [
          painted(A, '0x0a050903', t0),
          painted(A, '0x0a050903', t0 + DAY),
          painted(B, '0x0a050903', t0),
          painted(ME, '0x0a050903', t0),
        ],
        frames: [frame(A, 1n), frame(ME, 2n)],
        cds: [cd(B, 1n)],
      },
      [ME],
    )
    expect(rows).toEqual([
      { address: A, paints: 2, pixels: 10, days: 2, first: '2025-10-09', frames: 1, cds: 0, rank: 1 },
      { address: B, paints: 1, pixels: 5, days: 1, first: '2025-10-09', frames: 0, cds: 1, rank: 2 },
    ])
    expect(parseArgs(['--painters-out', 'public/season/painters.json']).paintersOut).toBe(
      'public/season/painters.json',
    )
  })
})
