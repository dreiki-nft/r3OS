#!/usr/bin/env node
/**
 * Hour-by-hour chart of a launch window, for the README and the video. Reads the JSON written by
 *   node scripts/community-stats.mjs --since … --hours 24 --json > docs/launch-24h-stats.json
 * and writes an SVG (GitHub renders it in the README):
 *   node scripts/launch-chart.mjs                                   # docs/launch-24h-stats.json → docs/media/launch-24h.svg
 *   node scripts/launch-chart.mjs --in stats.json --out chart.svg
 * Two small multiples on one time axis: painters each hour, strokes each hour. One measure per panel, never
 * two scales on one axis.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const W = 1200
const H = 640
const LEFT = 72
const RIGHT = 32
const SURFACE = '#0b0b0c'
const GRID = '#232326'
const INK = '#f2efe9'
const INK_SOFT = '#d6d2cb'
const INK_MUTED = '#8f8b85'
const BAR = '#1fa79c' // r3OS teal, one step deeper so it passes the dark-surface lightness band
const FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

const escapeXml = (text) =>
  String(text).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c],
  )
const fmt = (n) => Number(n).toLocaleString('en-US')

/** A clean axis top: 1, 2 or 5 × 10^k steps, at most 4 of them. */
export function niceScale(max) {
  if (max <= 0) return { top: 1, step: 1 }
  const raw = max / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power
  const clean = Math.max(1, Math.round(step))
  return { top: Math.ceil(max / clean) * clean, step: clean }
}

function utcLabel(seconds) {
  return new Date(seconds * 1_000).toISOString().slice(11, 16)
}

/** Column with a 4px rounded data end, square at the baseline. */
function column(x, y, width, height) {
  const r = Math.min(4, height, width / 2)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

function panel({ rows, key, title, top, height, showTimes, fromTime }) {
  const plotW = W - LEFT - RIGHT
  const band = plotW / rows.length
  const barW = Math.min(24, Math.max(2, band - 2))
  const values = rows.map((row) => Number(row[key]) || 0)
  const max = Math.max(...values)
  // Headroom above the tallest column so its value label never meets the panel title.
  const { top: axisTop, step } = niceScale(max * 1.18)
  const y = (v) => top + height - (v / axisTop) * height
  const parts = [
    `<text x="${LEFT}" y="${top - 14}" fill="${INK_SOFT}" font-size="15">${escapeXml(title)}</text>`,
  ]
  for (let tick = 0; tick <= axisTop; tick += step) {
    const ty = y(tick).toFixed(1)
    parts.push(
      `<line x1="${LEFT}" x2="${W - RIGHT}" y1="${ty}" y2="${ty}" stroke="${GRID}" stroke-width="1"/>`,
    )
    parts.push(
      `<text x="${LEFT - 10}" y="${ty}" dy="4" text-anchor="end" fill="${INK_MUTED}" font-size="12">${fmt(tick)}</text>`,
    )
  }
  const peak = values.indexOf(max)
  rows.forEach((row, index) => {
    const value = values[index]
    const x = LEFT + index * band + (band - barW) / 2
    if (value > 0) {
      const barTop = y(value)
      parts.push(
        `<path d="${column(x, barTop, barW, top + height - barTop)}" fill="${BAR}"><title>${escapeXml(
          `${utcLabel(fromTime + row.hour * 3_600)} UTC: ${fmt(value)} ${title.split(' ')[0]}`,
        )}</title></path>`,
      )
    }
    if (index === peak && max > 0) {
      parts.push(
        `<text x="${x + barW / 2}" y="${y(value) - 8}" text-anchor="middle" fill="${INK}" font-size="13" font-weight="600">${fmt(value)}</text>`,
      )
    }
    if (showTimes && index % 3 === 0) {
      parts.push(
        `<text x="${LEFT + index * band + band / 2}" y="${top + height + 22}" text-anchor="middle" fill="${INK_MUTED}" font-size="12">${utcLabel(fromTime + row.hour * 3_600)}</text>`,
      )
    }
  })
  return parts.join('\n')
}

export function renderLaunchChart(stats) {
  const window = stats.window
  if (!window?.hourly?.length)
    throw new Error('no window.hourly in the stats JSON: run community-stats with --since … --json')
  const hours = window.hourly.length
  const headline = `${fmt(window.painters)} painters · ${fmt(window.paints)} strokes · ${fmt(window.pixels)} pixels`
  const detail = `${fmt(window.newPainters)} new to r3OS · ${fmt(window.cameBackLater)} came back 1+ hour later · busiest hour ${fmt(window.peakHour.painters)} painters`
  const description = window.hourly
    .map(
      (row) =>
        `${utcLabel(window.fromTime + row.hour * 3_600)} UTC: ${row.painters} painters, ${row.paints} strokes`,
    )
    .join('; ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" font-family="${FONT}">
<title id="t">r3OS: the first ${hours} hours on Monad mainnet</title>
<desc id="d">${escapeXml(`${headline}. ${detail}. ${description}.`)}</desc>
<rect width="${W}" height="${H}" fill="${SURFACE}"/>
<text x="${LEFT}" y="48" fill="${INK}" font-size="24" font-weight="700">r3OS · the first ${hours} hours on Monad mainnet</text>
<text x="${LEFT}" y="78" fill="${INK_SOFT}" font-size="15">${escapeXml(headline)}</text>
<text x="${LEFT}" y="100" fill="${INK_MUTED}" font-size="13">${escapeXml(detail)}</text>
${panel({ rows: window.hourly, key: 'painters', title: 'painters each hour', top: 150, height: 170, showTimes: false, fromTime: window.fromTime })}
${panel({ rows: window.hourly, key: 'paints', title: 'strokes each hour', top: 380, height: 170, showTimes: true, fromTime: window.fromTime })}
<text x="${LEFT}" y="${H - 22}" fill="${INK_MUTED}" font-size="12">${escapeXml(
    `hours in UTC · from the Paint contract's events, blocks ${stats.fromBlock}–${stats.toBlock} · builder and guest wallets excluded`,
  )}</text>
</svg>
`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = { in: 'docs/launch-24h-stats.json', out: 'docs/media/launch-24h.svg' }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--in') options.in = argv[i + 1]
    else if (argv[i] === '--out') options.out = argv[i + 1]
    else throw new Error(`unknown flag ${argv[i]}`)
  }
  const svg = renderLaunchChart(JSON.parse(readFileSync(options.in, 'utf8')))
  mkdirSync(dirname(options.out), { recursive: true })
  writeFileSync(options.out, svg)
  console.log(`wrote ${options.out}`)
}
