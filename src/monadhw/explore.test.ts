import { describe, expect, it } from 'vitest'
import {
  formatBlockMs,
  liquidityRows,
  marketName,
  netGas,
  observedBlockMs,
  pushBlockSample,
  sampleGap,
  storageRace,
} from './explore'

describe('block speed', () => {
  it('keeps newest distinct blocks first and ignores repeats', () => {
    let samples = pushBlockSample([], { block: 10n, at: 0 })
    samples = pushBlockSample(samples, { block: 10n, at: 50 })
    samples = pushBlockSample(samples, { block: 11n, at: 300 })
    samples = pushBlockSample(samples, { block: 13n, at: 900 })
    expect(samples.map((sample) => sample.block)).toEqual([13n, 11n, 10n])
    expect(pushBlockSample(samples, { block: 14n, at: 1 }, 2).map((sample) => sample.block)).toEqual([
      14n,
      13n,
    ])
  })

  it('measures ms per block from what this browser saw', () => {
    expect(observedBlockMs([])).toBeUndefined()
    expect(observedBlockMs([{ block: 5n, at: 100 }])).toBeUndefined()
    // 3 blocks in 900 ms → 300 ms each, even if one was skipped by polling.
    expect(
      observedBlockMs([
        { block: 13n, at: 900 },
        { block: 11n, at: 300 },
        { block: 10n, at: 0 },
      ]),
    ).toBe(300)
    expect(
      sampleGap(
        [
          { block: 13n, at: 900 },
          { block: 11n, at: 300 },
        ],
        0,
      ),
    ).toBe('+0.60 s')
    expect(sampleGap([{ block: 13n, at: 900 }], 0)).toBe('')
  })

  it('formats timings', () => {
    expect(formatBlockMs(undefined)).toBe('—')
    expect(formatBlockMs(291.4)).toBe('291 ms')
    expect(formatBlockMs(1_250)).toBe('1.25 s')
  })
})

describe('storage race', () => {
  it('compares one page with scattered pages', () => {
    const result = storageRace(48_000n, 1_071_212n)!
    expect(result.ratioText).toBe('22.3×')
    expect(result.pageEffect).toBe(true)
    expect(result.scatteredPct).toBe(100)
    expect(result.onePagePct).toBeCloseTo(4.48, 1)
  })

  it('says so when there is no page discount, and refuses empty measurements', () => {
    expect(storageRace(100_000n, 120_000n)?.pageEffect).toBe(false)
    expect(storageRace(0n, 10n)).toBeUndefined()
    expect(netGas(1_000n, 30n)).toBe(970n)
    expect(netGas(10n, 30n)).toBe(10n)
  })
})

describe('liquidity race', () => {
  const MAX = (1n << 256n) - 1n
  it('ranks quotes, marks the contract’s highest quoted output and puts failures last', () => {
    const rows = liquidityRows(
      [
        { status: 0, amountOut: 30_000n },
        { status: 4, amountOut: 0n },
        { status: 0, amountOut: 33_000n },
        { status: 0, amountOut: 31_000n },
      ],
      ['poe-mon-usdc', 'clober-mon-usdc', 'hanji-mon-usdc', 'metric-mon-usdc'],
      2n,
    )
    expect(rows.map((row) => row.name)).toEqual(['HANJI', 'METRIC', 'POE', 'CLOBER'])
    expect(rows[0]).toMatchObject({ highest: true, pct: 100, behind: undefined })
    expect(rows[1].behind).toBe('−6.06%')
    expect(rows.filter((row) => row.highest)).toHaveLength(1)
    expect(rows[3]).toMatchObject({ amountOut: undefined, pct: 0, note: 'no quote' })
  })

  it('has no highest row when nobody quoted', () => {
    const rows = liquidityRows(
      [
        { status: 4, amountOut: 0n },
        { status: 1, amountOut: 0n },
      ],
      ['a', 'b'],
      MAX,
    )
    expect(rows.some((row) => row.highest)).toBe(false)
    expect(rows[1].note).toBe('quoted zero')
  })

  it('shortens venue labels', () => {
    expect(marketName('poe-mon-usdc')).toBe('POE')
    expect(marketName('view')).toBe('VIEW')
  })
})
