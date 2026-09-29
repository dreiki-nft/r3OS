import type { Hex } from 'viem'
import { buildLaneWindow, lanesFor, type LaneBlock, type LaneEntry, type LaneTx } from '../lib/lanes'

export const LANE_LABELS = [
  'R0',
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
  'R6',
  'R7',
  'R8',
  'R9',
  'R10',
  'R11',
  'R12',
  'R13',
  'R14',
  'R15',
  'flipbook',
  'mints',
  'lab',
] as const

export type LaneMark = {
  blockNumber: bigint
  txHash: Hex
  lane: number
  row: number
  conflict: boolean
  crowd: boolean
  finality: LaneEntry['finality']
  kind: 'canvas' | 'flipbook' | 'mint' | 'lab'
}

export type LaneDetail = {
  txHash: Hex
  wallet: string
  sender: string
  action: string
  lanes: string
  pixels: number
  glitches: number
  conflicts: number
}

export function actionLabel(entry: Pick<LaneEntry, 'kinds'>) {
  return [...entry.kinds].join(' + ') || 'app tx'
}

export function mapLaneWindow(txs: readonly LaneTx[], head: bigint, columns = 100) {
  const from = head >= BigInt(columns - 1) ? head - BigInt(columns - 1) : 0n
  const blocks = buildLaneWindow([...txs], from, head)
  const marks: LaneMark[] = []
  for (const block of blocks) {
    for (const entry of block.entries) {
      const lanes = lanesFor(entry)
      for (const lane of lanes) {
        marks.push({
          blockNumber: block.blockNumber,
          txHash: entry.txHash,
          lane,
          row: lane,
          conflict: !entry.independent,
          crowd: block.chords.some((chord) => chord.lane === lane),
          finality: entry.finality,
          kind: lane < 16 ? 'canvas' : lane === 16 ? 'flipbook' : lane === 17 ? 'mint' : 'lab',
        })
      }
    }
  }
  return { from, to: head, blocks, marks }
}

export function blockDetails(block: LaneBlock): LaneDetail[] {
  return block.entries.map((entry) => ({
    txHash: entry.txHash,
    wallet: entry.owner,
    sender: entry.sender,
    action: actionLabel(entry),
    lanes: lanesFor(entry)
      .map((lane) => LANE_LABELS[lane])
      .join(', '),
    pixels: entry.pixels,
    glitches: entry.corrupted,
    conflicts: entry.conflictsWith.length,
  }))
}

export function mergeLaneTxs(current: readonly LaneTx[], incoming: readonly LaneTx[], keepFrom?: bigint) {
  const map = new Map<string, LaneTx>()
  const add = (tx: LaneTx) => {
    if (keepFrom != null && tx.blockNumber < keepFrom) return
    const key = tx.txHash.toLowerCase()
    const prior = map.get(key)
    if (!prior) {
      map.set(key, { ...tx, kinds: new Set(tx.kinds) })
      return
    }
    for (const kind of tx.kinds) prior.kinds.add(kind)
    prior.firstLogIndex = Math.min(prior.firstLogIndex, tx.firstLogIndex)
    prior.regionsMask |= tx.regionsMask
    prior.pixels = Math.max(prior.pixels, tx.pixels)
    prior.corrupted = Math.max(prior.corrupted, tx.corrupted)
    if (prior.owner === '0x0000000000000000000000000000000000000000') prior.owner = tx.owner
    if (prior.sender === '0x0000000000000000000000000000000000000000') prior.sender = tx.sender
    prior.forkId ??= tx.forkId
    prior.forkCreated ||= tx.forkCreated
    prior.auctionId ??= tx.auctionId
    prior.finality = tx.finality ?? prior.finality
  }
  current.forEach(add)
  incoming.forEach(add)
  return [...map.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.firstLogIndex - b.firstLogIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  )
}
