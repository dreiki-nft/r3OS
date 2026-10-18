import { describe, expect, it } from 'vitest'
import { dayRows, renderSeasonChart } from './season-chart.mjs'

const daily = [
  { day: '2026-10-09', painters: 2, newPainters: 2, paints: 5, pixels: 50 },
  { day: '2026-10-10', painters: 30, newPainters: 29, paints: 200, pixels: 9_000 },
  { day: '2026-10-11', painters: 25, newPainters: 10, paints: 240, pixels: 12_000 },
  { day: '2026-10-13', painters: 40, newPainters: 12, paints: 400, pixels: 20_000 },
]
const stats = {
  painters: 81,
  returningPainters: 33,
  paints: 845,
  pixels: 41_050,
  fromBlock: '100',
  toBlock: '200',
  asOf: '2026-10-13 22:00 UTC',
  daily,
}

describe('season chart', () => {
  it('fills every day from the launch on, quiet days included', () => {
    const rows = dayRows(daily, '2026-10-10')
    expect(rows.map((r) => r.day)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'])
    expect(rows[2]).toEqual({ day: '2026-10-12', painters: 0, newPainters: 0, paints: 0, pixels: 0 })
  })

  it('draws a column per active day in each panel, with totals, day labels and a text description', () => {
    const svg = renderSeasonChart(stats)
    expect(svg.match(/<path d="M/g) ?? []).toHaveLength(3 * 2) // Oct 12 had no paint; Oct 9 is before the launch
    expect(svg).toContain('81 painters · 845 strokes · 41,050 pixels')
    expect(svg).toContain('33 painters came back on another day · 4 days since the public launch')
    expect(svg).toContain('>Oct 12<')
    expect(svg).toContain('Oct 13: 40 painters, 400 strokes')
    expect(svg).toContain('builder and guest wallets excluded')
  })

  it('refuses stats without day rows', () => {
    expect(() => renderSeasonChart({ ...stats, daily: [] })).toThrow('no daily rows')
  })
})
