#!/usr/bin/env node
/**
 * One command after each storm (or any time): refreshes everything the site and README show from the chain,
 * for the season running now.
 *   1. Season Replay          public/replay/season-N.json      (only new blocks)
 *   2. Live Mode sessions     public/live/sessions.json        (only new blocks)
 *   3. season stats           docs/season-stats.json (season 1), docs/season-2-stats.json, …
 *                             (written to a temp file first, never truncated; AI agents counted apart)
 *   4. season chart           docs/media/season-days.svg (season 1), docs/media/season-2-days.svg, …
 *   5. season 1 only: Storm Chasers  public/storms/season-1.json + storm-chasers-out/
 *
 *   node scripts/season-refresh.mjs              # or: npm run season:refresh
 *   node scripts/season-refresh.mjs --rpc <url>  # another endpoint; never printed
 *   node scripts/season-refresh.mjs --season 0   # a season that has ended (0 = season 1): its final numbers
 *
 * Wallets that are not community (builder, judge guests, anons) come from season-refresh.local.json
 * (gitignored), the same list for stats and storm tickets. Read-only: nothing is signed or sent.
 */
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createPublicClient, http, parseAbi } from 'viem'
import { finishedStorms, parseConfig, plan, refreshedFiles } from './season-refresh-lib.mjs'

const CONFIG = 'season-refresh.local.json'
const argv = process.argv.slice(2)
let rpc
let seasonFlag
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--rpc' && argv[i + 1]) rpc = argv[++i]
  else if (argv[i] === '--season' && /^[0-9]{1,3}$/.test(argv[i + 1] ?? '')) seasonFlag = Number(argv[++i])
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
for (const file of [...config.excludeFiles, ...config.agentFiles])
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
const season =
  seasonFlag ??
  Number(
    await client.readContract({
      address: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
      abi: parseAbi(['function currentSeason() view returns (uint256)']),
      functionName: 'currentSeason',
    }),
  )
const storms = finishedStorms(head)
const steps = plan({ season, storms, ...config, rpc })
console.log(
  `chain at block ${head} · season ${season + 1}` +
    (season === 0 ? ` · ${storms.length} season storm${storms.length === 1 ? '' : 's'} finished` : '') +
    '\n',
)
if (season > 0 && !config.agentFiles.length)
  console.log(
    `note: no "agentFiles" in ${CONFIG}, so AI agent paints are counted as humans. Add the agent wallets file.\n`,
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
for (const file of refreshedFiles(season)) console.log(`  git add ${file}`)
console.log(
  `  git commit -m "${season === 0 ? `Season data after storm ${storms.length}` : `Season ${season + 1} data`}"`,
)
console.log('  git push')
