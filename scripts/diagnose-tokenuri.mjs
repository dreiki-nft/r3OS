#!/usr/bin/env node
/**
 * Read-only diagnosis for "some r3OS paint frames have no metadata on OpenSea".
 * Sends no transactions and needs no private key. Optional OpenSea checks read OPENSEA_API_KEY from the
 * environment and never print it.
 *
 *   node scripts/diagnose-tokenuri.mjs                 # tokens 0 2 3 4 5 7 on four public RPCs
 *   node scripts/diagnose-tokenuri.mjs 0 1 2 3 4 5 6 7 # pick tokens
 *   OPENSEA_API_KEY=... node scripts/diagnose-tokenuri.mjs   # also compare with OpenSea's records
 *
 * What it measures, per token:
 *   - exact gas tokenURI needs (eth_estimateGas), versus Monad's 8,100,000 low-gas pool limit;
 *   - eth_call with gas 8,100,000 (low-gas pool) and with 12,000,000 (high-gas pool), and with no gas given;
 *   - sha256 of the returned metadata, so endpoints and tokens can be compared;
 *   - minter, owner, mint block and time (chronology), and the token's renderer id.
 */
import { createHash } from 'node:crypto'
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem'

const PAINT = process.env.PAINT_ADDRESS || '0x5102de3817ae16b3afaeb9d180130669a70787b3'
const RPCS = (
  process.env.RPCS ||
  'https://rpc.monad.xyz,https://rpc1.monad.xyz,https://rpc2.monad.xyz,https://rpc3.monad.xyz'
)
  .split(',')
  .filter(Boolean)
const TOKENS = process.argv.slice(2).length ? process.argv.slice(2).map(BigInt) : [0n, 2n, 3n, 4n, 5n, 7n]
const LOW_POOL_LIMIT = 8_100_000n
const OS_CHAIN = process.env.OPENSEA_CHAIN || 'monad'

const abi = parseAbi([
  'function tokenURI(uint256) view returns (string)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenRenderer(uint256) view returns (uint256)',
  'function renderersFrozen() view returns (bool)',
  'function rendererCount() view returns (uint256)',
  'function frameInfo(uint256) view returns ((address minter, address proposer, address dataPointer, uint48 blockNumber, uint32 season, uint48 seasonFrameIndex, uint48 frameNumber, uint48 paintsSincePreviousFrame, uint16 df1Amount, uint8 faceColor, uint8 backgroundColor, bool holderAtMint, bool finale))',
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let id = 0
async function rpc(url, method, params) {
  await sleep(120) // stay far below every public endpoint's rate limit
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }))
    return { ...body, ms: Date.now() - started }
  } catch (error) {
    return { error: { message: String(error?.message || error).slice(0, 120) }, ms: Date.now() - started }
  }
}

const call = (fn, args = []) => ({ to: PAINT, data: encodeFunctionData({ abi, functionName: fn, args }) })
const host = (url) => new URL(url).host
const short = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 90)

async function read(url, fn, args) {
  const result = await rpc(url, 'eth_call', [call(fn, args), 'latest'])
  if (result.error) return undefined
  return decodeFunctionResult({ abi, functionName: fn, data: result.result })
}

async function main() {
  const primary = RPCS[0]
  console.log(`Paint ${PAINT}`)
  const frozen = await read(primary, 'renderersFrozen')
  const count = await read(primary, 'rendererCount')
  console.log(`renderersFrozen=${frozen} rendererCount=${count}`)
  console.log(
    `Monad low-gas pool: eth_call gas <= ${LOW_POOL_LIMIT.toLocaleString('en-US')}; above that a call runs in the high-gas pool`,
  )
  console.log('(default 20 concurrent requests per node; see docs.monad.xyz/reference/rpc-limits)\n')

  console.log('== chronology and owners ==')
  for (const token of TOKENS) {
    const owner = await read(primary, 'ownerOf', [token])
    const renderer = await read(primary, 'tokenRenderer', [token])
    let line = `#${token} owner=${owner ?? 'n/a (burned or missing)'} renderer=${renderer ?? '?'}`
    if (token !== 0n) {
      const info = await read(primary, 'frameInfo', [token])
      if (info) {
        const block = await rpc(primary, 'eth_getBlockByNumber', [
          '0x' + BigInt(info.blockNumber).toString(16),
          false,
        ])
        const time = block.result
          ? new Date(Number(BigInt(block.result.timestamp)) * 1000).toISOString()
          : '?'
        line += ` minter=${info.minter} block=${info.blockNumber} time=${time}`
      }
    } else {
      line += ' (minted in the constructor; renders the LIVE canvas, so its cost grows as the canvas fills)'
    }
    console.log(line)
  }

  console.log('\n== tokenURI gas and pools, per RPC ==')
  for (const url of RPCS) {
    console.log(`-- ${host(url)}`)
    for (const token of TOKENS) {
      const tx = call('tokenURI', [token])
      const estimate = await rpc(url, 'eth_estimateGas', [tx, 'latest'])
      const gas = estimate.result ? BigInt(estimate.result) : undefined
      const low = await rpc(url, 'eth_call', [{ ...tx, gas: '0x' + LOW_POOL_LIMIT.toString(16) }, 'latest'])
      const high = await rpc(url, 'eth_call', [{ ...tx, gas: '0x' + (12_000_000).toString(16) }, 'latest'])
      const open = await rpc(url, 'eth_call', [tx, 'latest'])
      const hash = (r) =>
        r.result ? createHash('sha256').update(r.result).digest('hex').slice(0, 12) : 'FAIL'
      console.log(
        `#${token} needs ${gas ? gas.toLocaleString('en-US') : `? (${short(estimate.error?.message)})`}` +
          `${gas ? (gas > LOW_POOL_LIMIT ? ' > 8.1M: high-gas pool only' : ' <= 8.1M') : ''}` +
          ` | gas 8.1M: ${low.result ? 'ok' : 'FAIL ' + short(low.error?.message)}` +
          ` | gas 12M: ${high.result ? 'ok' : 'FAIL ' + short(high.error?.message)} ${high.ms}ms` +
          ` | no gas: ${open.result ? 'ok' : 'FAIL ' + short(open.error?.message)} ${open.ms}ms` +
          ` | sha ${hash(high)}`,
      )
    }
  }

  const key = process.env.OPENSEA_API_KEY
  if (!key) {
    console.log('\n(OpenSea part skipped: set OPENSEA_API_KEY in your shell to compare with OpenSea records)')
    return
  }
  console.log(`\n== OpenSea records (chain slug "${OS_CHAIN}") ==`)
  for (const token of TOKENS) {
    await sleep(400)
    const response = await fetch(
      `https://api.opensea.io/api/v2/chain/${OS_CHAIN}/contract/${PAINT}/nfts/${token}`,
      {
        headers: { accept: 'application/json', 'x-api-key': key },
      },
    ).catch((error) => ({ ok: false, status: String(error?.message || error) }))
    if (!response.ok) {
      console.log(`#${token} HTTP ${response.status}`)
      continue
    }
    const nft = (await response.json()).nft ?? {}
    console.log(
      `#${token} name="${nft.name}" image=${nft.image_url ? 'yes' : 'NO'} traits=${nft.traits?.length ?? 0}` +
        ` updated_at=${nft.updated_at ?? '?'} metadata_url=${nft.metadata_url ? 'yes' : 'none'}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
