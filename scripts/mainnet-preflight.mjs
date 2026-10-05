#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, keccak256 } from 'viem'
import { makeManifest, OFFICIAL_MAINNET } from './mainnet-manifest-lib.mjs'
import { evaluateMainnetPreflight, formatPreflightText } from './mainnet-preflight-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('r3OS mainnet preflight\n\nusage:\n  RPC_URL=<mainnet-rpc> npm run mainnet:preflight -- --input <reviewed-json> [--out-dir artifacts]\n\nRead-only chain-143 dependency/oracle/finalized checks. Never signs or broadcasts.')
  process.exit(0)
}

const inputPath = valueOf('--input')
const outDir = resolve(root, valueOf('--out-dir', 'artifacts'))
const rpcUrl = process.env.RPC_URL
if (!inputPath) {
  console.error('missing --input (use --help)')
  process.exit(2)
}
if (!rpcUrl) {
  console.error('RPC_URL is required in the local environment')
  process.exit(2)
}

let input
try {
  input = JSON.parse(readFileSync(resolve(root, inputPath), 'utf8'))
} catch (error) {
  console.error(`unable to read input JSON: ${error?.message ?? error}`)
  process.exit(2)
}

let built
try {
  built = makeManifest(input)
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}

const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 5_000 }) })
const aggregatorAbi = [
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [
    { name: 'roundId', type: 'uint80' },
    { name: 'answer', type: 'int256' },
    { name: 'startedAt', type: 'uint256' },
    { name: 'updatedAt', type: 'uint256' },
    { name: 'answeredInRound', type: 'uint80' },
  ] },
]

try {
  const chainId = await client.getChainId()
  const [finalized, latest] = await Promise.all([
    client.getBlock({ blockTag: 'finalized' }),
    client.getBlock({ blockTag: 'latest' }),
  ])
  const targets = {
    r3tards: input.r3tards,
    skrumpeys: input.partners.skrumpeys,
    monadCards: input.partners.monadCards,
    monUsdFeed: input.systemEvent.monUsdFeed,
    multicall3: OFFICIAL_MAINNET.multicall3,
  }
  const codeEntries = await Promise.all(Object.entries(targets).map(async ([id, address]) => {
    const code = await client.getBytecode({ address, blockNumber: finalized.number })
    return [id, code ?? '0x']
  }))
  const code = Object.fromEntries(codeEntries)
  const codeHashes = Object.fromEntries(codeEntries.map(([id, bytecode]) => [id, bytecode === '0x' ? null : keccak256(bytecode)]))

  const [description, decimals, round, deployerBalanceWei, priorityFeeWei] = await Promise.all([
    client.readContract({ address: input.systemEvent.monUsdFeed, abi: aggregatorAbi, functionName: 'description', blockNumber: finalized.number }),
    client.readContract({ address: input.systemEvent.monUsdFeed, abi: aggregatorAbi, functionName: 'decimals', blockNumber: finalized.number }),
    client.readContract({ address: input.systemEvent.monUsdFeed, abi: aggregatorAbi, functionName: 'latestRoundData', blockNumber: finalized.number }),
    client.getBalance({ address: input.deployer, blockNumber: finalized.number }),
    client.request({ method: 'eth_maxPriorityFeePerGas' }).catch(() => null),
  ])
  const oracle = {
    description,
    decimals,
    roundId: round[0],
    answer: round[1],
    updatedAt: round[3],
    answeredInRound: round[4],
  }

  const result = evaluateMainnetPreflight({
    manifest: input,
    manifestHash: built.hash,
    chainId,
    finalized,
    latest,
    code,
    codeHashes,
    oracle,
    deployerBalanceWei,
    priorityFeeWei: priorityFeeWei == null ? null : BigInt(priorityFeeWei),
  })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'mainnet-preflight.json'), `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(resolve(outDir, 'MAINNET_PREFLIGHT.txt'), `${formatPreflightText(result)}\n`)
  console.log(formatPreflightText(result))
  process.exit(result.readyForDeploymentApproval ? 0 : 1)
} catch (error) {
  console.error(`mainnet preflight failed: ${error?.shortMessage ?? error?.message ?? error}`)
  process.exit(1)
}
