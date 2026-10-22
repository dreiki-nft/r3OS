#!/usr/bin/env node
/**
 * Export every Live Mode session started on the Paint contract (SessionStarted events) to the static file the
 * site serves, public/live/sessions.json, so r3OS can show someone the Live Mode wallets they started in
 * another browser that still hold MON. Read-only: never signs or sends anything.
 *
 *   node scripts/export-sessions.mjs                       # mainnet defaults
 *   node scripts/export-sessions.mjs --range 100 --concurrency 8
 *
 * The first run scans from the season start once; after that only the blocks since the file's last block are
 * scanned and appended (run it whenever you refresh the Season Replay). --full rescans from the start.
 * Pass --rpc to use another endpoint; the URL is never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createPublicClient, http, parseAbi } from 'viem'
import { chunks } from './community-stats-lib.mjs'
import { SESSION_STARTED, appendSessions, buildSessions, sameIndex } from './live-sessions-lib.mjs'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const options = {
  rpc: 'https://rpc.monad.xyz',
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
  // rpc.monad.xyz answers eth_getLogs for at most 100 blocks; bigger windows get split and retried.
  range: 100,
  concurrency: 4,
  out: 'public/live/sessions.json',
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
  console.error(`export-sessions: ${error.message}`)
  process.exit(2)
}

const client = createPublicClient({ transport: http(options.rpc, { retryCount: 4, retryDelay: 400 }) })

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

async function sessionLogs(fromBlock, toBlock) {
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
          found.push(...(await client.getLogs({ address: options.paint, event: SESSION_STARTED, ...row })))
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
      scanned += row.toBlock - row.fromBlock + 1n
      if (process.stderr.isTTY)
        process.stderr.write(
          `\rscanning blocks: ${Number((scanned * 1000n) / total) / 10}% · ${found.length} sessions found`,
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
  let existing
  if (!options.full && options.fromBlock == null && existsSync(options.out)) {
    const previous = JSON.parse(readFileSync(options.out, 'utf8'))
    if (sameIndex(previous, { chainId, paint: options.paint })) existing = previous
    else console.log(`${options.out} is for another chain or contract; rescanning from the season start`)
  }
  if (existing && BigInt(existing.toBlock) >= head) {
    console.log(`${options.out} is already up to date (block ${existing.toBlock})`)
    process.exit(0)
  }
  const start =
    options.fromBlock ??
    (await firstBlockAtOrAfter(
      BigInt(
        await client.readContract({
          address: options.paint,
          abi: parseAbi(['function SEASON_START() view returns (uint64)']),
          functionName: 'SEASON_START',
        }),
      ),
      head,
    ))
  const scanFrom = existing ? BigInt(existing.toBlock) + 1n : start
  if (existing) console.log(`appending to ${options.out}: scanning blocks ${scanFrom}–${head}`)
  const built = buildSessions(await sessionLogs(scanFrom, head), {
    chainId,
    paint: options.paint,
    fromBlock: scanFrom,
    toBlock: head,
  })
  const index = existing ? appendSessions(existing, built) : built
  mkdirSync(dirname(options.out), { recursive: true })
  writeFileSync(options.out, JSON.stringify(index))
  console.log(
    `wrote ${options.out}: ${index.sessions.length} Live Mode sessions by ${new Set(index.sessions.map((row) => row[0])).size} wallets, blocks ${index.fromBlock}–${index.toBlock}` +
      (existing ? ` (${built.sessions.length} new)` : ''),
  )
} catch (error) {
  const message = String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')
  console.error(`export-sessions failed: ${message}`)
  process.exit(1)
}
