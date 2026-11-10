#!/usr/bin/env node
/**
 * Read-only community numbers for the submission: distinct painters, returning painters, paints, pixels,
 * frames, CDs and Pass claims on Monad mainnet, counted from the contracts' own events.
 *
 *   node scripts/community-stats.mjs --exclude 0xYourWallet,0xYourTestWallet
 *   node scripts/community-stats.mjs --since 2026-10-10T21:00:00Z --hours 24 --exclude …   # a launch window
 *   … --painters-out public/season/painters.json    # also each painter's own numbers (My Pass › My Season)
 *   … --season 1 --agents-file ~/Desktop/files/agent-wallets.json   # season 2 only; AI agents counted apart
 *   … --season 1 --manifest docs/wallets.json --events docs/events.json --json   # the published numbers
 *
 * --season N counts one season (the contract's index: 0 = season 1) from its first block to its last (or the
 * chain head while it runs). --agents-file lists AI agent wallets: they are in the totals, and the JSON also
 * has "humans" and "agents" with each group's own painters, paints, pixels and days.
 * --manifest docs/wallets.json reads both lists from the public manifest (no private file needed); with --json
 * and --season the output also has "engagement": active wallets per day and week, D1/D7/D14 cohort retention,
 * concentration, per-event numbers (--events docs/events.json) and cross-season returns, for humans and agents.
 *
 * Defaults to the accepted mainnet deployment and the public RPC. It never signs or sends anything.
 * Pass --rpc to use another endpoint; the URL is never printed.
 *
 * Events already read are kept in .stats-cache/community-stats.json (gitignored, public chain data only), so
 * the first run scans the whole season and later runs fetch only the new blocks; every number is still counted
 * from the whole season. --cache <file> puts it elsewhere, --no-cache does a full scan without it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createPublicClient, http, parseAbi } from 'viem'
import { engagement, DEFINITIONS } from './engagement-lib.mjs'
import {
  CD_BURNED,
  FRAME_MINTED,
  PAINTED,
  TRANSFER,
  cacheKey,
  chunks,
  emptyCache,
  markdown,
  mergeCache,
  parseArgs,
  readCache,
  scanStart,
  perWallet,
  paintRecords,
  paintedSeason,
  summarizeSplit,
  unpackLog,
  windowMarkdown,
  writeCache,
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
const paintAbi = parseAbi([
  'function SEASON_START() view returns (uint64)',
  'function seasonStartTime(uint256 season) view returns (uint256)',
  'function seasonInfo(uint256 season) view returns (uint256 startsAt, uint256 endsAt, uint8 face, uint8 background, uint64 regularFrames, bool finaleMinted, uint256 finaleTokenId, uint256 successfulPaints)',
])
const readPaint = (functionName, args = []) =>
  client.readContract({ address: options.paint, abi: paintAbi, functionName, args })

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
    const seasonStart = await readPaint('SEASON_START')
    fromBlock = await firstBlockAtOrAfter(BigInt(seasonStart), head)
  }
  const seasonFrom = fromBlock

  // One season: its own first block, and its last block once it has ended (later blocks are the next season).
  let seasonRange
  if (options.season != null) {
    const season = BigInt(options.season)
    const startsAt = BigInt(await readPaint('seasonStartTime', [season]))
    const startBlock = await firstBlockAtOrAfter(startsAt, head)
    const endsAt = BigInt((await readPaint('seasonInfo', [season]))[1])
    const headTime = (await client.getBlock({ blockNumber: head })).timestamp
    if (endsAt > 0n && headTime >= endsAt) head = (await firstBlockAtOrAfter(endsAt, head)) - 1n
    if (startBlock > head) throw new Error(`season ${options.season + 1} has not started by block ${head}`)
    seasonRange = { startBlock, startsAt }
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

  // The events: from the cache where it has them, from the chain for the rest. The cache always starts at the
  // season start, so --from-block or a launch window that begins earlier is read without it.
  const useCache =
    options.cache && options.fromBlock == null && !(windowRange && windowRange.startBlock < seasonFrom)
  const key = cacheKey(options, seasonFrom)
  let cache = (useCache && readCache(options.cache, key)) || emptyCache(key, seasonFrom)
  const cachedTo = BigInt(cache.lastBlock)
  let scanned = 0n
  if (head > cachedTo) {
    const scanFrom = useCache ? scanStart(cache, seasonFrom) : fromBlock
    const fresh = {
      painted: await logsFor(options.paint, PAINTED, scanFrom, head, 'paints'),
      frames: await logsFor(options.paint, FRAME_MINTED, scanFrom, head, 'frames'),
      cds: await logsFor(options.cdBurner, CD_BURNED, scanFrom, head, 'cds'),
      passes: await logsFor(options.pass, TRANSFER, scanFrom, head, 'passes'),
    }
    cache = mergeCache(cache, fresh, scanFrom, head)
    scanned = head - scanFrom + 1n
  }
  const upTo = (kind) =>
    cache.logs[kind].map(unpackLog).filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= head)
  const painted = upTo('painted').filter(
    (log) => options.season == null || paintedSeason(log) === options.season,
  )
  const statsFrom = windowRange?.startBlock ?? seasonRange?.startBlock ?? fromBlock
  const inRange = (log) => BigInt(log.blockNumber) >= statsFrom && BigInt(log.blockNumber) <= head
  const frames = upTo('frames').filter(inRange)
  const cds = upTo('cds').filter(inRange)
  const passes = upTo('passes').filter(inRange)

  // Timestamps for "came back on another day" and the day-by-day rows: one header read per distinct block with
  // a paint that the cache doesn't know yet, several at a time.
  const times = new Map(Object.entries(cache.times).map(([block, time]) => [BigInt(block), BigInt(time)]))
  const blocks = [...new Set(painted.map((log) => log.blockNumber))].filter((block) => !times.has(block))
  let next = 0
  let read = 0
  const timeWorker = async () => {
    while (next < blocks.length) {
      const block = blocks[next++]
      // A public RPC drops the odd request in a run of thousands: retry a few times before giving up.
      for (let attempt = 0; ; attempt++) {
        try {
          times.set(block, (await client.getBlock({ blockNumber: block })).timestamp)
          break
        } catch (error) {
          if (attempt >= 4) throw error
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
        }
      }
      read += 1
      if (process.stderr.isTTY && read % 50 === 0)
        process.stderr.write(`\rblock times: ${read}/${blocks.length}`)
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, timeWorker))
  if (process.stderr.isTTY && blocks.length) process.stderr.write(`\rblock times: ${read}/${blocks.length}\n`)
  for (const log of painted) log.blockTimestamp = times.get(log.blockNumber)
  if (useCache) {
    cache.times = Object.fromEntries([...times].map(([block, time]) => [String(block), String(time)]))
    writeCache(options.cache, cache)
  }
  // One line on stderr (stdout stays clean JSON/markdown when redirected to a file).
  console.error(
    `community-stats: scanned ${scanned.toLocaleString('en-US')} blocks${
      useCache
        ? cachedTo >= seasonFrom
          ? ` (the rest from the cache, up to block ${cachedTo})`
          : ' (cache was empty: full scan)'
        : ' (no cache)'
    }, ${blocks.length} new block times, up to block ${head}`,
  )

  const stats = summarizeSplit(
    { painted: painted.filter(inRange), frames, cds, passes },
    options.exclude,
    options.agents,
  )
  if (options.paintersOut) {
    // My Season ranks people: AI agents are left out of it.
    const rows = perWallet({ painted: painted.filter(inRange), frames, cds }, [
      ...options.exclude,
      ...options.agents,
    ])
    mkdirSync(dirname(options.paintersOut), { recursive: true })
    writeFileSync(
      options.paintersOut,
      JSON.stringify({
        version: 1,
        chainId: 143,
        ...(options.season != null ? { season: options.season + 1 } : {}),
        toBlock: String(head),
        asOf: new Date().toISOString(),
        painters: rows,
      }) + '\n',
    )
    console.error(`community-stats: wrote ${options.paintersOut} (${rows.length} painters)`)
  }
  const window = windowRange
    ? windowStats(painted, {
        fromTime: windowRange.fromTime,
        toTime: windowRange.toTime,
        exclude: options.exclude,
      })
    : undefined
  const asOf = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

  // Engagement (one season, JSON): from the same public events, humans and AI agents apart.
  let engagementOut
  if (options.json && seasonRange) {
    const toTime = Number(times.get(head) ?? (await client.getBlock({ blockNumber: head })).timestamp)
    const coverage = {
      fromBlock: String(statsFrom),
      toBlock: String(head),
      fromTime: Number(seasonRange.startsAt),
      toTime,
    }
    const records = paintRecords(painted.filter(inRange), options.exclude)
    // Every season's paints (for first-seen and cross-season numbers), with the block times already known.
    const allLogs = upTo('painted')
    for (const log of allLogs) log.blockTimestamp ??= times.get(log.blockNumber)
    const all = paintRecords(allLogs, options.exclude)
    const agents = new Set(options.agents)
    const group = (list, isAgent) => list.filter((record) => agents.has(record.owner) === isAgent)
    const windows = options.events ?? []
    engagementOut = {
      definitions: DEFINITIONS,
      humans: engagement({
        records: group(records, false),
        all: group(all, false),
        windows,
        coverage,
        season: options.season,
      }),
      ...(agents.size
        ? {
            agents: engagement({
              records: group(records, true),
              all: group(all, true),
              windows,
              coverage,
              season: options.season,
            }),
          }
        : {}),
    }
  }
  if (options.json)
    console.log(
      JSON.stringify(
        {
          ...(options.season != null ? { season: options.season + 1 } : {}),
          ...stats,
          fromBlock: String(statsFrom),
          toBlock: String(head),
          asOf,
          ...(options.walletGroups ? { walletGroups: options.walletGroups } : {}),
          ...(window ? { window } : {}),
          ...(engagementOut ? { engagement: engagementOut } : {}),
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
