import { describe, expect, it } from 'vitest'
import { farming, pairSignal, review, rhythm, runPixels, sessions } from './integrity-lib.mjs'
import { battleEconomics, griefing, proRataShare, stormRaffle } from './sybil-model-lib.mjs'

const T = 1_794_000_000
const rec = (owner: string, time: number, pixels: number[] = [0], block = Math.round(time / 0.4)) => ({
  owner,
  time,
  block,
  pixels,
})

describe('fair-play review signals', () => {
  it('decodes runs into pixels', () => {
    expect(runPixels('0x01020403')).toEqual([258, 259, 260])
  })

  it('flags machine-regular timing but not bursty human painting', () => {
    const bot = Array.from({ length: 400 }, (_, i) => T + i * 5)
    expect(rhythm(bot).gapCv).toBe(0)
    let t = T
    const human: number[] = []
    for (let i = 0; i < 400; i++) human.push((t += i % 17 === 0 ? 300 + (i % 5) * 60 : 1 + ((i * 7) % 13)))
    expect(rhythm(human).gapCv).toBeGreaterThan(1)
    const flags = review([...bot.map((x) => rec('bot', x)), ...human.map((x) => rec('person', x))]).flags
    expect(flags.filter((f) => f.kind === 'rhythm').map((f) => f.wallets[0])).toEqual(['bot'])
  })

  it('flags painting around the clock for days', () => {
    const times = Array.from({ length: 2 * 24 * 12 }, (_, i) => T - (T % 86_400) + i * 300)
    expect(rhythm(times).daysWith20PlusHours).toBe(2)
  })

  it('measures own wet repaints (cheap paint-count inflation)', () => {
    const records = [
      rec('a', T, [1, 2]),
      rec('a', T + 10, [1, 2]),
      rec('b', T + 20, [1]),
      rec('a', T + 30, [1]),
    ]
    const f = farming(records)
    expect(f.get('a')).toEqual({ pixels: 5, distinctPixels: 2, selfWetShare: 0.4 })
    expect(f.get('b')!.selfWetShare).toBe(0)
  })

  it('pairs wallets that take turns but never paint together, not wallets that paint side by side', () => {
    const a: number[] = []
    const b: number[] = []
    for (let k = 0; k < 12; k++) {
      const start = T + k * 7_200
      a.push(start, start + 60)
      b.push(start + 300, start + 360)
    }
    expect(pairSignal(a, b)).toMatchObject({ overlapMinutes: 0, handovers: 12 })
    expect(sessions(a)).toHaveLength(12)
    const together = pairSignal(
      a,
      a.map((x) => x + 30),
    )
    expect(together.overlapMinutes).toBeGreaterThan(0)
    const flags = review([...a.map((x) => rec('a', x)), ...b.map((x) => rec('b', x))]).flags
    expect(flags.find((f) => f.kind === 'pair')?.wallets).toEqual(['a', 'b'])
  })

  it('flags minimal event-only wallets only when told which wallets are event-only', () => {
    const records = [rec('farm', T), rec('regular', T)]
    expect(review(records).flags).toHaveLength(0)
    expect(review(records, { eventOnly: new Set(['farm']) }).flags).toEqual([
      { kind: 'minimal', wallets: ['farm'], evidence: '1 paint(s), all inside event windows' },
    ])
  })
})

describe('Sybil cost model', () => {
  it('prices a full-canvas overwrite: budgets set the time, fees stay tiny', () => {
    expect(griefing(256)).toMatchObject({ hours: 1, strokes: 256 })
    expect(griefing(10).hours).toBe(25.6)
    expect(griefing(1_000).hours).toBeLessThan(0.3)
    expect(griefing(1_000).usd).toBeLessThan(1)
  })

  it('shows per-wallet raffle tickets are cheap to farm', () => {
    expect(stormRaffle(10).winChance).toBeGreaterThan(0.5)
    expect(stormRaffle(100)).toMatchObject({ tickets: 2_100 })
    expect(stormRaffle(100).usd).toBeLessThan(2)
  })

  it('shows pro-rata payouts are split-proof', () => {
    const [whole] = proRataShare([1_000, 3_000], 1_333)
    const [x, y] = proRataShare([500, 500, 3_000], 1_333)
    expect(x + y).toBeCloseTo(whole)
    expect(battleEconomics().returnPerMonOfFees).toBeGreaterThan(1)
  })
})
