#!/usr/bin/env node
/**
 * Real gas and MON cost of recent paints on Monad mainnet, read from the Paint contract's own Painted events
 * and their transaction receipts. Read-only: never signs or sends anything.
 *
 *   node scripts/paint-gas-sample.mjs                     # last 20,000 blocks, up to 300 paints
 *   node scripts/paint-gas-sample.mjs --blocks 60000 --max 600
 *
 * Fits gas ≈ base + perRun·runs + perPixel·pixels so costs can be predicted for any stroke shape, and writes
 * every sample to paint-gas-sample.json in the current folder. Monad charges the gas LIMIT, so the MON cost
 * uses limit × price; gas used is reported too. Pass --rpc to use another endpoint; the URL is never printed.
 */
import { writeFileSync } from 'node:fs'
import { createPublicClient, formatEther, http } from 'viem'
import { PAINTED, chunks } from './community-stats-lib.mjs'

const options = {
  rpc: 'https://rpc.monad.xyz',
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
  blocks: 20_000,
  max: 300,
  range: 100,
  concurrency: 8,
}
try {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[++i]
    if (value == null) throw new Error(`${flag} needs a value`)
    if (flag === '--rpc') options.rpc = value
    else if (flag === '--paint') options.paint = value
    else if (flag === '--blocks') options.blocks = Number(value)
    else if (flag === '--max') options.max = Number(value)
    else if (flag === '--concurrency') options.concurrency = Number(value)
    else throw new Error(`unknown flag ${flag}`)
  }
  for (const key of ['blocks', 'max', 'concurrency'])
    if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`--${key} must be a positive integer`)
} catch (error) {
  console.error(`paint-gas-sample: ${error.message}`)
  process.exit(2)
}

const client = createPublicClient({ transport: http(options.rpc, { retryCount: 4, retryDelay: 400 }) })
const safe = (error) => String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')

async function pool(items, worker) {
  let next = 0
  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (next < items.length) await worker(items[next++])
    }),
  )
}

function shape(runsHex) {
  const bytes = Buffer.from(String(runsHex).slice(2), 'hex')
  let pixels = 0
  let runs = 0
  for (let o = 0; o + 3 < bytes.length; o += 4) {
    pixels += bytes[o + 2] - bytes[o + 1] + 1
    runs++
  }
  return { runs, pixels }
}

/** Least squares for y ≈ b0 + b1·x1 + b2·x2 (normal equations, 3×3). */
function fit(rows) {
  const X = rows.map((r) => [1, r.runs, r.pixels])
  const y = rows.map((r) => r.gasUsed)
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, x) => s + x[i] * x[j], 0)))
  const b = [0, 1, 2].map((i) => X.reduce((s, x, k) => s + x[i] * y[k], 0))
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[b[c], b[p]] = [b[p], b[c]]
    if (Math.abs(A[c][c]) < 1e-9) return undefined
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < 3; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  return { base: b[0] / A[0][0], perRun: b[1] / A[1][1], perPixel: b[2] / A[2][2] }
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

try {
  const head = await client.getBlockNumber()
  const from = head - BigInt(options.blocks) + 1n
  const logs = []
  await pool(chunks(from > 0n ? from : 0n, head, options.range), async (row) => {
    for (let attempt = 0; ; attempt++) {
      try {
        logs.push(...(await client.getLogs({ address: options.paint, event: PAINTED, ...row })))
        return
      } catch (error) {
        if (attempt >= 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
      }
    }
  })
  // One Painted event per paint transaction; keep the newest ones.
  const byTx = new Map()
  for (const log of logs) if (!byTx.has(log.transactionHash)) byTx.set(log.transactionHash, log)
  const picked = [...byTx.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, options.max)
  if (!picked.length) throw new Error(`no paints in the last ${options.blocks} blocks; try a larger --blocks`)

  const samples = []
  await pool(picked, async (log) => {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: log.transactionHash }),
      client.getTransactionReceipt({ hash: log.transactionHash }),
    ])
    if (receipt.status !== 'success') return
    const { runs, pixels } = shape(log.args.runs)
    const price = receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n
    samples.push({
      tx: log.transactionHash,
      block: Number(log.blockNumber),
      liveMode: String(log.args.owner).toLowerCase() !== String(log.args.sender).toLowerCase(),
      runs,
      pixels,
      units: Number(log.args.unitsSpent),
      gasUsed: Number(receipt.gasUsed),
      gasLimit: Number(tx.gas),
      priceGwei: Number(price) / 1e9,
      chargedMon: Number(formatEther(tx.gas * price)),
    })
  })

  const model = fit(samples)
  const monPerGas = median(samples.map((s) => s.priceGwei)) * 1e-9
  const limitRatio = median(samples.map((s) => s.gasLimit / Math.max(1, s.gasUsed)))
  const summary = {
    sampledPaints: samples.length,
    blocks: `${from}–${head}`,
    liveModeShare: +(samples.filter((s) => s.liveMode).length / samples.length).toFixed(2),
    median: {
      pixels: median(samples.map((s) => s.pixels)),
      runs: median(samples.map((s) => s.runs)),
      gasUsed: median(samples.map((s) => s.gasUsed)),
      gasLimit: median(samples.map((s) => s.gasLimit)),
      limitOverUsed: +limitRatio.toFixed(3),
      priceGwei: +median(samples.map((s) => s.priceGwei)).toFixed(3),
      chargedMonPerPaint: +median(samples.map((s) => s.chargedMon)).toFixed(6),
    },
    gasModel: model && {
      base: Math.round(model.base),
      perRun: Math.round(model.perRun),
      perPixel: Math.round(model.perPixel),
    },
  }
  if (model) {
    // What the AGENT.EXE plan cares about: charged MON for common stroke shapes at today's median price.
    const cost = (runs, pixels) => (model.base + model.perRun * runs + model.perPixel * pixels) * limitRatio * monPerGas
    summary.examples = {
      'one 128-px run': +cost(1, 128).toFixed(5),
      '4 rows × 128 px': +cost(4, 512).toFixed(5),
      '64 single dots': +cost(64, 64).toFixed(5),
      '256 single dots': +cost(256, 256).toFixed(5),
    }
  }
  writeFileSync('paint-gas-sample.json', JSON.stringify({ summary, samples }, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  console.log('\nwrote paint-gas-sample.json (every sampled paint, with its tx hash)')
} catch (error) {
  console.error(`paint-gas-sample failed: ${safe(error)}`)
  process.exit(1)
}
