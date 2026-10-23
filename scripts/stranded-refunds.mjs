#!/usr/bin/env node
/**
 * The Live Mode refund list: every wallet that left MON behind in a Live Mode burner, and how much
 * (rules in scripts/stranded-refunds-lib.mjs). Read-only: it reads public data from Etherscan (chain 143) and
 * never signs or sends anything.
 *
 *   read -s ETHERSCAN_API_KEY && export ETHERSCAN_API_KEY        # once per terminal
 *   node scripts/stranded-refunds.mjs --exclude 0xYou,0xYourOther --exclude-file guest-wallets.local.json
 *   … --ended-before 115675201     # only sessions already over when the automatic sweep shipped (Oct 22)
 *
 * Writes refunds-out/refunds.csv (one row per wallet), refunds-out/airdrop.json (what the airdrop page sends)
 * and refunds-out/detail.json (every burner, sweep and transaction behind each number, to check by hand).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { formatEther, parseAbiItem, toEventSelector } from 'viem'
import { burnerSweeps, classify, decodeSessionLog, mon } from './stranded-refunds-lib.mjs'

const PAINT = '0x5102de3817ae16b3afaeb9d180130669a70787b3'
const DEPLOY_BLOCK = 111_000_000n
const OUT = 'refunds-out'
const STARTED = toEventSelector(
  parseAbiItem(
    'event SessionStarted(address indexed owner, address indexed sessionKey, uint256 expiryBlock, uint256 maxUnits)',
  ),
)
const REVOKED = toEventSelector(
  parseAbiItem('event SessionRevoked(address indexed owner, address indexed sessionKey)'),
)
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const exclude = []
let endedBefore
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i]
  const value = argv[++i]
  if (value == null) fail(`${flag} needs a value`)
  if (flag === '--ended-before') {
    if (!/^\d+$/.test(value)) fail('--ended-before needs a block number')
    endedBefore = BigInt(value)
  } else if (flag === '--exclude')
    exclude.push(
      ...value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
  else if (flag === '--exclude-file') {
    if (!existsSync(value)) fail(`${value} not found`)
    exclude.push(...(readFileSync(value, 'utf8').match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? []))
  } else fail(`unknown flag ${flag.split('=')[0]}`)
}
for (const address of exclude) if (!ADDRESS.test(address)) fail(`--exclude: ${address} is not an address`)
const key = process.env.ETHERSCAN_API_KEY
if (!key)
  fail('ETHERSCAN_API_KEY is not set: run  read -s ETHERSCAN_API_KEY && export ETHERSCAN_API_KEY  first')

function fail(message) {
  console.error(`stranded-refunds: ${message}`)
  process.exit(2)
}

// Etherscan's free plan allows 3 calls a second.
let last = 0
async function etherscan(params, attempt = 0) {
  const wait = last + 400 - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  last = Date.now()
  const url = new URL('https://api.etherscan.io/v2/api')
  for (const [name, value] of Object.entries({ chainid: 143, ...params, apikey: key }))
    url.searchParams.set(name, String(value))
  let json
  try {
    json = await (await fetch(url)).json()
  } catch (error) {
    if (attempt < 5) return etherscan(params, attempt + 1)
    throw new Error(`etherscan unreachable (${error.message})`)
  }
  // module=proxy answers in JSON-RPC form, without status/message.
  if (json.jsonrpc) {
    if (json.error && attempt < 5) return etherscan(params, attempt + 1)
    if (json.error || json.result == null)
      throw new Error(`etherscan ${params.action}: ${json.error?.message ?? json.result ?? 'no result'}`)
    if (/rate limit/i.test(String(json.result)) && attempt < 8) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return etherscan(params, attempt + 1)
    }
    return json.result
  }
  const text = `${json.message} ${typeof json.result === 'string' ? json.result : ''}`
  if (/rate limit|timeout|busy/i.test(text) && attempt < 8) {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    return etherscan(params, attempt + 1)
  }
  if (json.status !== '1') {
    if (/no (records|transactions)/i.test(text)) return []
    // The key never appears in this message: Etherscan doesn't echo it.
    throw new Error(`etherscan ${params.action}: ${text.trim()}`)
  }
  return json.result
}

/** Every log with this topic, paging forward by block (Etherscan returns at most 1,000 per call). */
async function allLogs(topic0) {
  const seen = new Map()
  let from = DEPLOY_BLOCK
  for (;;) {
    const page = await etherscan({
      module: 'logs',
      action: 'getLogs',
      address: PAINT,
      topic0,
      fromBlock: from,
      toBlock: 'latest',
      page: 1,
      offset: 1000,
    })
    for (const log of page) seen.set(`${log.transactionHash}:${log.logIndex}`, log)
    if (page.length < 1000) break
    const lastBlock = BigInt(page[page.length - 1].blockNumber)
    if (lastBlock <= from) throw new Error('more than 1,000 session events in one block?')
    from = lastBlock
  }
  return [...seen.values()]
}

