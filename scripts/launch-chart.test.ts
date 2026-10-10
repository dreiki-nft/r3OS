import { describe, expect, it } from 'vitest'
import { niceScale, renderLaunchChart } from './launch-chart.mjs'

const from = Date.parse('2026-10-10T19:00:00Z') / 1_000
const hourly = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  painters: hour === 3 ? 0 : (hour % 7) + 1,
  paints: hour === 3 ? 0 : (hour % 7) * 5 + 2,
  pixels: 100,
}))
const stats = {
  fromBlock: '100',
  toBlock: '200',
  window: {
    fromTime: from,
    toTime: from + 86_400,
    painters: 12,
    newPainters: 9,
    cameBackLater: 4,
    paints: 300,
    pixels: 2_400,
    peakHour: hourly[6],
    hourly,
  },
}

describe('launch chart', () => {
  it('picks clean axis steps', () => {
    expect(niceScale(15)).toEqual({ top: 15, step: 5 })
    expect(niceScale(108)).toEqual({ top: 150, step: 50 })
    expect(niceScale(0)).toEqual({ top: 1, step: 1 })
  })

  it('draws one column per active hour in each panel, with the totals, UTC times and a text description', () => {
    const svg = renderLaunchChart(stats)
    const columns = svg.match(/<path d="M/g) ?? []
    expect(columns).toHaveLength(23 * 2) // hour 3 had no paint
    expect(svg).toContain('12 painters · 300 strokes · 2,400 pixels')
    expect(svg).toContain('9 new to r3OS')
    expect(svg).toContain('>19:00<')
    expect(svg).toContain('<desc id="d">')
    expect(svg).not.toMatch(/undefined|NaN/)
  })

  it('refuses stats without an hourly window', () => {
    expect(() => renderLaunchChart({ fromBlock: '1', toBlock: '2' })).toThrow('no window.hourly')
  })
})
