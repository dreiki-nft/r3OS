// Pure helpers for scripts/community-stats.mjs (unit-tested; no network here).
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

export function parseArgs(argv) {
  const out = { exclude: [], range: 1_000, concurrency: 4 }
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
    else if (arg === '--range') out.range = Number(next())
    else if (arg === '--concurrency') out.concurrency = Number(next())
    else if (arg === '--exclude')
      out.exclude.push(
        ...next()
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
    else if (arg === '--json') out.json = true
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
  let paints = 0
  let pixels = 0
  for (const log of painted) {
    const args = decode(PAINTED, log)
    if (!args) continue
    const owner = String(args.owner).toLowerCase()
    if (skip.has(owner)) continue
    paints += 1
    pixels += runPixels(args.runs)
    const day = log.blockTimestamp
      ? new Date(Number(log.blockTimestamp) * 1_000).toISOString().slice(0, 10)
      : 'unknown'
    const row = painters.get(owner) ?? { paints: 0, days: new Set() }
    row.paints += 1
    row.days.add(day)
    painters.set(owner, row)
  }
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
  }
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
