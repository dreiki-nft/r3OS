#!/usr/bin/env node
/**
 * Export the current season's Season Replay: every Painted event on the shared canvas, in order, as a
 * static file the site serves (public/replay/season-N.json). Read-only: never signs or sends anything.
 *
 *   node scripts/export-replay.mjs                 # mainnet defaults, current season
 *   node scripts/export-replay.mjs --season 0 --range 100 --concurrency 8
 *
 * If public/replay/season-N.json already exists for the same season, only the blocks after its last
 * block are scanned and appended, so refreshing the replay takes minutes, not the whole season again.
 * Pass --full to rescan the season from its first block.
 *
 * Anyone can rerun it and get the same events, so the replay can be checked against the chain.
 * Pass --rpc to use another endpoint; the URL is never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, http, parseAbi } from 'viem'
import { chunks, PAINTED } from './community-stats-lib.mjs'
import { appendReplay, buildReplay, defaultOutlineHex } from './replay-lib.mjs'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const options = {
  rpc: 'https://rpc.monad.xyz',
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
  // rpc.monad.xyz answers eth_getLogs for at most 100 blocks; bigger windows get split and retried.
  range: 100,
  concurrency: 4,
  out: 'public/replay',
}
try {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--full') {
      options.full = true
      continue
    }
    const value = argv[++i]
    if (value == null) throw new Error(`${flag} needs a value`)
    if (flag === '--rpc') options.rpc = value
    else if (flag === '--paint') options.paint = value
    else if (flag === '--season') options.season = BigInt(value)
    else if (flag === '--from-block') options.fromBlock = BigInt(value)
    else if (flag === '--range') options.range = Number(value)
    else if (flag === '--concurrency') options.concurrency = Number(value)
    else if (flag === '--out') options.out = value
    else throw new Error(`unknown flag ${flag.split('=')[0]}`)
  }
  if (!ADDRESS.test(options.paint)) throw new Error('--paint is not an address')
  if (!Number.isInteger(options.range) || options.range < 1)
    throw new Error('--range must be a positive integer')
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16)
    throw new Error('--concurrency must be 1-16')
} catch (error) {
  console.error(`export-replay: ${error.message}`)
  process.exit(2)
}

const client = createPublicClient({ transport: http(options.rpc, { retryCount: 4, retryDelay: 400 }) })
const abi = parseAbi([
  'function SEASON_START() view returns (uint64)',
  'function currentSeason() view returns (uint256)',
  'function seasonStartTime(uint256 season) view returns (uint256)',
  'function seasonInfo(uint256 season) view returns (uint256 startsAt, uint256 endsAt, uint8 face, uint8 background, uint64 regularFrames, bool finaleMinted, uint256 finaleTokenId, uint256 successfulPaints)',
  'function hasCustomOutline(uint256 season) view returns (bool)',
  'function seasonOutlineRuns(uint256 season) view returns (bytes)',
])
const read = (functionName, args = []) =>
  client.readContract({ address: options.paint, abi, functionName, args })

async function firstBlockAtOrAfter(timestamp, head) {
  let low = 0n
  let high = head
  while (low < high) {
    const mid = (low + high) / 2n
    if ((await client.getBlock({ blockNumber: mid })).timestamp < timestamp) low = mid + 1n
    else high = mid
  }
  return low
}

async function paintedLogs(fromBlock, toBlock) {
  const rows = chunks(fromBlock, toBlock, options.range)
  const found = []
  const total = toBlock - fromBlock + 1n
  let next = 0
  let scanned = 0n
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++]
      for (let attempt = 0; ; attempt++) {
        try {
          found.push(...(await client.getLogs({ address: options.paint, event: PAINTED, ...row })))
          break
        } catch (error) {
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
      // Progress in blocks, not windows: a window the RPC rejects as too big is split in two, so a window
      // count would keep growing and look like it never ends.
      scanned += row.toBlock - row.fromBlock + 1n
      if (process.stderr.isTTY)
        process.stderr.write(
          `\rscanning blocks: ${Number((scanned * 1000n) / total) / 10}% · ${found.length} paints found`,
        )
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker))
  if (process.stderr.isTTY) process.stderr.write('\n')
  return found
}

try {
  const head = await client.getBlockNumber()
  const chainId = await client.getChainId()
  const season = options.season ?? (await read('currentSeason'))
  const file = `${options.out}/season-${season}.json`
  const info = await read('seasonInfo', [season])
  const custom = await read('hasCustomOutline', [season])
  const outline = String(custom ? await read('seasonOutlineRuns', [season]) : defaultOutlineHex()).toLowerCase()

  // Refresh: reuse the existing file for this season and scan only what came after it.
  let existing
  if (!options.full && options.fromBlock == null && existsSync(file)) {
    const previous = JSON.parse(readFileSync(file, 'utf8'))
    const same =
      previous.version === 1 &&
      previous.chainId === chainId &&
      previous.season === Number(season) &&
      String(previous.paint).toLowerCase() === options.paint.toLowerCase() &&
      String(previous.outline).toLowerCase() === outline
    if (same) existing = previous
    else console.log(`${file} is for another chain, contract or season; rescanning the whole season`)
  }

  const fromBlock = existing
    ? BigInt(existing.fromBlock)
    : (options.fromBlock ?? (await firstBlockAtOrAfter(BigInt(await read('seasonStartTime', [season])), head)))
  const scanFrom = existing ? BigInt(existing.toBlock) + 1n : fromBlock
  if (existing && scanFrom > head) {
    console.log(`${file} is already up to date (block ${existing.toBlock})`)
    process.exit(0)
  }
  if (existing) console.log(`appending to ${file}: scanning blocks ${scanFrom}–${head}`)
  const logs = await paintedLogs(scanFrom, head)
  const [fromHeader, toHeader] = await Promise.all([
    existing ? undefined : client.getBlock({ blockNumber: fromBlock }),
    client.getBlock({ blockNumber: head }),
  ])
  const built = buildReplay(logs, {
    chainId,
    paint: options.paint,
    season,
    fromBlock,
    toBlock: head,
    fromTime: existing ? existing.fromTime : fromHeader.timestamp,
    toTime: toHeader.timestamp,
    face: info[2],
    background: info[3],
    outline,
  })
  const replay = existing ? appendReplay(existing, built) : built
  mkdirSync(options.out, { recursive: true })
  writeFileSync(file, JSON.stringify(replay))
  console.log(
    `wrote ${file}: ${replay.events.length.toLocaleString('en-US')} paints by ${replay.painters.length} wallets, blocks ${fromBlock}–${head}` +
      (existing ? ` (${built.events.length.toLocaleString('en-US')} new)` : ''),
  )
} catch (error) {
  const message = String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')
  console.error(`export-replay failed: ${message}`)
  process.exit(1)
}
