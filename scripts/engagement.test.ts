import { describe, expect, it } from 'vitest'
import {
  activeWallets,
  concentration,
  engagement,
  events,
  lastFullDay,
  retention,
  weekOf,
} from './engagement-lib.mjs'

const DAY = 86_400
const T0 = Date.parse('2026-11-02T12:00:00Z') / 1_000 // a Monday
const rec = (owner: string, day: number, extra: Record<string, unknown> = {}) => ({
  owner,
  time: T0 + day * DAY,
  block: 1_000 + day * 100,
  pixels: 1,
  season: 1,
  ...extra,
})

describe('engagement numbers from paint records', () => {
  it('counts distinct wallets per UTC day and per Monday-start week', () => {
    expect(weekOf('2026-11-08')).toBe('2026-11-02')
    expect(weekOf('2026-11-09')).toBe('2026-11-09')
    const out = activeWallets([rec('a', 0), rec('a', 0), rec('b', 0), rec('a', 7)])
    expect(out.daily).toEqual([
      { day: '2026-11-02', wallets: 2 },
      { day: '2026-11-09', wallets: 1 },
    ])
    expect(out.weekly).toEqual([
      { week: '2026-11-02', wallets: 2 },
      { week: '2026-11-09', wallets: 1 },
    ])
  })

  it('measures Dn on the exact day and leaves out cohorts whose day n is not over', () => {
    const records = [rec('a', 0), rec('a', 1), rec('b', 0), rec('b', 7), rec('c', 5)]
    const out = retention(records, { lastFullDay: '2026-11-09' })
    expect(out.overall.d1).toEqual({ eligible: 3, retained: 1, rate: 0.3333 })
    // c's day 7 (Nov 14) is after the last full day, so only the Nov 2 cohort counts for D7.
    expect(out.overall.d7).toEqual({ eligible: 2, retained: 1, rate: 0.5 })
    expect(out.overall.d14).toEqual({ eligible: 0, retained: 0, rate: null })
    expect(out.cohorts[1]).toEqual({ day: '2026-11-07', wallets: 1, d1: 0, d7: null, d14: null })
  })

  it('knows the last full day', () => {
    expect(lastFullDay(Date.parse('2026-11-09T12:00:00Z') / 1_000)).toBe('2026-11-08')
    expect(lastFullDay(Date.parse('2026-11-09T23:59:59Z') / 1_000)).toBe('2026-11-09')
  })

  it('measures concentration by paints and by pixels', () => {
    const records = [
      ...Array.from({ length: 8 }, () => rec('whale', 0, { pixels: 1 })),
      rec('a', 0, { pixels: 10 }),
      rec('b', 0, { pixels: 10 }),
    ]
    const paints = concentration(records, 'paints')
    expect(paints).toMatchObject({ wallets: 3, total: 10, top1: 0.8, walletsForHalf: 1 })
    const pixels = concentration(records, 'pixels')
    expect(pixels).toMatchObject({ total: 28, walletsForHalf: 2 })
    expect(paints.gini).toBeGreaterThan(pixels.gini)
    expect(concentration([rec('a', 0), rec('b', 0)], 'paints').gini).toBe(0)
  })

  it('splits event and organic activity and finds wallets an event brought in', () => {
    const windows = [
      { id: 'storm', startBlock: 1_000, endBlock: 1_050 },
      { id: 'battle', start: T0 + 3 * DAY, end: T0 + 4 * DAY },
    ]
    const records = [rec('old', 0), rec('old', 2), rec('new', 3), rec('new', 5), rec('once', 3)]
    const first = new Map(records.map((r) => [r.owner, r]).reverse())
    const out = events(records, windows, first)
    expect(out.windows[0]).toMatchObject({ id: 'storm', wallets: 1, newWallets: 1, newWalletsWhoCameBack: 1 })
    expect(out.windows[1]).toMatchObject({ id: 'battle', wallets: 2, newWallets: 2, newWalletsWhoCameBack: 1 })
    expect(out.split).toMatchObject({ eventPaints: 3, organicPaints: 2, eventOnlyWallets: 1, organicWallets: 2 })
  })

  it('counts who came back from an earlier season', () => {
    const all = [rec('a', -40, { season: 0 }), rec('a', 1), rec('b', 1)]
    const out = engagement({
      records: all.filter((r) => r.season === 1),
      all,
      coverage: { toTime: T0 + 3 * DAY },
      season: 1,
    })
    expect(out.seasons).toEqual({ wallets: 2, paintedInEarlierSeason: 1, newThisSeason: 1 })
  })
})
