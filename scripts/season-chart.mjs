#!/usr/bin/env node
/**
 * Day-by-day chart of the season so far, for the README. Reads the JSON written by
 *   node scripts/community-stats.mjs --range 100 --exclude … --json > docs/season-stats.json
 * and writes an SVG (GitHub renders it in the README):
 *   node scripts/season-chart.mjs                                    # docs/season-stats.json → docs/media/season-days.svg
 *   node scripts/season-chart.mjs --in stats.json --out chart.svg --from 2026-10-10
 * Same look as the launch chart: two small multiples on one day axis, painters each day and strokes each day.
 * Days with no paint are drawn as empty slots, so a quiet day is visible instead of skipped.
 * When the stats have "humans" and "agents" (community-stats --agents-file), each bar is split: humans at the
 * bottom, AI agents on top, the total above it.
 *   node scripts/season-chart.mjs --in docs/season-2-stats.json --out docs/media/season-2-days.svg
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { niceScale } from './launch-chart.mjs'

const W = 1200
const H = 640
const LEFT = 72
const RIGHT = 32
const SURFACE = '#0b0b0c'
const GRID = '#232326'
const INK = '#f2efe9'
const INK_SOFT = '#d6d2cb'
const INK_MUTED = '#8f8b85'
const BAR = '#1fa79c'
const AGENT_BAR = '#e5484d'
const FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const escapeXml = (text) =>
  String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c])
const fmt = (n) => Number(n).toLocaleString('en-US')
const dayLabel = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`

/** Every UTC day from `from` to the last day in the data, with zeros for days nobody painted. */
export function dayRows(daily, from) {
  const known = new Map(daily.map((row) => [row.day, row]))
  const last = daily.at(-1)?.day
  if (!last) return []
  const rows = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10)
    rows.push(known.get(day) ?? { day, painters: 0, newPainters: 0, paints: 0, pixels: 0 })
  }
  return rows
}

