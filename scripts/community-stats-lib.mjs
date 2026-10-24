// Pure helpers for scripts/community-stats.mjs (unit-tested; no network here).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { decodeEventLog, parseAbiItem } from 'viem'

export const PAINTED = parseAbiItem(
  'event Painted(uint256 indexed season, address indexed owner, address indexed sender, bytes runs, bytes corruptions, uint32 unitsSpent, uint16 regionsMask)',
)
export const FRAME_MINTED = parseAbiItem(
  'event FrameMinted(uint256 indexed frameId, uint256 indexed season, address indexed minter, uint256 seasonFrameIndex)',
)
export const CD_BURNED = parseAbiItem(
  'event CDBurned(address indexed owner, uint256 indexed tokenId, uint8 tracks, string label)',
)
export const TRANSFER = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
)

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** Where the event cache lives by default (gitignored). */
export const DEFAULT_CACHE = '.stats-cache/community-stats.json'

export function parseArgs(argv) {
  const out = { exclude: [], range: 1_000, concurrency: 4, cache: DEFAULT_CACHE }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value == null) throw new Error(`${arg} needs a value`)
      return value
    }
    if (arg === '--rpc') out.rpc = next()
    else if (arg === '--paint') out.paint = next()
    else if (arg === '--cd-burner') out.cdBurner = next()
    else if (arg === '--pass') out.pass = next()
    else if (arg === '--from-block') out.fromBlock = BigInt(next())
    else if (arg === '--to-block') out.toBlock = BigInt(next())
    // Launch window: --since 2026-10-10T21:00:00Z [--hours 24] counts only that window (see windowStats).
    else if (arg === '--since') {
      const value = next()
      const ms = Date.parse(value)
      if (!Number.isFinite(ms)) throw new Error('--since must be a date/time, e.g. 2026-10-10T21:00:00Z')
      out.since = BigInt(Math.floor(ms / 1_000))
    } else if (arg === '--hours') out.hours = Number(next())
    else if (arg === '--range') out.range = Number(next())
    // per-wallet season numbers for the My Season tab in r3OS, e.g. public/season/painters.json
    else if (arg === '--painters-out') out.paintersOut = next()
    else if (arg === '--concurrency') out.concurrency = Number(next())
    else if (arg === '--exclude')
      out.exclude.push(
        ...next()
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
    else if (arg === '--exclude-file') {
      // e.g. guest-wallets.local.json: every "address" field in the file is excluded.
      const text = readFileSync(next(), 'utf8')
      out.exclude.push(
        ...(text.match(/"address":\s*"(0x[0-9a-fA-F]{40})"/g) ?? []).map((row) => row.slice(-43, -1)),
      )
    } else if (arg === '--json') out.json = true
    // Local cache of the events already read (public chain data only), so later runs fetch only new blocks.
    else if (arg === '--cache') out.cache = next()
    else if (arg === '--no-cache') out.cache = undefined
    // Only the flag name is echoed, never its value (values can be RPC URLs with keys).
    else throw new Error(`unknown flag ${arg.split('=')[0]}`)
  }
  for (const [name, value] of [
    ['--paint', out.paint],
    ['--cd-burner', out.cdBurner],
    ['--pass', out.pass],
    ...out.exclude.map((value) => ['--exclude', value]),
  ]) {
    if (value != null && !ADDRESS.test(value)) throw new Error(`${name} is not an address`)
  }
  if (!Number.isInteger(out.range) || out.range < 1) throw new Error('--range must be a positive integer')
  if (out.hours != null && (!Number.isFinite(out.hours) || out.hours <= 0 || out.hours > 24 * 30))
    throw new Error('--hours must be between 0 and 720')
  if (out.hours != null && out.since == null) throw new Error('--hours needs --since')
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 16)
    throw new Error('--concurrency must be 1-16')
  out.exclude = out.exclude.map((value) => value.toLowerCase())
  return out
}

export function chunks(fromBlock, toBlock, range) {
  const rows = []
  for (let start = fromBlock; start <= toBlock; start += BigInt(range)) {
    const end = start + BigInt(range) - 1n
    rows.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end })
  }
  return rows
}

