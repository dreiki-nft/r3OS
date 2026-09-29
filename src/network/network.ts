import { keccak256, toBytes, zeroAddress, type Address } from 'viem'
import { PALETTE } from '../lib/palette'
import type { FrameInfo } from '../frames/framesStore'

export interface ProducerHeader {
  number: bigint
  timestamp: bigint
  miner: Address
}

export interface ProducerStat {
  address: Address
  blocks: number
  share: number
  frames: number
  lastBlock: bigint
}

export const PRODUCER_WINDOW = 2_000
export const BACKFILL_COUNT = 200
export const BACKFILL_CONCURRENCY = 8
export const HEARTBEAT_COUNT = 60
const EXCLUDED_COLOURS = new Set([0, 1, 2, 3, 7])
const PRODUCER_PALETTE = PALETTE.filter((entry) => !EXCLUDED_COLOURS.has(entry.index))

export function appendHeader(
  current: readonly ProducerHeader[],
  next: ProducerHeader,
  limit = PRODUCER_WINDOW,
): ProducerHeader[] {
  const byNumber = new Map(current.map((header) => [header.number, header]))
  byNumber.set(next.number, next)
  return [...byNumber.values()]
    .sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0))
    .slice(-limit)
}

export function trimHeaderWindow(headers: readonly ProducerHeader[], limit = PRODUCER_WINDOW) {
  return [...headers].sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0)).slice(-limit)
}

export function producerColour(address: Address) {
  const hash = keccak256(toBytes(address.toLowerCase()))
  const bucket = Number(BigInt(hash) % BigInt(PRODUCER_PALETTE.length))
  return PRODUCER_PALETTE[bucket].hex
}

export function framesByProducer(infos: Iterable<FrameInfo | undefined>) {
  const counts = new Map<string, number>()
  for (const info of infos) {
    if (!info || info.proposer === zeroAddress) continue
    const key = info.proposer.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function producerStats(
  headers: readonly ProducerHeader[],
  frameCounts: ReadonlyMap<string, number> = new Map(),
): ProducerStat[] {
  const grouped = new Map<string, { address: Address; blocks: number; lastBlock: bigint }>()
  for (const header of headers) {
    if (!header.miner || header.miner === zeroAddress) continue
    const key = header.miner.toLowerCase()
    const current = grouped.get(key)
    if (current) {
      current.blocks += 1
      if (header.number > current.lastBlock) current.lastBlock = header.number
    } else {
      grouped.set(key, { address: header.miner, blocks: 1, lastBlock: header.number })
    }
  }
  const total = headers.length || 1
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      share: item.blocks / total,
      frames: frameCounts.get(item.address.toLowerCase()) ?? 0,
    }))
    .sort((a, b) => b.blocks - a.blocks || (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
}

export async function backfillHeaders(
  client: {
    getBlock: (args: { blockNumber: bigint; includeTransactions: false }) => Promise<any>
  },
  head: bigint,
  count = BACKFILL_COUNT,
  concurrency = BACKFILL_CONCURRENCY,
) {
  const start = head >= BigInt(count - 1) ? head - BigInt(count - 1) : 0n
  const numbers: bigint[] = []
  for (let block = start; block <= head; block++) numbers.push(block)
  const out: ProducerHeader[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, numbers.length)) }, async () => {
    while (cursor < numbers.length) {
      const index = cursor++
      const blockNumber = numbers[index]
      try {
        const header = await client.getBlock({ blockNumber, includeTransactions: false })
        if (header?.number != null) {
          out.push({
            number: BigInt(header.number),
            timestamp: BigInt(header.timestamp ?? 0),
            miner: (header.miner ?? zeroAddress) as Address,
          })
        }
      } catch {
        // A missed historical header can be filled by a later open or skipped-block catch-up.
      }
    }
  })
  await Promise.all(workers)
  return trimHeaderWindow(out, count)
}

export function heartbeatPositions(headers: readonly ProducerHeader[], targetGap = 12) {
  const recent = trimHeaderWindow(headers, HEARTBEAT_COUNT)
  if (!recent.length) return []
  const raw = [0]
  for (let index = 1; index < recent.length; index++) {
    const seconds = Number(recent[index].timestamp - recent[index - 1].timestamp)
    const gapMs = Math.max(300, seconds * 1000)
    raw.push(raw[index - 1] + (gapMs / 300) * targetGap)
  }
  const width = raw.at(-1) || 1
  const scale = width > 708 ? 708 / width : 1
  return raw.map((x) => x * scale)
}

export function heartbeatPath(headers: readonly ProducerHeader[], reducedMotion = false) {
  const positions = heartbeatPositions(headers)
  if (!positions.length) return ''
  if (reducedMotion)
    return `M${positions[0]} 30 ${positions
      .slice(1)
      .map((x) => `L${x} 30`)
      .join(' ')}`
  const parts = [`M${positions[0]} 30`]
  for (const x of positions) {
    parts.push(`L${x + 2} 30 L${x + 4} 24 L${x + 6} 30 L${x + 8} 30 L${x + 10} 6 L${x + 12} 46 L${x + 14} 30`)
  }
  return parts.join(' ')
}
