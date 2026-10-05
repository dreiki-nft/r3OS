import fs from 'node:fs/promises'
import path from 'node:path'
import { createPublicClient, createWalletClient, defineChain, http, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  PRIORITY_CONFIRM,
  TRANSFER_GAS_LIMIT,
  assertSendGate,
  buildPriorityPlan,
  weiToGwei,
  weiToMon,
} from './priority-benchmark-lib.mjs'

const SEND = process.argv.includes('--send')
const RPC_URL = process.env.PRIORITY_BENCH_RPC_URL || 'https://rpc.monad.xyz'
const matrix = String(process.env.PRIORITY_GWEI || '0,1,2,5')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 0)

const chain = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { retryCount: 0, timeout: 3_000 }) })
const chainId = await publicClient.getChainId()
if (chainId !== 143) throw new Error(`expected Monad mainnet chain 143, got ${chainId}`)

const latest = await publicClient.getBlock({ blockTag: 'latest' })
if (latest.baseFeePerGas == null) throw new Error('latest block has no baseFeePerGas')
const suggestedPriority = await publicClient.request({ method: 'eth_maxPriorityFeePerGas' })
const plan = buildPriorityPlan(latest.baseFeePerGas, matrix)

console.log('Monad priority-fee benchmark')
console.log(`mode: ${SEND ? 'SEND ENABLED' : 'read-only plan'}`)
console.log(`base fee now: ${weiToGwei(latest.baseFeePerGas)} gwei`)
console.log(`RPC suggested priority: ${weiToGwei(BigInt(suggestedPriority))} gwei`)
for (const row of plan) {
  console.log(`priority ${row.priorityGwei} gwei · 21,000 gas · max fee cap ${weiToGwei(row.maxFeePerGas)} gwei · max ${weiToMon(row.maxCostWei)} MON`)
}

assertSendGate({
  send: SEND,
  confirmation: process.env.PRIORITY_BENCH_CONFIRM,
  chainId,
})

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  chainId,
  mode: SEND ? 'send' : 'plan',
  rpcUrlStored: false,
  suggestedPriorityWei: String(suggestedPriority),
  initialBaseFeePerGas: latest.baseFeePerGas.toString(),
  matrix: plan.map((row) => ({
    priorityGwei: row.priorityGwei,
    priorityFeePerGas: row.priorityFeePerGas.toString(),
    maxFeePerGas: row.maxFeePerGas.toString(),
    gasLimit: row.gasLimit.toString(),
    maxCostWei: row.maxCostWei.toString(),
  })),
  results: [],
  caveats: [
    'Premium RPC access is not treated as transaction inclusion priority.',
    'Each sent sample waits for canonical finalization before the next sample, avoiding same-account nonce queue interference.',
    'Network conditions can change between samples; this is an empirical launch benchmark, not a protocol guarantee.',
  ],
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitCanonicalReceipt(hash, startedAt) {
  let firstReceiptMs
  while (Date.now() - startedAt < 30_000) {
    let receipt
    try {
      receipt = await publicClient.getTransactionReceipt({ hash })
    } catch {
      await sleep(30)
      continue
    }
    if (firstReceiptMs == null) firstReceiptMs = Date.now() - startedAt
    const finalized = await publicClient.getBlock({ blockTag: 'finalized' })
    if (finalized.number != null && finalized.number >= receipt.blockNumber) {
      try {
        const canonical = await publicClient.getTransactionReceipt({ hash })
        if (canonical.blockHash === receipt.blockHash && canonical.blockNumber === receipt.blockNumber) {
          return { receipt: canonical, firstReceiptMs, finalizedMs: Date.now() - startedAt }
        }
      } catch {
        // A speculative receipt can disappear/change before finalization. Keep waiting.
      }
    }
    await sleep(30)
  }
  throw new Error('PRIORITY_BENCH_FINALIZATION_TIMEOUT')
}

if (SEND) {
  const privateKey = process.env.PRIORITY_BENCH_PRIVATE_KEY || ''
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('PRIORITY_BENCH_PRIVATE_KEY_REQUIRED')
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL, { retryCount: 0, timeout: 3_000 }) })
  let nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' })
  console.log(`sender: ${account.address}`)
  console.log(`explicit spend confirmation accepted: ${PRIORITY_CONFIRM}`)

  for (const requested of matrix) {
    const block = await publicClient.getBlock({ blockTag: 'latest' })
    if (block.baseFeePerGas == null) throw new Error('latest block has no baseFeePerGas')
    const [sample] = buildPriorityPlan(block.baseFeePerGas, [requested])
    const serialized = await account.signTransaction({
      chainId: 143,
      nonce,
      to: account.address,
      value: 0n,
      gas: TRANSFER_GAS_LIMIT,
      maxFeePerGas: sample.maxFeePerGas,
      maxPriorityFeePerGas: sample.priorityFeePerGas,
      type: 'eip1559',
    })
    const expectedHash = keccak256(serialized)
    const startedAt = Date.now()
    const hash = await publicClient.sendRawTransaction({ serializedTransaction: serialized })
    const broadcastAckMs = Date.now() - startedAt
    if (hash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('PRIORITY_BENCH_HASH_MISMATCH')
    const settled = await waitCanonicalReceipt(hash, startedAt)
    report.results.push({
      priorityGwei: requested,
      hash,
      blockNumber: settled.receipt.blockNumber.toString(),
      blockHash: settled.receipt.blockHash,
      broadcastAckMs,
      receiptObservedMs: settled.firstReceiptMs,
      finalizedMs: settled.finalizedMs,
      effectiveGasPrice: settled.receipt.effectiveGasPrice.toString(),
      gasUsed: settled.receipt.gasUsed.toString(),
    })
    console.log(`priority ${requested} gwei · ack ${broadcastAckMs} ms · receipt ${settled.firstReceiptMs} ms · finalized ${settled.finalizedMs} ms`)
    nonce += 1
  }
}

await fs.mkdir(path.resolve('artifacts'), { recursive: true })
const output = path.resolve('artifacts/priority-benchmark.json')
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(`wrote ${path.relative(process.cwd(), output)}`)
