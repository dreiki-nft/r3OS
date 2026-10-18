#!/usr/bin/env node
/**
 * Read-only community numbers for the submission: distinct painters, returning painters, paints, pixels,
 * frames, CDs and Pass claims on Monad mainnet, counted from the contracts' own events.
 *
 *   node scripts/community-stats.mjs --exclude 0xYourWallet,0xYourTestWallet
 *   node scripts/community-stats.mjs --since 2026-10-10T21:00:00Z --hours 24 --exclude …   # a launch window
 *
 * Defaults to the accepted mainnet deployment and the public RPC. It never signs or sends anything.
 * Pass --rpc to use another endpoint; the URL is never printed.
 */
import { createPublicClient, http, parseAbi } from 'viem'
import {
  CD_BURNED,
  FRAME_MINTED,
  PAINTED,
  TRANSFER,
  chunks,
  markdown,
  parseArgs,
  summarize,
  windowMarkdown,
  windowStats,
} from './community-stats-lib.mjs'

const MAINNET = {
  rpc: 'https://rpc.monad.xyz',
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
  cdBurner: '0x5556b0ef2ffa3a970c852362ee69313c08f5b1cd',
  pass: '0xb2d2d7681f451d9c69ed5ef2a0ed0b6b6494f103',
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
  console.error(`community-stats: ${error.message}`)
  process.exit(2)
}

const client = createPublicClient({ transport: http(options.rpc, { retryCount: 4, retryDelay: 400 }) })
const paintAbi = parseAbi(['function SEASON_START() view returns (uint64)'])

async function firstBlockAtOrAfter(timestamp, head) {
  let low = 0n
  let high = head
  while (low < high) {
    const mid = (low + high) / 2n
    const block = await client.getBlock({ blockNumber: mid })
    if (block.timestamp < timestamp) low = mid + 1n
    else high = mid
  }
  return low
}

let range = options.range
async function logsFor(address, event, fromBlock, toBlock, label) {
  const rows = chunks(fromBlock, toBlock, range)
  const found = []
  let next = 0
  let done = 0
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++]
      for (let attempt = 0; ; attempt++) {
        try {
          found.push(...(await client.getLogs({ address, event, ...row })))
          break
        } catch (error) {
          // A provider range cap: split this window and retry it.
          if (/range|limit|too many|exceed/i.test(String(error?.message)) && row.toBlock > row.fromBlock) {
            const mid = (row.fromBlock + row.toBlock) / 2n
            rows.push({ fromBlock: mid + 1n, toBlock: row.toBlock })
            row.toBlock = mid
            continue
          }
          if (attempt >= 3) throw error
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
        }
      }
      done += 1
      if (process.stderr.isTTY) process.stderr.write(`\r${label}: ${done}/${rows.length} windows`)
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker))
  if (process.stderr.isTTY) process.stderr.write('\n')
  return found
}

try {
  let head = await client.getBlockNumber()
  if (options.toBlock != null && options.toBlock < head) head = options.toBlock
  let fromBlock = options.fromBlock
  if (fromBlock == null) {
    const seasonStart = await client.readContract({
      address: options.paint,
      abi: paintAbi,
      functionName: 'SEASON_START',
    })
    fromBlock = await firstBlockAtOrAfter(BigInt(seasonStart), head)
  }

  // A launch window: paints are still read from the season start (to tell new painters from earlier ones),
  // but every count below covers only the window.
  let windowRange
  if (options.since != null) {
    const fromTime = options.since
    const toTime = fromTime + BigInt(Math.round((options.hours ?? 24) * 3_600))
    const headTime = (await client.getBlock({ blockNumber: head })).timestamp
    const startBlock = await firstBlockAtOrAfter(fromTime, head)
    const endBlock = toTime > headTime ? head : (await firstBlockAtOrAfter(toTime, head)) - 1n
    windowRange = { fromTime, toTime, startBlock, endBlock }
    head = endBlock
    if (startBlock < fromBlock) fromBlock = startBlock
  }

  const painted = await logsFor(options.paint, PAINTED, fromBlock, head, 'paints')
  const statsFrom = windowRange?.startBlock ?? fromBlock
  const inRange = (log) => BigInt(log.blockNumber) >= statsFrom && BigInt(log.blockNumber) <= head
  const frames = (await logsFor(options.paint, FRAME_MINTED, statsFrom, head, 'frames')).filter(inRange)
  const cds = (await logsFor(options.cdBurner, CD_BURNED, statsFrom, head, 'cds')).filter(inRange)
  const passes = (await logsFor(options.pass, TRANSFER, statsFrom, head, 'passes')).filter(inRange)

  // Timestamps for "came back on another day" and the day-by-day rows: one header read per distinct block with
  // a paint, several at a time.
  const times = new Map()
  const blocks = [...new Set(painted.map((log) => log.blockNumber))]
  let next = 0
  const timeWorker = async () => {
    while (next < blocks.length) {
      const block = blocks[next++]
      times.set(block, (await client.getBlock({ blockNumber: block })).timestamp)
      if (process.stderr.isTTY && times.size % 50 === 0) process.stderr.write(`\rblock times: ${times.size}/${blocks.length}`)
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, timeWorker))
  if (process.stderr.isTTY) process.stderr.write(`\rblock times: ${times.size}/${blocks.length}\n`)
  for (const log of painted) log.blockTimestamp = times.get(log.blockNumber)

  const stats = summarize({ painted: painted.filter(inRange), frames, cds, passes }, options.exclude)
  const window = windowRange
    ? windowStats(painted, {
        fromTime: windowRange.fromTime,
        toTime: windowRange.toTime,
        exclude: options.exclude,
      })
    : undefined
  const asOf = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  if (options.json)
    console.log(
      JSON.stringify(
        {
          ...stats,
          fromBlock: String(statsFrom),
          toBlock: String(head),
          asOf,
          ...(window ? { window } : {}),
        },
        null,
        2,
      ),
    )
  else {
    console.log(markdown(stats, { fromBlock: statsFrom, toBlock: head, asOf }))
    if (window) console.log('\n' + windowMarkdown(window))
  }
} catch (error) {
  // Never print the RPC URL (it can carry a key); viem puts it in error.message as "URL: …".
  const message = String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')
  console.error(`community-stats failed: ${message}`)
  process.exit(1)
}