/** Every normal transaction of an address (paging by block past Etherscan's 10,000 cap). */
async function allTxs(address) {
  const seen = new Map()
  let from = DEPLOY_BLOCK
  for (;;) {
    const page = await etherscan({
      module: 'account',
      action: 'txlist',
      address,
      startblock: from,
      endblock: 99_999_999_999,
      page: 1,
      offset: 10_000,
      sort: 'asc',
    })
    for (const tx of page) seen.set(tx.hash, tx)
    if (page.length < 10_000) break
    from = BigInt(page[page.length - 1].blockNumber)
  }
  return [...seen.values()]
}

const head = BigInt(await etherscan({ module: 'proxy', action: 'eth_blockNumber' }))
console.error(`head block ${head}`)
console.error('reading SessionStarted and SessionRevoked events…')
const starts = (await allLogs(STARTED)).map(decodeSessionLog)
const revokes = (await allLogs(REVOKED)).map(decodeSessionLog)
const burners = [...new Map(starts.map((start) => [start.burner.toLowerCase(), start.burner])).values()]
console.error(`${starts.length} sessions, ${revokes.length} revokes, ${burners.length} burners`)

console.error('reading burner balances…')
const balances = new Map()
for (let i = 0; i < burners.length; i += 20) {
  const group = burners.slice(i, i + 20)
  try {
    const rows = await etherscan({
      module: 'account',
      action: 'balancemulti',
      address: group.join(','),
      tag: 'latest',
    })
    for (const row of rows) balances.set(row.account.toLowerCase(), BigInt(row.balance))
  } catch {
    // balancemulti isn't on every chain: one call per burner instead.
    for (const burner of group)
      balances.set(
        burner.toLowerCase(),
        BigInt(
          await etherscan({ module: 'proxy', action: 'eth_getBalance', address: burner, tag: 'latest' }),
        ),
      )
  }
}

console.error('reading burner transactions (about 1 burner every 0.4 s)…')
const sweeps = []
let done = 0
for (const burner of burners) {
  sweeps.push(...burnerSweeps(burner, await allTxs(burner)))
  if (++done % 20 === 0 || done === burners.length) console.error(`  ${done}/${burners.length}`)
}

const result = classify({ starts, revokes, sweeps, balances, snapshot: head, exclude, endedBefore })

mkdirSync(OUT, { recursive: true })
const csv = ['wallet,refund_mon,still_in_burner_mon,came_back_late_mon,burners']
for (const owner of result.owners)
  csv.push(
    [
      owner.owner,
      mon(owner.refund),
      formatEther(owner.stranded),
      formatEther(owner.recovered),
      owner.burners.length,
    ].join(','),
  )
writeFileSync(`${OUT}/refunds.csv`, csv.join('\n') + '\n')
writeFileSync(
  `${OUT}/airdrop.json`,
  JSON.stringify(
    {
      chainId: 143,
      snapshotBlock: head.toString(),
      total: result.total.toString(),
      payments: result.owners.map((owner) => ({
        to: owner.owner,
        value: owner.refund.toString(),
        mon: mon(owner.refund),
      })),
    },
    null,
    1,
  ),
)
writeFileSync(
  `${OUT}/detail.json`,
  JSON.stringify(result.owners, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 1),
)

console.log(
  `\nsnapshot block ${head} · excluded ${exclude.length} wallet${exclude.length === 1 ? '' : 's'}${endedBefore ? ` · only sessions that ended before block ${endedBefore}` : ''}`,
)
console.log(`${result.owners.length} wallets to refund · total ${mon(result.total)} MON\n`)
for (const owner of result.owners)
  console.log(
    `${owner.owner}  ${mon(owner.refund).padStart(8)} MON   (still in burner ${Number(formatEther(owner.stranded)).toFixed(3)}, came back late ${Number(formatEther(owner.recovered)).toFixed(3)}, ${owner.burners.length} burner${owner.burners.length === 1 ? '' : 's'})`,
  )
console.log(`\nwrote ${OUT}/refunds.csv, ${OUT}/airdrop.json, ${OUT}/detail.json`)
