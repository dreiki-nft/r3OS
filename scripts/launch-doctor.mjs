#!/usr/bin/env node
// r3OS Launch Doctor: read-only deployment verification. See docs/PRE_MAINNET_CHECKLIST.md.
// Never signs, never sends a transaction, never touches a wallet, never prints the RPC URL.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, isAddress, keccak256, parseAbi } from 'viem'
import { HELP, formatHuman, parseArgs, runDoctor, toJson } from './launch-doctor-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2), process.env)

if (args.help) {
  console.log(HELP)
  process.exit(0)
}
if (args.errors?.length) {
  console.error(`${args.errors.join('\n')}\n\n${HELP}`)
  process.exit(2)
}
if (args.unknown?.length) {
  console.error(`unknown argument(s): ${args.unknown.join(' ')}\n\n${HELP}`)
  process.exit(2)
}
if (!args.rpc || !args.paint || !isAddress(args.paint)) {
  console.error(`missing or invalid --rpc / --paint\n\n${HELP}`)
  process.exit(2)
}
if (args.expectedOwner && !isAddress(args.expectedOwner)) {
  console.error('invalid --expected-owner')
  process.exit(2)
}

const secrets = [args.rpc]
const client = createPublicClient({ transport: http(args.rpc, { timeout: 20_000, retryCount: 1 }) })
const abiCache = new Map()
const abiFor = (fragment) => {
  let abi = abiCache.get(fragment)
  if (!abi) abiCache.set(fragment, (abi = parseAbi([fragment])))
  return abi
}

/** Read-only reader: getChainId, getBlock, getCode, eth_call. Nothing else is reachable from here. */
const reader = {
  chainId: () => client.getChainId(),
  block: async () => {
    const block = await client.getBlock()
    return { number: block.number, timestamp: block.timestamp }
  },
  code: (address) => client.getCode({ address }),
  codeHash: async (address) => {
    const code = await client.getCode({ address })
    return code && code !== '0x' ? keccak256(code) : undefined
  },
  read: (address, fragment, args = []) => {
    const abi = abiFor(fragment)
    return client.readContract({ address, abi, functionName: abi[0].name, args })
  },
  call: async (to, data) => (await client.call({ to, data })).data,
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  } catch {
    return undefined
  }
}

function programIds() {
  try {
    const source = readFileSync(resolve(root, 'src/os/programs.ts'), 'utf8')
    return [...source.matchAll(/^\s{4}id: '([a-z0-9-]+)'/gm)].map((match) => match[1])
  } catch {
    return []
  }
}

const manifest = readJson('src/router/mainnet-venues.json')
const result = await runDoctor({
  reader,
  paint: args.paint,
  expectedOwner: args.expectedOwner,
  expectedChain: args.expectedChain,
  releases: readJson('public/releases.json'),
  knownProgramIds: programIds(),
  venues: manifest?.venues ?? [],
  mrcRevision: manifest?.mrc17MipCommit,
})

console.log(args.json ? toJson(result, { secrets }) : formatHuman(result, { secrets }))
process.exit(result.exitCode)
