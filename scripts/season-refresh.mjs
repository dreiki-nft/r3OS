#!/usr/bin/env node
/**
 * One command after each storm (or any time): refreshes everything the site and README show from the chain.
 *   1. Season Replay          public/replay/season-N.json      (only new blocks)
 *   2. Live Mode sessions     public/live/sessions.json        (only new blocks)
 *   3. season stats           docs/season-stats.json           (written to a temp file first, never truncated)
 *   4. season chart           docs/media/season-days.svg
 *   5. Storm Chasers          public/storms/season-1.json + storm-chasers-out/ (every season storm that ended)
 *
 *   node scripts/season-refresh.mjs              # or: npm run season:refresh
 *   node scripts/season-refresh.mjs --rpc <url>  # another endpoint; never printed
 *
 * Wallets that are not community (builder, judge guests, anons) come from season-refresh.local.json
 * (gitignored), the same list for stats and storm tickets. Read-only: nothing is signed or sent.
 */
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createPublicClient, http } from 'viem'
import { REFRESHED_FILES, finishedStorms, parseConfig, plan } from './season-refresh-lib.mjs'

const CONFIG = 'season-refresh.local.json'
const argv = process.argv.slice(2)
let rpc
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--rpc' && argv[i + 1]) rpc = argv[++i]
  else {
    console.error(`season-refresh: unknown flag ${argv[i].split('=')[0]}`)
    process.exit(2)
  }
}

if (!existsSync(CONFIG)) {
  console.error(
    `season-refresh: ${CONFIG} is missing. Create it in the repo folder (it is gitignored):\n` +
      `  { "exclude": ["0xYourWallet", "0xGuestWallet"], "excludeFiles": ["~/Desktop/files/anon-wallets.json"] }`,
  )
  process.exit(2)
}
const config = parseConfig(readFileSync(CONFIG, 'utf8'))
for (const file of config.excludeFiles)
  if (!existsSync(file)) {
    console.error(`season-refresh: exclude file not found: ${file}`)
    process.exit(2)
  }

const client = createPublicClient({
  transport: http(rpc ?? 'https://rpc.monad.xyz', { retryCount: 4, retryDelay: 400 }),
})
const head = await client.getBlockNumber().catch((error) => {
  console.error(
    `season-refresh: could not read the chain head (${error?.shortMessage ?? 'rpc error'}). Try again.`,
  )
  process.exit(1)
})
const storms = finishedStorms(head)
const steps = plan({ storms, ...config, rpc })
console.log(
  `chain at block ${head} · ${storms.length} season storm${storms.length === 1 ? '' : 's'} finished\n`,
)

const started = Date.now()
for (const [i, step] of steps.entries()) {
  console.log(`[${i + 1}/${steps.length}] ${step.label}`)
  let fd
  const temp = step.stdoutTo && `${step.stdoutTo}.tmp`
  if (temp) fd = openSync(temp, 'w')
  const result = spawnSync(process.execPath, [step.script, ...step.args], {
    stdio: ['ignore', fd ?? 'inherit', 'inherit'],
  })
  if (fd != null) closeSync(fd)
  if (result.status !== 0) {
    if (temp) rmSync(temp, { force: true })
    console.error(
      `\nseason-refresh: step ${i + 1} (${step.label}) failed. Steps before it are already saved; rerun to retry.`,
    )
    process.exit(1)
  }
  if (temp) {
    JSON.parse(readFileSync(temp, 'utf8')) // only replace the stats file with complete JSON
    renameSync(temp, step.stdoutTo)
  }
  console.log('')
}

console.log(`done in ${Math.round((Date.now() - started) / 1000)}s. To publish:`)
// one short line per file: long lines wrap in the terminal and break when copied
for (const file of REFRESHED_FILES) console.log(`  git add ${file}`)
console.log(`  git commit -m "Season data after storm ${storms.length}"`)
console.log('  git push')
