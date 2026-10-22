// Pure helpers for scripts/export-sessions.mjs (unit-tested; no network here).
import { decodeEventLog, getAddress, parseAbiItem } from 'viem'

export const SESSION_STARTED = parseAbiItem(
  'event SessionStarted(address indexed owner, address indexed sessionKey, uint256 expiryBlock, uint256 maxUnits)',
)

/**
 * The Live Mode session index the site serves (public/live/sessions.json): every SessionStarted on the Paint
 * contract as [owner, sessionKey, block], oldest first. It lets r3OS show someone the Live Mode wallets they
 * started in another browser that still hold MON. Everything in it is public chain data.
 */
export function buildSessions(logs, { chainId, paint, fromBlock, toBlock }) {
  const sessions = []
  for (const log of logs) {
    let args
    try {
      args = decodeEventLog({ abi: [SESSION_STARTED], data: log.data, topics: log.topics }).args
    } catch {
      continue
    }
    sessions.push([getAddress(args.owner), getAddress(args.sessionKey), Number(log.blockNumber)])
  }
  sessions.sort((a, b) => a[2] - b[2] || a[1].localeCompare(b[1]))
  return {
    version: 1,
    chainId,
    paint: getAddress(paint),
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    sessions,
  }
}

/** Adds a newer scan (it must start right after `existing` ends) to an existing index. */
export function appendSessions(existing, next) {
  if (BigInt(next.fromBlock) !== BigInt(existing.toBlock) + 1n)
    throw new Error(`gap: index ends at ${existing.toBlock}, new scan starts at ${next.fromBlock}`)
  const seen = new Set(existing.sessions.map((row) => `${row[1]}:${row[2]}`))
  return {
    ...existing,
    toBlock: next.toBlock,
    sessions: [...existing.sessions, ...next.sessions.filter((row) => !seen.has(`${row[1]}:${row[2]}`))],
  }
}

/** Whether an existing file can be extended (same format, chain and contract). */
export function sameIndex(existing, { chainId, paint }) {
  return (
    existing?.version === 1 &&
    existing.chainId === chainId &&
    String(existing.paint).toLowerCase() === String(paint).toLowerCase() &&
    Array.isArray(existing.sessions)
  )
}