/** Pixels written by a Painted `runs` payload: 4-byte groups of (y, x0, x1, colour). */
export function runPixels(runsHex) {
  const hex = runsHex.startsWith('0x') ? runsHex.slice(2) : runsHex
  let pixels = 0
  for (let offset = 0; offset + 8 <= hex.length; offset += 8) {
    const x0 = parseInt(hex.slice(offset + 2, offset + 4), 16)
    const x1 = parseInt(hex.slice(offset + 4, offset + 6), 16)
    if (x1 >= x0) pixels += x1 - x0 + 1
  }
  return pixels
}

function decode(abiItem, log) {
  try {
    return decodeEventLog({ abi: [abiItem], data: log.data, topics: log.topics }).args
  } catch {
    return undefined
  }
}

/**
 * Turns raw logs into community numbers. Excluded wallets (the builder's own, test wallets) are removed
 * from every count, so the result can be quoted as "not counting the builder".
 */
export function summarize({ painted = [], frames = [], cds = [], passes = [] }, exclude = []) {
  const skip = new Set(exclude.map((value) => value.toLowerCase()))
  const painters = new Map()
  const days = new Map() // UTC day → { paints, pixels, owners }
  let paints = 0
  let pixels = 0
  for (const log of painted) {
    const args = decode(PAINTED, log)
    if (!args) continue
    const owner = String(args.owner).toLowerCase()
    if (skip.has(owner)) continue
    const runPx = runPixels(args.runs)
    paints += 1
    pixels += runPx
    const day = log.blockTimestamp
      ? new Date(Number(log.blockTimestamp) * 1_000).toISOString().slice(0, 10)
      : 'unknown'
    const row = painters.get(owner) ?? { paints: 0, days: new Set() }
    row.paints += 1
    row.days.add(day)
    painters.set(owner, row)
    if (day !== 'unknown') {
      const d = days.get(day) ?? { paints: 0, pixels: 0, owners: new Set() }
      d.paints += 1
      d.pixels += runPx
      d.owners.add(owner)
      days.set(day, d)
    }
  }
  // Day by day: distinct painters, how many of them painted for the first time that day, strokes and pixels.
  const firstDay = new Map()
  for (const [owner, row] of painters)
    firstDay.set(owner, [...row.days].filter((d) => d !== 'unknown').sort()[0])
  const daily = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, d]) => ({
      day,
      painters: d.owners.size,
      newPainters: [...d.owners].filter((owner) => firstDay.get(owner) === day).length,
      paints: d.paints,
      pixels: d.pixels,
    }))
  const countOwners = (logs, abiItem, field) => {
    let count = 0
    const owners = new Set()
    for (const log of logs) {
      const args = decode(abiItem, log)
      if (!args) continue
      const owner = String(args[field]).toLowerCase()
      if (skip.has(owner)) continue
      count += 1
      owners.add(owner)
    }
    return { count, owners: owners.size }
  }
  const zero = '0x0000000000000000000000000000000000000000'
  const passMints = passes.filter((log) => {
    const args = decode(TRANSFER, log)
    return args && String(args.from).toLowerCase() === zero
  })
  const returning = [...painters.values()].filter((row) => row.days.size > 1).length
  return {
    painters: painters.size,
    returningPainters: returning,
    paints,
    pixels,
    frames: countOwners(frames, FRAME_MINTED, 'minter'),
    cds: countOwners(cds, CD_BURNED, 'owner'),
    passes: countOwners(passMints, TRANSFER, 'to'),
    excluded: skip.size,
    daily,
  }
}

/**
 * Per-wallet season numbers (the same exclusions as summarize): what My Pass › My Season shows each painter.
 * Rows are sorted by paints, most first; `rank` is that position (ties share the higher rank).
 */