function column(x, y, width, height) {
  const r = Math.min(4, height, width / 2)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

function panel({ rows, key, title, unit, top, height, showDays, split }) {
  const plotW = W - LEFT - RIGHT
  const band = plotW / rows.length
  const barW = Math.min(64, Math.max(4, band * 0.62))
  const values = rows.map((row) => Number(row[key]) || 0)
  const max = Math.max(...values)
  const { top: axisTop, step } = niceScale(max * 1.18)
  const y = (v) => top + height - (v / axisTop) * height
  const parts = [`<text x="${LEFT}" y="${top - 14}" fill="${INK_SOFT}" font-size="15">${escapeXml(title)}</text>`]
  for (let tick = 0; tick <= axisTop; tick += step) {
    const ty = y(tick).toFixed(1)
    parts.push(`<line x1="${LEFT}" x2="${W - RIGHT}" y1="${ty}" y2="${ty}" stroke="${GRID}" stroke-width="1"/>`)
    parts.push(`<text x="${LEFT - 10}" y="${ty}" dy="4" text-anchor="end" fill="${INK_MUTED}" font-size="12">${fmt(tick)}</text>`)
  }
  rows.forEach((row, index) => {
    const value = values[index]
    const x = LEFT + index * band + (band - barW) / 2
    if (value > 0) {
      const barTop = y(value)
      const agents = split ? Number(row.agents?.[key]) || 0 : 0
      const tip = split
        ? `${dayLabel(row.day)}: ${fmt(value)} ${unit} (${fmt(value - agents)} humans, ${fmt(agents)} AI agents)`
        : `${dayLabel(row.day)}: ${fmt(value)} ${unit}`
      parts.push(
        `<path d="${column(x, barTop, barW, top + height - barTop)}" fill="${agents > 0 ? AGENT_BAR : BAR}"><title>${escapeXml(tip)}</title></path>`,
      )
      // Humans are the lower part of the bar; the rounded top that stays red is the agents' share.
      if (agents > 0 && value - agents > 0) {
        const humansTop = y(value - agents)
        parts.push(
          `<rect x="${x}" y="${humansTop.toFixed(1)}" width="${barW}" height="${(top + height - humansTop).toFixed(1)}" fill="${BAR}"><title>${escapeXml(tip)}</title></rect>`,
        )
      }
      parts.push(`<text x="${x + barW / 2}" y="${barTop - 8}" text-anchor="middle" fill="${INK}" font-size="13" font-weight="600">${fmt(value)}</text>`)
    }
    if (showDays)
      parts.push(`<text x="${LEFT + index * band + band / 2}" y="${top + height + 22}" text-anchor="middle" fill="${INK_MUTED}" font-size="12">${dayLabel(row.day)}</text>`)
  })
  return parts.join('\n')
}

export function renderSeasonChart(stats, { from } = {}) {
  if (!Array.isArray(stats.daily) || !stats.daily.length)
    throw new Error('no daily rows in the stats JSON: rerun community-stats with --json')
  const season = Number(stats.season) || 1
  // Season 1 is drawn from the public launch; later seasons from their own first day.
  const rows = dayRows(stats.daily, from ?? (season === 1 ? '2026-10-10' : stats.daily[0].day))
  const split = Boolean(stats.humans && stats.agents)
  if (split) {
    const agentDays = new Map(stats.agents.daily.map((row) => [row.day, row]))
    for (const row of rows) row.agents = agentDays.get(row.day)
  }
  const headline = split
    ? `${fmt(stats.paints)} strokes: ${fmt(stats.humans.paints)} by ${fmt(stats.humans.painters)} humans, ${fmt(stats.agents.paints)} by ${fmt(stats.agents.painters)} AI agents`
    : `${fmt(stats.painters)} painters · ${fmt(stats.paints)} strokes · ${fmt(stats.pixels)} pixels`
  const detail = split
    ? `${fmt(stats.humans.returningPainters)} humans came back on another day · ${rows.length} day${rows.length === 1 ? '' : 's'} of season ${season} · teal: humans, red: AI agents`
    : `${fmt(stats.returningPainters)} painters came back on another day · ${rows.length} days ${season === 1 ? 'since the public launch' : `of season ${season}`}`
  const description = rows.map((row) => `${dayLabel(row.day)}: ${row.painters} painters, ${row.paints} strokes`).join('; ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" font-family="${FONT}">
<title id="t">r3OS: season ${season} day by day on Monad mainnet</title>
<desc id="d">${escapeXml(`${headline}. ${detail}. ${description}.`)}</desc>
<rect width="${W}" height="${H}" fill="${SURFACE}"/>
<text x="${LEFT}" y="48" fill="${INK}" font-size="24" font-weight="700">r3OS · season ${season}, day by day on Monad mainnet</text>
<text x="${LEFT}" y="78" fill="${INK_SOFT}" font-size="15">${escapeXml(headline)}</text>
<text x="${LEFT}" y="100" fill="${INK_MUTED}" font-size="13">${escapeXml(detail)}</text>
${panel({ rows, key: 'painters', title: 'painters each day', unit: 'painters', top: 150, height: 170, showDays: false, split })}
${panel({ rows, key: 'paints', title: 'strokes each day', unit: 'strokes', top: 380, height: 170, showDays: true, split })}
<text x="${LEFT}" y="${H - 22}" fill="${INK_MUTED}" font-size="12">${escapeXml(
    `UTC days, the last one still running · Paint contract events, blocks ${stats.fromBlock}–${stats.toBlock} · builder, guest and project-run wallets excluded${split ? ' · AI agents counted' : ''}`,
  )}</text>
</svg>
`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = { in: 'docs/season-stats.json', out: 'docs/media/season-days.svg' }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--in') options.in = argv[i + 1]
    else if (argv[i] === '--out') options.out = argv[i + 1]
    else if (argv[i] === '--from') options.from = argv[i + 1]
    else throw new Error(`unknown flag ${argv[i]}`)
  }
  const svg = renderSeasonChart(JSON.parse(readFileSync(options.in, 'utf8')), { from: options.from })
  mkdirSync(dirname(options.out), { recursive: true })
  writeFileSync(options.out, svg)
  console.log(`wrote ${options.out}`)
}
