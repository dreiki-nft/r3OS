#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http } from 'viem'
import {
  MON_USD_FEED,
  evaluateOracleProbe,
  formatOracleProbe,
} from './mainnet-oracle-probe-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('r3OS MON/USD oracle probe\n\nusage:\n  RPC_URL=<mainnet-rpc> npm run mainnet:oracle\n\nReads the official chain-143 MON/USD feed at one Finalized anchor. Never signs, broadcasts, stores the RPC URL, or auto-selects MON_FEED_MAX_AGE.')
  process.exit(0)
}

const rpcUrl = process.env.RPC_URL
const outDir = resolve(root, valueOf('--out-dir', 'artifacts'))
if (!rpcUrl) {
  console.error('RPC_URL is required in the local environment')
  process.exit(2)
}

const abi = [
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
]

try {
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 5_000 }) })
  const chainId = await client.getChainId()
  const finalized = await client.getBlock({ blockTag: 'finalized' })
  const [code, description, decimals, round] = await Promise.all([
    client.getBytecode({ address: MON_USD_FEED, blockNumber: finalized.number }),
    client.readContract({ address: MON_USD_FEED, abi, functionName: 'description', blockNumber: finalized.number }),
    client.readContract({ address: MON_USD_FEED, abi, functionName: 'decimals', blockNumber: finalized.number }),
    client.readContract({ address: MON_USD_FEED, abi, functionName: 'latestRoundData', blockNumber: finalized.number }),
  ])
  const result = evaluateOracleProbe({
    chainId,
    finalized,
    code: code ?? '0x',
    oracle: {
      description,
      decimals,
      roundId: round[0],
      answer: round[1],
      updatedAt: round[3],
      answeredInRound: round[4],
    },
  })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'mainnet-oracle-probe.json'), `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(resolve(outDir, 'MAINNET_ORACLE_PROBE.txt'), `${formatOracleProbe(result)}\n`)
  console.log(formatOracleProbe(result))
  process.exit(result.pass ? 0 : 1)
} catch (error) {
  const message = String(error?.shortMessage ?? error?.message ?? error).split(rpcUrl).join('<REDACTED_RPC_URL>')
  console.error(`oracle probe failed: ${message}`)
  process.exit(1)
}
