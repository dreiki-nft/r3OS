import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import {
  STRANDED_DUST,
  formatStranded,
  otherBurners,
  parseSessionIndex,
  stranded,
  strandedTotal,
  type SessionIndex,
} from './sessionHistory'

const PAINT = '0x5102De3817ae16B3aFAeB9d180130669a70787b3' as Address
const ME = '0xC493F2059cBE13583A97A3F1104027582071AD43' as Address
const OTHER = '0x00000000000000000000000000000000000000a1' as Address
const B1 = '0xDD54189c5e7b1d44fcd5e3a8c04e3de102d223a5' as Address
const B2 = '0xe39BB01fedb21eebe6fff606962778F104056a0c' as Address
const B3 = '0x0658Fcea7eb44c9e6c7eec0495c63bebaade6097' as Address
const B4 = '0x80a3B4cd367254c62a2e63674184d5179c953f4B' as Address

const index: SessionIndex = {
  version: 1,
  chainId: 143,
  paint: PAINT,
  fromBlock: '111020589',
  toBlock: '115700000',
  sessions: [
    [ME, B1, 113_239_100],
    [OTHER, '0x00000000000000000000000000000000000000b2' as Address, 113_300_000],
    [ME, B2, 115_521_900],
    [ME, B3, 115_599_800],
    [ME, B4, 115_658_500],
  ],
}

describe('Live Mode wallets in other browsers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts only an index for this chain and Paint contract', () => {
    expect(parseSessionIndex(index, { chainId: 143, paint: PAINT.toLowerCase() })).toBe(index)
    expect(parseSessionIndex(index, { chainId: 10143, paint: PAINT })).toBeUndefined()
    expect(parseSessionIndex(index, { chainId: 143, paint: OTHER })).toBeUndefined()
    expect(
      parseSessionIndex({ ...index, sessions: [[ME, 'nope', 1]] }, { chainId: 143, paint: PAINT }),
    ).toBeUndefined()
    expect(parseSessionIndex(null, { chainId: 143, paint: PAINT })).toBeUndefined()
  })

  it("lists this wallet's other burners, newest first, never the one this browser holds", () => {
    const rows = otherBurners(index, ME.toLowerCase() as Address, B4.toLowerCase() as Address)
    expect(rows.map((r) => r.address.toLowerCase())).toEqual([B3, B2, B1].map((a) => a.toLowerCase()))
    expect(otherBurners(index, OTHER).map((r) => r.startedBlock)).toEqual([113_300_000])
  })

  it('keeps only burners holding more than the sweep reserve, biggest first (the real report: 2.62 MON)', () => {
    const rows = stranded([
      { address: B1, balance: 420_000_000_000_000n, startedBlock: 1 }, // swept: 0.00042 left
      { address: B2, balance: 1_731_631_692_000_000_000n, startedBlock: 2 },
      { address: B3, balance: 891_368_754_000_000_000n, startedBlock: 3 },
      { address: B4, balance: STRANDED_DUST, startedBlock: 4 },
    ])
    expect(rows.map((r) => r.address)).toEqual([B2, B3])
    expect(formatStranded(strandedTotal(rows))).toBe('2.62 MON')
  })

  it('a missing or broken index is a hint that stays quiet, never an error', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }))
    const { loadStrandedBurners, __resetSessionIndexForTests } = await import('./sessionHistory')
    __resetSessionIndexForTests()
    await expect(loadStrandedBurners(ME, B4)).resolves.toEqual([])
  })
})