export function perWallet({ painted = [], frames = [], cds = [] }, exclude = []) {
  const skip = new Set(exclude.map((value) => value.toLowerCase()))
  const rows = new Map()
  const row = (owner) => {
    let r = rows.get(owner)
    if (!r) {
      r = { address: owner, paints: 0, pixels: 0, days: new Set(), frames: 0, cds: 0 }
      rows.set(owner, r)
    }
    return r
  }
  for (const log of painted) {
    const args = decode(PAINTED, log)
    if (!args) continue
    const owner = String(args.owner).toLowerCase()
    if (skip.has(owner)) continue
    const r = row(owner)
    r.paints += 1
    r.pixels += runPixels(args.runs)
    if (log.blockTimestamp)
      r.days.add(new Date(Number(log.blockTimestamp) * 1_000).toISOString().slice(0, 10))
  }
  for (const [logs, item, field, key] of [
    [frames, FRAME_MINTED, 'minter', 'frames'],
    [cds, CD_BURNED, 'owner', 'cds'],
  ]) {
    for (const log of logs) {
      const args = decode(item, log)
      if (!args) continue
      const owner = String(args[field]).toLowerCase()
      if (skip.has(owner) || !rows.has(owner)) continue
      row(owner)[key] += 1
    }
  }
  const sorted = [...rows.values()]
    .map((r) => {
      const days = [...r.days].sort()
      return {
        address: r.address,
        paints: r.paints,
        pixels: r.pixels,
        days: days.length,
        first: days[0] ?? null,
        frames: r.frames,
        cds: r.cds,
      }
    })
    .sort((a, b) => b.paints - a.paints || b.pixels - a.pixels || (a.address < b.address ? -1 : 1))
  let rank = 0
  return sorted.map((r, i) => {
    if (i === 0 || r.paints !== sorted[i - 1].paints) rank = i + 1
    return { ...r, rank }
  })
}

export function markdown(stats, { fromBlock, toBlock, asOf }) {
  return [
    `**Community on Monad mainnet** (as of ${asOf}, blocks ${fromBlock}–${toBlock}${
      stats.excluded
        ? `, not counting ${stats.excluded} builder/test wallet${stats.excluded === 1 ? '' : 's'}`
        : ''
    })`,
    '',
    '| | |',
    '| --- | ---: |',
    `| Painters (distinct wallets) | ${stats.painters.toLocaleString('en-US')} |`,
    `| Painters who came back on another day | ${stats.returningPainters.toLocaleString('en-US')} |`,
    `| Paint transactions | ${stats.paints.toLocaleString('en-US')} |`,
    `| Pixels painted | ${stats.pixels.toLocaleString('en-US')} |`,
    `| Frames saved | ${stats.frames.count.toLocaleString('en-US')} (by ${stats.frames.owners} wallets) |`,
    `| CDs burned | ${stats.cds.count.toLocaleString('en-US')} (by ${stats.cds.owners} wallets) |`,
    `| Painter Passes claimed | ${stats.passes.count.toLocaleString('en-US')} |`,
    '',
    "Counted from the contracts' own events with `node scripts/community-stats.mjs`; anyone can rerun it.",
  ].join('\n')
}

/**
 * A launch window (for example the first 24 hours after the site was announced): hour-by-hour activity,
 * painters new to r3OS (no paint before the window) and painters who came back an hour or more after their
 * first stroke in the window. Painted logs must carry blockTimestamp; logs outside the window only tell us
 * who had painted before it.
 */
export function windowStats(painted, { fromTime, toTime, exclude = [] }) {
  const skip = new Set(exclude.map((value) => value.toLowerCase()))
  const hours = Math.max(1, Math.ceil(Number(toTime - fromTime) / 3_600))
  const hourly = Array.from({ length: hours }, (_, hour) => ({
    hour,
    paints: 0,
    pixels: 0,
    owners: new Set(),
  }))
  const before = new Set()
  const first = new Map()
  const last = new Map()
  for (const log of painted) {
    const args = decode(PAINTED, log)
    if (!args || log.blockTimestamp == null) continue
    const owner = String(args.owner).toLowerCase()
    if (skip.has(owner)) continue
    const time = BigInt(log.blockTimestamp)
    if (time < fromTime) {
      before.add(owner)
      continue
    }
    if (time >= toTime) continue
    const slot = hourly[Number((time - fromTime) / 3_600n)]
    slot.paints += 1
    slot.pixels += runPixels(args.runs)
    slot.owners.add(owner)
    if (!first.has(owner) || time < first.get(owner)) first.set(owner, time)
    if (!last.has(owner) || time > last.get(owner)) last.set(owner, time)
  }
  const rows = hourly.map(({ hour, paints, pixels, owners }) => ({
    hour,
    paints,
    pixels,
    painters: owners.size,
  }))
  const peak = rows.reduce(
    (best, row) =>
      row.painters > best.painters || (row.painters === best.painters && row.paints > best.paints)
        ? row
        : best,
    rows[0],
  )
  return {
    fromTime: Number(fromTime),
    toTime: Number(toTime),
    painters: first.size,
    newPainters: [...first.keys()].filter((owner) => !before.has(owner)).length,
    cameBackLater: [...first.keys()].filter((owner) => last.get(owner) - first.get(owner) >= 3_600n).length,
    paints: rows.reduce((sum, row) => sum + row.paints, 0),
    pixels: rows.reduce((sum, row) => sum + row.pixels, 0),
    peakHour: peak,
    hourly: rows,
  }
}

