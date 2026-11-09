#!/usr/bin/env node
/**
 * Fair-play review of one season from its public replay file: flags wallets for a human to look at (bot-like
 * rhythm, own-pixel farming, two wallets that look like one person, minimal event-only wallets). Flags are not
 * verdicts; the process is in docs/FAIR_PLAY.md. Offline: reads only files in this repo.
 *   node scripts/integrity-review.mjs                       # season 2 (public/replay/season-1.json)
 *   node scripts/integrity-review.mjs public/replay/season-0.json
 * Writes integrity-out/<file>.json (gitignored: flags stay private until a decision is made) and prints a summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { replayRecords, review } from './integrity-lib.mjs'
import { inWindow } from './engagement-lib.mjs'
import { parseEvents, parseManifest } from './wallet-manifest-lib.mjs'

const file = process.argv.slice(2).find((arg) => arg.endsWith('.json')) ?? 'public/replay/season-1.json'
const replay = JSON.parse(readFileSync(file, 'utf8'))
const manifest = parseManifest(readFileSync('docs/wallets.json', 'utf8'))
const windows = parseEvents(readFileSync('docs/events.json', 'utf8'))
const storms = new Map(
  JSON.parse(readFileSync('public/storms/season-1.json', 'utf8')).wallets.map((w) => [
    w.address.toLowerCase(),
    new Set(w.storms),
  ]),
)
// People only: excluded wallets and the AI agents are not reviewed.
const records = replayRecords(replay, { exclude: [...manifest.exclude, ...manifest.agents] })
const outside = new Set(records.filter((r) => !windows.some((w) => inWindow(r, w))).map((r) => r.owner))
const eventOnly = new Set(records.map((r) => r.owner).filter((owner) => !outside.has(owner)))
const result = review(records, { storms, eventOnly })

mkdirSync('integrity-out', { recursive: true })
const out = join('integrity-out', basename(file))
writeFileSync(out, JSON.stringify({ file, reviewedAt: new Date().toISOString(), ...result }, null, 2) + '\n')
const kinds = {}
for (const flag of result.flags) (kinds[flag.kind] ??= []).push(flag)
console.log(`${result.wallets.length} human wallets reviewed in ${file}`)
for (const kind of ['rhythm', 'farming', 'pair', 'minimal'])
  console.log(`  ${kind.padEnd(8)} ${(kinds[kind] ?? []).length} flag(s)`)
for (const flag of result.flags)
  console.log(`  · ${flag.kind}: ${flag.wallets.join(' + ')}: ${flag.evidence}`)
console.log(
  `\nwrote ${out}. Flags are leads for a human review (docs/FAIR_PLAY.md), never automatic decisions.`,
)
