#!/usr/bin/env node
/** Offline pre-submission check. No RPC, no signing, no credentials. */
import { readFileSync } from 'node:fs'
import { inspectSubmissionReplay } from './submission-smoke-lib.mjs'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--season' || !/^\d{1,6}$/.test(args[1])) {
  console.error('usage: node scripts/submission-smoke.mjs --season 0')
  process.exit(2)
}
const season = Number(args[1])
const path = `public/replay/season-${season}.json`
let replay
try {
  replay = JSON.parse(readFileSync(path, 'utf8'))
} catch {
  console.error(
    `SUBMISSION BLOCKER: ${path} is missing or invalid. Run node scripts/export-replay.mjs --season ${season}, then publish the file.`,
  )
  process.exit(1)
}
const errors = inspectSubmissionReplay(replay, season)
if (errors.length) {
  for (const error of errors) console.error(`SUBMISSION BLOCKER: ${error}`)
  process.exit(1)
}
console.log(
  `submission replay OK: season ${season}; ${replay.events.length} real events; ${replay.painters.length} wallets; ending at block ${replay.toBlock}`,
)
console.log(
  'Reminder: verify the deployed site returns this JSON and replay renders. These checks are offline, not chain verification.',
)