const utc = (seconds) => new Date(seconds * 1_000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

export function windowMarkdown(window) {
  const peakStart = window.fromTime + window.peakHour.hour * 3_600
  return [
    `**Launch window** (${utc(window.fromTime)} → ${utc(window.toTime)})`,
    '',
    '| | |',
    '| --- | ---: |',
    `| Painters in the window | ${window.painters.toLocaleString('en-US')} |`,
    `| New to r3OS (first stroke ever) | ${window.newPainters.toLocaleString('en-US')} |`,
    `| Came back 1+ hour after their first stroke | ${window.cameBackLater.toLocaleString('en-US')} |`,
    `| Paint transactions | ${window.paints.toLocaleString('en-US')} |`,
    `| Pixels painted | ${window.pixels.toLocaleString('en-US')} |`,
    `| Busiest hour | ${utc(peakStart)}: ${window.peakHour.painters} painters, ${window.peakHour.paints} strokes |`,
    '',
    'Hour-by-hour numbers are in `--json` output (field `window.hourly`), ready for a chart.',
  ].join('\n')
}

/*
 * Event cache. A full scan re-downloads millions of blocks of history that never changes, so the events read
 * so far (and the block times) are kept in a local file. A later run fetches only the blocks after the cached
 * ones (re-reading the last CACHE_OVERLAP blocks to be safe) and then counts everything again from the full
 * set, so distinct and returning painters stay exact. The cache holds public chain data only, never the RPC.
 */
export const CACHE_VERSION = 1
export const CACHE_OVERLAP = 500n
export const CACHE_KINDS = ['painted', 'frames', 'cds', 'passes']

/** What the cached events belong to: the contracts and the season's first block. Anything else → rescan. */
export const cacheKey = ({ paint, cdBurner, pass }, fromBlock) =>
  [paint, cdBurner, pass].map((a) => String(a).toLowerCase()).join(',') + `@${fromBlock}`

/** A log as stored in the cache: block, log index, topics, data. */
export const packLog = (log) => ({
  b: String(log.blockNumber),
  i: Number(log.logIndex ?? 0),
  t: log.topics,
  d: log.data,
})
export const unpackLog = (row) => ({
  blockNumber: BigInt(row.b),
  logIndex: row.i,
  topics: row.t,
  data: row.d,
})

export const emptyCache = (key, fromBlock) => ({
  version: CACHE_VERSION,
  key,
  lastBlock: String(fromBlock - 1n),
  logs: Object.fromEntries(CACHE_KINDS.map((kind) => [kind, []])),
  times: {},
})

/** The cache at `path` if it exists and matches `key`; otherwise undefined (a full scan). */
export function readCache(path, key) {
  if (!path) return undefined
  let cache
  try {
    cache = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  if (cache?.version !== CACHE_VERSION || cache.key !== key || !cache.logs || !cache.times) return undefined
  if (!CACHE_KINDS.every((kind) => Array.isArray(cache.logs[kind]))) return undefined
  return cache
}

export function writeCache(path, cache) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, path)
}

/** Where to start fetching: the season start on a fresh cache, else CACHE_OVERLAP blocks before its end. */
export function scanStart(cache, fromBlock) {
  const resume = BigInt(cache.lastBlock) - CACHE_OVERLAP + 1n
  return resume > fromBlock ? resume : fromBlock
}

/**
 * Adds freshly fetched logs (blocks scanFrom … toBlock) to the cache: cached rows from scanFrom on are
 * replaced by the fresh ones, so the overlap is never counted twice.
 */
export function mergeCache(cache, fresh, scanFrom, toBlock) {
  const logs = {}
  for (const kind of CACHE_KINDS) {
    const kept = cache.logs[kind].filter((row) => BigInt(row.b) < scanFrom)
    const added = (fresh[kind] ?? []).map(packLog)
    logs[kind] = [...kept, ...added].sort((a, b) =>
      BigInt(a.b) === BigInt(b.b) ? a.i - b.i : BigInt(a.b) < BigInt(b.b) ? -1 : 1,
    )
  }
  const last = BigInt(cache.lastBlock)
  return { ...cache, logs, lastBlock: String(toBlock > last ? toBlock : last) }
}
