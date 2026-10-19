#!/usr/bin/env node
/**
 * Storm Chaser Trilogy: lists the wallets that painted at least one pixel during EVERY given DF1 storm,
 * read from the Paint contract's own Painted events on Monad mainnet, and writes the raffle inputs.
 *
 *   node scripts/storm-chasers.mjs --storms 115400000,116000000,116200000 \
 *     --exclude 0xTeamWallet,0xOtherTeamWallet --exclude-file guest-wallets.local.json
 *
 * Writes to --out (default ./storm-chasers-out, gitignored):
 *   storm-chasers.txt   one address per line, the list to publish
 *   raffle-inputs.json  snapshotBlock, snapshotHash and loadTicketsBatch batches (1 ticket per wallet)
 * Read-only: it never signs or sends anything. Pass --rpc to use another endpoint; the URL is never printed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, http } from 'viem'
import { PAINTED, chunks } from './community-stats-lib.mjs'
import {
  batches,
  chasers,
  listHash,
  parseArgs,
  report,
  stormPainters,
  stormWindow,
} from './storm-chasers-lib.mjs'

const MAINNET = {
  rpc: 'https://rpc.monad.xyz',
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
  out: 'storm-chasers-out',
}

let options
try {
  options = {
    ...MAINNET,
    ...Object.fromEntries(
      Object.entries(parseArgs(process.argv.slice(2))).filter(([, v]) => v !== undefined),
    ),
  }
} catch (error) {
  console.error(`storm-chasers: ${error.message}`)
  process.exit(2)
}

const client = createPublicClient({ transport: http(options.rpc, { retryCount: 4, retryDelay: 400 }) })

async function logs(window) {
  const found = []
  for (const row of chunks(window.start, window.end, options.range)) {
    for (let attempt = 0; ; attempt++) {
      try {
        found.push(...(await client.getLogs({ address: options.paint, event: PAINTED, ...row })))
        break
      } catch (error) {
        if (attempt >= 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
      }
    }
  }
  return found
}

try {
  const head = await client.getBlockNumber()
  const storms = options.storms.map(stormWindow)
  const pending = storms.filter((window) => window.end > head)
  if (pending.length) {
    console.error(
      `storm-chasers: storm at block ${pending[0].start} has not finished yet (chain is at ${head}). Run again after block ${pending.at(-1).end}.`,
    )
    process.exit(2)
  }
  const perStorm = []
  for (const [i, window] of storms.entries()) {
    process.stderr.write(`reading storm ${i + 1}/${storms.length} (blocks ${window.start}-${window.end})…\n`)
    perStorm.push(stormPainters(await logs(window), window))
  }
  const entrants = chasers(perStorm, options.exclude)
  const excluded = options.exclude.filter((wallet) => perStorm.every((set) => set.has(wallet))).length
  const hash = listHash(entrants)
  const snapshotBlock = storms.at(-1).end

  mkdirSync(options.out, { recursive: true })
  writeFileSync(join(options.out, 'storm-chasers.txt'), entrants.join('\n') + (entrants.length ? '\n' : ''))
  writeFileSync(
    join(options.out, 'raffle-inputs.json'),
    JSON.stringify(
      {
        storms: storms.map((window, i) => ({
          start: String(window.start),
          end: String(window.end),
          painters: perStorm[i].size,
        })),
        entrants: entrants.length,
        snapshotBlock: String(snapshotBlock),
        snapshotHash: hash,
        batches: batches(entrants, options.batch),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(report({ storms, perStorm, entrants, excluded, hash, snapshotBlock }))
  console.log(
    `\nwrote ${join(options.out, 'storm-chasers.txt')} and ${join(options.out, 'raffle-inputs.json')}`,
  )
} catch (error) {
  console.error(`storm-chasers: ${error?.shortMessage ?? error?.message ?? error}`)
  process.exit(1)
}
