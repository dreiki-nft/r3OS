#!/usr/bin/env node
/**
 * Storm Chaser Trilogy: the raffle tickets, read from the Paint contract's own Painted events on Monad
 * mainnet. By default every wallet that painted at least one pixel during a given DF1 storm gets 1 ticket per
 * storm (--tickets per-storm); --tickets all keeps the original rule (1 ticket, only for wallets that painted
 * in every storm).
 *
 *   node scripts/storm-chasers.mjs --storms 115400000,116000000,116200000 \
 *     --exclude 0xTeamWallet,0xOtherTeamWallet --exclude-file guest-wallets.local.json
 *
 * Writes to --out (default ./storm-chasers-out, gitignored):
 *   storm-chasers.txt   one address per ticket (a wallet with 2 tickets is listed twice), the list to publish
 *   raffle-inputs.json  snapshotBlock, snapshotHash and loadTicketsBatch batches (wallets[], tickets[])
 * --public public/storms/season-1.json also writes the leaderboard the Storm Chasers window shows (same counts).
 * Read-only: it never signs or sends anything. Pass --rpc to use another endpoint; the URL is never printed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createPublicClient, http } from 'viem'
import { PAINTED, chunks } from './community-stats-lib.mjs'
import {
  batches,
  entries,
  listHash,
  parseArgs,
  report,
  publicBoard,
  stormPainters,
  stormWindow,
  ticketList,
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
  const list = entries(perStorm, options.exclude, options.tickets)
  const all = options.tickets === 'all'
  const excluded = options.exclude.filter((wallet) =>
    all ? perStorm.every((set) => set.has(wallet)) : perStorm.some((set) => set.has(wallet)),
  ).length
  const tickets = ticketList(list)
  const hash = listHash(tickets)
  const snapshotBlock = storms.at(-1).end

  mkdirSync(options.out, { recursive: true })
  writeFileSync(join(options.out, 'storm-chasers.txt'), tickets.join('\n') + (tickets.length ? '\n' : ''))
  writeFileSync(
    join(options.out, 'raffle-inputs.json'),
    JSON.stringify(
      {
        storms: storms.map((window, i) => ({
          start: String(window.start),
          end: String(window.end),
          painters: perStorm[i].size,
        })),
        tickets: options.tickets,
        entrants: list.length,
        totalTickets: tickets.length,
        snapshotBlock: String(snapshotBlock),
        snapshotHash: hash,
        batches: batches(list, options.batch),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    report({ storms, perStorm, entries: list, mode: options.tickets, excluded, hash, snapshotBlock }),
  )
  console.log(
    `\nwrote ${join(options.out, 'storm-chasers.txt')} and ${join(options.out, 'raffle-inputs.json')}`,
  )
  if (options.public) {
    mkdirSync(dirname(options.public), { recursive: true })
    const board = publicBoard({ storms, perStorm, list, updatedAt: new Date().toISOString() })
    writeFileSync(options.public, JSON.stringify(board, null, 2) + '\n')
    console.log(`wrote ${options.public} (the Storm Chasers leaderboard)`)
  }
} catch (error) {
  console.error(`storm-chasers: ${error?.shortMessage ?? error?.message ?? error}`)
  process.exit(1)
}
