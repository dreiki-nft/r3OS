// Pure helpers for scripts/storm-chasers.mjs (unit-tested; no network here).
import { readFileSync } from 'node:fs'
import { decodeEventLog, getAddress, keccak256 } from 'viem'
import { PAINTED, runPixels } from './community-stats-lib.mjs'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
export const STORM_PERIOD = 200_000n
export const STORM_LENGTH = 600n
export const TICKET_MODES = ['per-storm', 'all']

/** Storm k covers blocks [k * 200,000, k * 200,000 + 599], the same rule the Paint contract uses. */
export function stormWindow(startBlock) {
  if (startBlock % STORM_PERIOD !== 0n)
    throw new Error(`${startBlock} is not a storm start (multiple of 200,000)`)
  return { start: startBlock, end: startBlock + STORM_LENGTH - 1n }
}

export function parseArgs(argv) {
  const out = { storms: [], exclude: [], range: 100, batch: 100, tickets: 'per-storm' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value == null) throw new Error(`${arg} needs a value`)
      return value
    }
    if (arg === '--storms')
      out.storms.push(
        ...next()
          .split(',')
          .map((value) => value.trim().replaceAll('_', ''))
          .filter(Boolean)
          .map((value) => BigInt(value)),
      )
    else if (arg === '--rpc') out.rpc = next()
    else if (arg === '--paint') out.paint = next()
    else if (arg === '--out') out.out = next()
    else if (arg === '--range') out.range = Number(next())
    else if (arg === '--batch') out.batch = Number(next())
    // per-storm: 1 ticket for every storm a wallet painted in (the rule since storm 1); all: 1 ticket, only
    // for wallets that painted in every storm (the original trilogy rule).
    else if (arg === '--tickets') out.tickets = next()
    else if (arg === '--exclude')
      out.exclude.push(
        ...next()
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
    else if (arg === '--exclude-file') {
      // e.g. guest-wallets.local.json: only the "address" fields are read, never anything else in the file.
      const text = readFileSync(next(), 'utf8')
      out.exclude.push(
        ...(text.match(/"address":\s*"(0x[0-9a-fA-F]{40})"/g) ?? []).map((row) => row.slice(-43, -1)),
      )
    }
    // Only the flag name is echoed, never its value (values can be RPC URLs with keys).
    else throw new Error(`unknown flag ${arg.split('=')[0]}`)
  }
  if (out.storms.length === 0)
    throw new Error('--storms is required, e.g. --storms 115400000,116000000,116200000')
  for (const start of out.storms) stormWindow(start)
  if (new Set(out.storms.map(String)).size !== out.storms.length) throw new Error('--storms has a duplicate')
  out.storms.sort((a, b) => (a < b ? -1 : 1))
  for (const [name, value] of [['--paint', out.paint], ...out.exclude.map((value) => ['--exclude', value])])
    if (value != null && !ADDRESS.test(value)) throw new Error(`${name} is not an address`)
  if (!Number.isInteger(out.range) || out.range < 1) throw new Error('--range must be a positive integer')
  if (!TICKET_MODES.includes(out.tickets)) throw new Error(`--tickets must be ${TICKET_MODES.join(' or ')}`)
  if (!Number.isInteger(out.batch) || out.batch < 1 || out.batch > 500)
    throw new Error('--batch must be 1-500')
  out.exclude = [...new Set(out.exclude.map((value) => value.toLowerCase()))]
  return out
}

/** Wallets (Painted `owner`, so Live Mode paints count for the main wallet) that wrote ≥ 1 pixel in a storm. */
export function stormPainters(logs, window) {
  const painters = new Set()
  for (const log of logs) {
    if (log.blockNumber == null || log.blockNumber < window.start || log.blockNumber > window.end) continue
    let args
    try {
      args = decodeEventLog({ abi: [PAINTED], data: log.data, topics: log.topics }).args
    } catch {
      continue
    }
    if (runPixels(args.runs) > 0) painters.add(args.owner.toLowerCase())
  }
  return painters
}

/**
 * Entrants = wallets that painted in every storm, minus excluded wallets, sorted by address so the order
 * (and so who holds which ticket) is fixed by the data, not chosen by anyone.
 */
export function chasers(perStorm, exclude = []) {
  const skip = new Set(exclude.map((value) => value.toLowerCase()))
  if (perStorm.length === 0) return []
  const [first, ...rest] = perStorm
  return [...first]
    .filter((wallet) => !skip.has(wallet) && rest.every((set) => set.has(wallet)))
    .sort()
    .map((wallet) => getAddress(wallet))
}

/**
 * The hash published with the list and passed to initSnapshot: keccak256 of the 20-byte addresses
 * concatenated in list order (the ticket list: a wallet with 3 tickets is in it 3 times). Anyone can recompute it from the published list:
 *   cast keccak 0x$(sed 's/^0x//' storm-chasers.txt | tr -d '\n\r')
 */
export function listHash(wallets) {
  return keccak256(`0x${wallets.map((wallet) => wallet.slice(2).toLowerCase()).join('')}`)
}

/**
 * Raffle entries, sorted by address so the order (and so who holds which ticket) is fixed by the data:
 *   per-storm: every wallet that painted in at least one storm, 1 ticket per storm it painted in
 *   all:       only wallets that painted in every storm, 1 ticket each
 * Excluded wallets never get a ticket.
 */
export function entries(perStorm, exclude = [], mode = 'per-storm') {
  if (mode === 'all') return chasers(perStorm, exclude).map((wallet) => ({ wallet, tickets: 1 }))
  const skip = new Set(exclude.map((value) => value.toLowerCase()))
  const count = new Map()
  for (const set of perStorm)
    for (const wallet of set) if (!skip.has(wallet)) count.set(wallet, (count.get(wallet) ?? 0) + 1)
  return [...count.keys()]
    .sort()
    .map((wallet) => ({ wallet: getAddress(wallet), tickets: count.get(wallet) }))
}

/** The published list: one line per ticket (a wallet with 3 tickets appears 3 times), in entry order. */
export function ticketList(list) {
  return list.flatMap(({ wallet, tickets }) => Array.from({ length: tickets }, () => wallet))
}

/** loadTicketsBatch inputs (wallets[], tickets[]), in batches. */
export function batches(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size)
    out.push({ wallets: chunk.map((e) => e.wallet), tickets: chunk.map((e) => e.tickets) })
  }
  return out
}

export function report({
  storms,
  perStorm,
  entries: list,
  mode = 'per-storm',
  excluded,
  hash,
  snapshotBlock,
}) {
  const lines = ['Storm Chaser Trilogy', '']
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  storms.forEach((window, i) =>
    lines.push(
      `storm ${i + 1}: blocks ${window.start}-${window.end} · ${plural(perStorm[i].size, 'wallet')} painted`,
    ),
  )
  const tickets = list.reduce((sum, e) => sum + e.tickets, 0)
  const notCounted = excluded ? ` (${plural(excluded, 'team/test wallet')} not counted)` : ''
  lines.push(
    '',
    mode === 'all'
      ? `caught all ${storms.length}: ${plural(list.length, 'wallet')}${notCounted}`
      : `1 ticket per storm caught: ${plural(list.length, 'wallet')}, ${plural(tickets, 'ticket')}${notCounted}`,
  )
  if (mode !== 'all') for (const e of list) lines.push(`  ${e.wallet}  ${plural(e.tickets, 'ticket')}`)
  lines.push(`snapshotBlock: ${snapshotBlock}`, `snapshotHash:  ${hash}`)
  return lines.join('\n')
}
