import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256 } from 'viem'
import { PAINTED } from './community-stats-lib.mjs'
import {
  batches,
  chasers,
  listHash,
  parseArgs,
  report,
  stormPainters,
  stormWindow,
} from './storm-chasers-lib.mjs'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const C = '0x00000000000000000000000000000000000000c3'
const SESSION = '0x00000000000000000000000000000000000000dd'

function painted(owner: string, block: bigint, runs: `0x${string}` = '0x0a050903', sender = owner) {
  return {
    blockNumber: block,
    topics: encodeEventTopics({ abi: [PAINTED], eventName: 'Painted', args: { season: 0n, owner, sender } }),
    data: encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint32' }, { type: 'uint16' }],
      [runs, '0x', 10, 1],
    ),
  }
}

describe('storm chasers', () => {
  it('uses the Paint contract storm rule: 600 blocks from each multiple of 200,000', () => {
    expect(stormWindow(116_000_000n)).toEqual({ start: 116_000_000n, end: 116_000_599n })
    expect(() => stormWindow(116_000_001n)).toThrow(/not a storm start/)
  })

  it('counts only paints inside the window, by owner (Live Mode paints count for the main wallet)', () => {
    const w = stormWindow(115_400_000n)
    const set = stormPainters(
      [
        painted(A, 115_399_999n), // one block early
        painted(B, 115_400_000n), // first storm block
        painted(C, 115_400_599n, '0x0a050903', SESSION), // last storm block, painted through a session key
        painted(A, 115_400_600n), // one block late
        painted(A, 115_400_100n, '0x0a090503'), // no pixels written
      ],
      w,
    )
    expect([...set].sort()).toEqual([B, C])
  })

  it('keeps wallets that caught every storm, minus excluded ones, sorted and checksummed', () => {
    const entrants = chasers(
      [new Set([C, A, B]), new Set([A, C, B]), new Set([C, B])],
      [B.toUpperCase().replace('0X', '0x')],
    )
    expect(entrants).toEqual([getAddress(C)])
    expect(chasers([new Set([A]), new Set()])).toEqual([])
    expect(chasers([])).toEqual([])
  })

  it('hashes the published list as concatenated 20-byte addresses', () => {
    const list = [getAddress(A), getAddress(B)]
    expect(listHash(list)).toBe(keccak256(`0x${A.slice(2)}${B.slice(2)}`))
    expect(listHash(list)).not.toBe(listHash([...list].reverse()))
  })

  it('splits loadTicketsBatch inputs with one ticket each', () => {
    const out = batches([A, B, C], 2)
    expect(out).toEqual([
      { wallets: [A, B], tickets: [1, 1] },
      { wallets: [C], tickets: [1] },
    ])
  })

  it('parses and checks flags', () => {
    const opts = parseArgs([
      '--storms',
      '116_200_000,115400000',
      '--exclude',
      `${A},${A.toUpperCase().replace('0X', '0x')}`,
    ])
    expect(opts.storms).toEqual([115_400_000n, 116_200_000n])
    expect(opts.exclude).toEqual([A])
    expect(() => parseArgs([])).toThrow(/--storms is required/)
    expect(() => parseArgs(['--storms', '115400000,115400000'])).toThrow(/duplicate/)
    expect(() => parseArgs(['--storms', '115400000', '--exclude', '0x12'])).toThrow(/not an address/)
    expect(() => parseArgs(['--storms', '115400000', '--rpc=https://secret'])).toThrow('unknown flag --rpc')
  })

  it('prints a short report', () => {
    const text = report({
      storms: [stormWindow(115_400_000n), stormWindow(116_000_000n)],
      perStorm: [new Set([A, B]), new Set([A])],
      entrants: [getAddress(A)],
      excluded: 1,
      hash: '0xabc',
      snapshotBlock: 116_000_599n,
    })
    expect(text).toContain('storm 1: blocks 115400000-115400599 · 2 wallets painted')
    expect(text).toContain('caught all 2: 1 wallet (1 team/test wallet not counted)')
    expect(text).toContain('snapshotBlock: 116000599')
  })
})
