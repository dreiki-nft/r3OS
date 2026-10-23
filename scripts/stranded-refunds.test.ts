import { describe, expect, it } from 'vitest'
import { classify, decodeSessionLog, burnerSweeps, mon, roundUp, WEI } from './stranded-refunds-lib.mjs'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const K1 = '0x0000000000000000000000000000000000000c01'
const K2 = '0x0000000000000000000000000000000000000c02'
const K3 = '0x0000000000000000000000000000000000000c03'
const ME = '0x00000000000000000000000000000000000000ee'
const m = (value: number) => (BigInt(Math.round(value * 1000)) * WEI) / 1000n

describe('stranded refunds', () => {
  const starts = [
    { owner: A, burner: K1, block: 100n, expiry: 24_100n },
    { owner: A, burner: K2, block: 30_000n, expiry: 54_000n },
    { owner: B, burner: K3, block: 60_000n, expiry: 84_000n },
    { owner: ME, burner: '0x0000000000000000000000000000000000000c04', block: 100n, expiry: 200n },
  ]

  it('pays MON still in a finished burner, MON that came back late, and nothing for a proper End session', () => {
    const result = classify({
      starts,
      revokes: [{ owner: B, burner: K3, block: 61_000n }],
      sweeps: [
        // K1: expired at 24,100, auto-swept the next day: left behind → paid.
        { burner: K1, to: A, block: 300_000n, value: m(1.7), hash: '0x1' },
        // K3: revoked while running and swept 4 blocks later: End session → not paid.
        { burner: K3, to: B, block: 61_004n, value: m(2), hash: '0x2' },
      ],
      // K2 expired and still holds 0.5 MON; the excluded wallet's burner holds 3 MON.
      balances: new Map([
        [K2.toLowerCase(), m(0.5)],
        ['0x0000000000000000000000000000000000000c04', m(3)],
      ]),
      snapshot: 400_000n,
      exclude: [ME],
    })
    expect(result.owners.map((o: { owner: string }) => o.owner.toLowerCase())).toEqual([A.toLowerCase()])
    expect(mon(result.owners[0].refund)).toBe('2.2')
    expect(mon(result.total)).toBe('2.2')
  })

  it('leaves a running session alone, and ignores dust', () => {
    const result = classify({
      starts: [{ owner: A, burner: K1, block: 390_000n, expiry: 414_000n }],
      revokes: [],
      sweeps: [],
      balances: new Map([[K1.toLowerCase(), m(4)]]),
      snapshot: 400_000n,
    })
    expect(result.owners).toEqual([])
    const dust = classify({
      starts: [{ owner: A, burner: K1, block: 100n, expiry: 200n }],
      revokes: [],
      sweeps: [],
      balances: new Map([[K1.toLowerCase(), 5n * 10n ** 14n]]),
      snapshot: 400_000n,
    })
    expect(dust.owners).toEqual([])
  })

  it('a sweep after a revoke that came too late, or after expiry, still counts as left behind', () => {
    const result = classify({
      starts: [{ owner: A, burner: K1, block: 100n, expiry: 24_100n }],
      revokes: [{ owner: A, burner: K1, block: 1_000n }],
      sweeps: [{ burner: K1, to: A, block: 50_000n, value: m(1), hash: '0x3' }],
      balances: new Map(),
      snapshot: 400_000n,
    })
    expect(mon(result.total)).toBe('1')
  })

  it('rounds up to 0.001 MON and decodes Etherscan rows', () => {
    expect(mon(roundUp(1_234_100_000_000_000_000n))).toBe('1.235')
    const log = decodeSessionLog({
      topics: ['0x00', `0x${'0'.repeat(24)}${A.slice(2)}`, `0x${'0'.repeat(24)}${K1.slice(2)}`],
      data: `0x${(24_100).toString(16).padStart(64, '0')}${'0'.repeat(64)}`,
      blockNumber: '0x64',
      transactionHash: '0xabc',
    })
    expect(log.expiry).toBe(24_100n)
    expect(log.block).toBe(100n)
    expect(log.owner.toLowerCase()).toBe(A.toLowerCase())
    const sweeps = burnerSweeps(K1, [
      { from: K1, to: A, isError: '0', input: '0x', value: '1000', blockNumber: '5', hash: '0x1' },
      {
        from: K1,
        to: '0x5102DE3817aE16b3afaeb9D180130669A70787b3',
        isError: '0',
        input: '0xabcdef',
        value: '0',
        blockNumber: '6',
        hash: '0x2',
      },
      { from: K1, to: A, isError: '1', input: '0x', value: '9', blockNumber: '7', hash: '0x3' },
    ])
    expect(sweeps).toHaveLength(1)
  })
})

describe('--ended-before', () => {
  it('counts only sessions that were over before the cutoff, wherever their MON is now', () => {
    const starts = [
      // ended before the fix, MON came back after it: counts
      { owner: A, burner: K1, block: 100n, expiry: 24_100n },
      // a regular: new session after the fix, expired, swept back on the next visit: does not count
      { owner: B, burner: K3, block: 40_000n, expiry: 64_000n },
      // ended before the fix and still sitting there: counts
      { owner: B, burner: K2, block: 200n, expiry: 24_200n },
    ]
    const result = classify({
      starts,
      revokes: [],
      sweeps: [
        { burner: K1, to: A, block: 35_000n, value: m(1.5), hash: '0x1' },
        { burner: K3, to: B, block: 70_000n, value: m(9), hash: '0x2' },
      ],
      balances: new Map([[K2.toLowerCase(), m(2)]]),
      snapshot: 100_000n,
      endedBefore: 30_000n,
    })
    const byOwner = Object.fromEntries(
      result.owners.map((o: { owner: string; refund: bigint }) => [o.owner.toLowerCase(), mon(o.refund)]),
    )
    expect(byOwner).toEqual({ [A.toLowerCase()]: '1.5', [B.toLowerCase()]: '2' })
  })
})
