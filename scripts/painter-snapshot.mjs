#!/usr/bin/env node
/**
 * Snapshot of the wallets that painted the canvas in a block range, read from the Paint contract's own
 * Painted events. A paint sent through Live Mode counts for the wallet that owns the session, not the
 * browser key. Read-only: never signs or sends anything.
 *
 *   node scripts/painter-snapshot.mjs --from-block 113140000 --to-block 113170000
 *   node scripts/painter-snapshot.mjs --from-block … --to-block … --exclude 0xYou,0xYourTest --exclude-file guest-wallets.local.json
 *
 * Writes painters-<from>-<to>.csv (address, paints, pixels, first block, last block) and
 * painters-<from>-<to>.txt (one address per line, ready for an airdrop or allowlist tool).
 * Pass --rpc to use another endpoint; the URL is never printed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, http } from 'viem'
import { PAINTED, chunks } from './community-stats-lib.mjs'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const options = {
  rpc: 'https://rpc.monad.xyz',
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
  range: 100, // rpc.monad.xyz answers eth_getLogs for at most 100 blocks
  concurrency: 8,
  exclude: new Set(),
}

try {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[++i]
    if (value == null) throw new Error(`${flag} needs a value`)
    if (flag === '--from-block') options.fromBlock = BigInt(value.replace(/[,_]/g, ''))
    else if (flag === '--to-block') options.toBlock = BigInt(value.replace(/[,_]/g, ''))
    else if (flag === '--rpc') options.rpc = value
    else if (flag === '--paint') options.paint = value
    else if (flag === '--range') options.range = Number(value)
    else if (flag === '--concurrency') options.concurrency = Number(value)
    else if (flag === '--exclude')
      for (const address of value.split(',').filter(Boolean)) {
        if (!ADDRESS.test(address)) throw new Error(`--exclude: ${address} is not an address`)
        options.exclude.add(address.toLowerCase())
      }
    else if (flag === '--exclude-file') {
      if (!existsSync(value)) throw new Error(`--exclude-file: ${value} not found`)
      const text = readFileSync(value, 'utf8')
      // Only addresses are taken from the file (guest-wallets.local.json also holds keys; they are never read out).
      for (const address of text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? []) options.exclude.add(address.toLowerCase())
    } else throw new Error(`unknown flag ${flag}`)
  }
  if (options.fromBlock == null || options.toBlock == null) throw new Error('--from-block and --to-block are required')
  if (options.toBlock < options.fromBlock) throw new Error('--to-block is before --from-block')
  if (!ADDRESS.test(options.paint)) throw new Error('--paint is not an address')
  if (!Number.isInteger(options.range) || options.range < 1) throw new Error('--range must be a positive integer')
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16)
    throw new Error('--concurrency must be 1-16')
} catch (error) {
  console.error(`painter-snapshot: ${error.message}`)
  process.exit(2)
}

const client = createPublicClient({ transport: http(options.rpc, { retryCount: 4, retryDelay: 400 }) })

/** Pixels a paint wrote: runs are 4-byte groups (y, x0, x1, colour). */
function runPixels(runsHex) {
  const bytes = Buffer.from(String(runsHex).slice(2), 'hex')
  let pixels = 0
  for (let o = 0; o + 3 < bytes.length; o += 4) pixels += bytes[o + 2] - bytes[o + 1] + 1
  return pixels
}

try {
  const head = await client.getBlockNumber()
  if (options.toBlock > head) throw new Error(`--to-block ${options.toBlock} is in the future (chain head is ${head})`)
  const rows = chunks(options.fromBlock, options.toBlock, options.range)
  const logs = []
  const total = options.toBlock - options.fromBlock + 1n
  let next = 0
  let scanned = 0n
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++]
      for (let attempt = 0; ; attempt++) {
        try {
          logs.push(...(await client.getLogs({ address: options.paint, event: PAINTED, ...row })))
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
        process.stderr.write(`\rscanning blocks: ${Number((scanned * 1000n) / total) / 10}% · ${logs.length} paints found`)
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker))
  if (process.stderr.isTTY) process.stderr.write('\n')

  const painters = new Map()
  let excludedPaints = 0
  for (const log of logs) {
    const owner = String(log.args.owner).toLowerCase()
    if (options.exclude.has(owner)) {
      excludedPaints++
      continue
    }
    const block = BigInt(log.blockNumber)
    const row = painters.get(owner) ?? { address: owner, paints: 0, pixels: 0, first: block, last: block }
    row.paints++
    row.pixels += runPixels(log.args.runs)
    if (block < row.first) row.first = block
    if (block > row.last) row.last = block
    painters.set(owner, row)
  }
  const sorted = [...painters.values()].sort((a, b) => b.paints - a.paints || b.pixels - a.pixels)
  const name = `painters-${options.fromBlock}-${options.toBlock}`
  writeFileSync(
    `${name}.csv`,
    ['address,paints,pixels,first_block,last_block', ...sorted.map((r) => `${r.address},${r.paints},${r.pixels},${r.first},${r.last}`)].join('\n') + '\n',
  )
  writeFileSync(`${name}.txt`, sorted.map((r) => r.address).join('\n') + (sorted.length ? '\n' : ''))
  console.log(
    `blocks ${options.fromBlock}–${options.toBlock}: ${sorted.length} wallets painted ${logs.length - excludedPaints} times` +
      (options.exclude.size ? ` (${excludedPaints} paints by ${options.exclude.size} excluded addresses left out)` : ''),
  )
  console.log(`wrote ${name}.csv and ${name}.txt`)
} catch (error) {
  const message = String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')
  console.error(`painter-snapshot failed: ${message}`)
  process.exit(1)
}
