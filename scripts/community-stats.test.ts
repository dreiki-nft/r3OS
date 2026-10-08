import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import {
  CD_BURNED,
  FRAME_MINTED,
  PAINTED,
  TRANSFER,
  chunks,
  markdown,
  parseArgs,
  runPixels,
  summarize,
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
})
