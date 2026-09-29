import { decodeEventLog, parseAbi, type Address, type Hex, type Log } from 'viem'

export type LaneKind =
  'paint' | 'flipbook' | 'mint' | 'reel' | 'weeds' | 'fork' | 'brush' | 'auction' | 'quest'
export const LANE_FLIPBOOK = 16
export const LANE_MINT = 17
export const LANE_LAB = 18
export const LANE_COUNT = 19

export interface LaneTx {
  txHash: `0x${string}`
  blockNumber: bigint
  firstLogIndex: number
  kinds: Set<LaneKind>
  owner: `0x${string}`
  sender: `0x${string}`
  regionsMask: number
  pixels: number
  corrupted: number
  forkId?: bigint
  forkCreated?: boolean
  auctionId?: bigint
  finality?: 'proposed' | 'voted' | 'finalized'
}

export interface LaneEntry extends LaneTx {
  independent: boolean
  conflictsWith: `0x${string}`[]
}

export interface Chord {
  lane: number
  owners: `0x${string}`[]
}

export interface LaneBlock {
  blockNumber: bigint
  storm: boolean
  entries: LaneEntry[]
  independentCount: number
  sharedCount: number
  laneLoad: number[]
  chords: Chord[]
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export const PAINT_LANE_EVENTS = parseAbi([
  'event Painted(uint256 indexed season,address indexed owner,address indexed sender,bytes runs,bytes corruptions,uint32 unitsSpent,uint16 regionsMask)',
  'event FrameMinted(uint256 indexed frameId,uint256 indexed season,address indexed minter,uint256 seasonFrameIndex)',
  'event SeasonFinaleMinted(uint256 indexed season,uint256 indexed tokenId,address indexed recipient)',
])

export const FLIPBOOK_LANE_EVENTS = parseAbi([
  'event FlipbookPainted(uint64 indexed frameNumber,address indexed owner,address indexed sender,bytes runs,uint16 pixels)',
  'event ReelMinted(uint256 indexed id,address indexed minter,uint64 firstFrame,uint64 lastFrame)',
])

export const WEEDS_LANE_EVENTS = parseAbi([
  'event Ticked(uint8 indexed region,uint64 generation,uint16 population,address indexed owner,address sender)',
  'event Planted(uint8 indexed region,uint8 x,uint8 y,uint8 pattern,address indexed owner,address sender)',
])

export const FORKS_LANE_EVENTS = parseAbi([
  'event ForkCreated(uint256 indexed forkId,uint256 indexed sourceFrameId,uint256 parentForkId,address indexed creator,uint16 depth)',
  'event ForkPainted(uint256 indexed forkId,address indexed owner,address indexed sender,uint16 pixels)',
])

export const BRUSHES_LANE_EVENTS = parseAbi([
  'event BrushCaught(address indexed owner,address sender,uint8 slot,uint256 indexed blockNumber,uint256 brush)',
  'event BrushVerified(address indexed owner,address sender,uint8 slot,uint256 indexed blockNumber,uint8 x,uint8 y,uint256 season)',
])

export const AUCTION_LANE_EVENTS = parseAbi([
  'event BidPlaced(uint256 indexed auctionId,address indexed bidder,uint128 total,uint48 blockNumber,uint256 bidIndex)',
  'event Settled(uint256 indexed auctionId,address indexed winner,uint128 price,uint128 royalty,uint48 endBlock)',
  'event Cancelled(uint256 indexed auctionId)',
])

export const QUEST_LANE_EVENTS = parseAbi([
  'event QuestCompleted(address indexed owner,address indexed sender,uint256 indexed questId,uint32 count)',
])

export function isStorm(block: bigint): boolean {
  return block % 200_000n < 600n
}

export function decodeLaneLogs(
  logs: Log[],
  addrs: {
    paint: Address
    flipbook: Address
    weeds?: Address
    forks?: Address
    brushes?: Address
    auction?: Address
    quests?: Address
  },
): LaneTx[] {
  const grouped = new Map<Hex, LaneTx>()
  const paintAddress = addrs.paint.toLowerCase()
  const flipbookAddress = addrs.flipbook.toLowerCase()
  const weedsAddress = addrs.weeds?.toLowerCase()
  const forksAddress = addrs.forks?.toLowerCase()
  const brushesAddress = addrs.brushes?.toLowerCase()
  const auctionAddress = addrs.auction?.toLowerCase()
  const questsAddress = addrs.quests?.toLowerCase()

  const getEntry = (log: Log): LaneTx | undefined => {
    if (!log.transactionHash || log.blockNumber == null) return undefined
    const hash = log.transactionHash as Hex
    let entry = grouped.get(hash)
    if (!entry) {
      entry = {
        txHash: hash,
        blockNumber: log.blockNumber,
        firstLogIndex: Number(log.logIndex ?? 0),
        kinds: new Set<LaneKind>(),
        owner: ZERO_ADDRESS,
        sender: ZERO_ADDRESS,
        regionsMask: 0,
        pixels: 0,
        corrupted: 0,
      }
      grouped.set(hash, entry)
    } else {
      entry.firstLogIndex = Math.min(entry.firstLogIndex, Number(log.logIndex ?? 0))
    }
    return entry
  }

  for (const log of logs) {
    const address = log.address.toLowerCase()
    if (address === paintAddress) {
      try {
        const decoded = decodeEventLog({
          abi: PAINT_LANE_EVENTS,
          data: log.data,
          topics: log.topics,
          strict: false,
        })
        const entry = getEntry(log)
        if (!entry) continue
        if (decoded.eventName === 'Painted') {
          const args = decoded.args as unknown as {
            owner: Address
            sender: Address
            runs: Hex
            corruptions: Hex
            regionsMask: number
          }
          entry.kinds.add('paint')
          entry.owner = args.owner
          entry.sender = args.sender
          entry.regionsMask |= Number(args.regionsMask)
          entry.pixels += pixelCountFromPaintRuns(args.runs)
          entry.corrupted += hexByteLength(args.corruptions) / 3
        } else if (decoded.eventName === 'FrameMinted') {
          const args = decoded.args as unknown as { minter: Address }
          entry.kinds.add('mint')
          if (entry.owner === ZERO_ADDRESS) entry.owner = args.minter
          if (entry.sender === ZERO_ADDRESS) entry.sender = args.minter
        } else if (decoded.eventName === 'SeasonFinaleMinted') {
          const args = decoded.args as unknown as { recipient: Address }
          entry.kinds.add('mint')
          if (entry.owner === ZERO_ADDRESS) entry.owner = args.recipient
          // The finale recipient is not necessarily the caller. Sender stays unknown.
        }
      } catch {
        // Ignore logs from the same address that are not part of the Lanes event subset.
      }
    } else if (address === flipbookAddress) {
      try {
        const decoded = decodeEventLog({
          abi: FLIPBOOK_LANE_EVENTS,
          data: log.data,
          topics: log.topics,
          strict: false,
        })
        const entry = getEntry(log)
        if (!entry) continue
        if (decoded.eventName === 'FlipbookPainted') {
          const args = decoded.args as unknown as { owner: Address; sender: Address; pixels: number }
          entry.kinds.add('flipbook')
          entry.owner = args.owner
          entry.sender = args.sender
          entry.pixels += Number(args.pixels)
        } else if (decoded.eventName === 'ReelMinted') {
          const args = decoded.args as unknown as { minter: Address }
          entry.kinds.add('reel')
          if (entry.owner === ZERO_ADDRESS) entry.owner = args.minter
          if (entry.sender === ZERO_ADDRESS) entry.sender = args.minter
        }
      } catch {
        // Ignore unrelated flipbook logs such as ERC-721 Transfer.
      }
    } else if (weedsAddress && address === weedsAddress) {
      try {
        const decoded = decodeEventLog({
          abi: WEEDS_LANE_EVENTS,
          data: log.data,
          topics: log.topics,
          strict: false,
        })
        const entry = getEntry(log)
        if (!entry) continue
        if (decoded.eventName === 'Ticked' || decoded.eventName === 'Planted') {
          const args = decoded.args as unknown as { region: number; owner: Address; sender: Address }
          entry.kinds.add('weeds')
          entry.owner = args.owner
          entry.sender = args.sender
          entry.regionsMask |= 1 << Number(args.region)
        }
      } catch {
        // Ignore unrelated Weeds logs.
      }
    } else if (forksAddress && address === forksAddress) {
      try {
        const decoded = decodeEventLog({
          abi: FORKS_LANE_EVENTS,
          data: log.data,
          topics: log.topics,
          strict: false,
        })
        const entry = getEntry(log)
        if (!entry) continue
        if (decoded.eventName === 'ForkCreated') {
          const args = decoded.args as unknown as { forkId: bigint; creator: Address }
          entry.kinds.add('fork')
          entry.forkId = args.forkId
          entry.forkCreated = true
          entry.owner = args.creator
          entry.sender = args.creator
        } else if (decoded.eventName === 'ForkPainted') {
          const args = decoded.args as unknown as {
            forkId: bigint
            owner: Address
            sender: Address
            pixels: number
          }
          entry.kinds.add('fork')
          entry.forkId = args.forkId
          entry.owner = args.owner
          entry.sender = args.sender
          entry.pixels += Number(args.pixels)
        }
      } catch {
        // Ignore ERC-721 and metadata logs from the Forks contract.
      }
    } else if (brushesAddress && address === brushesAddress) {
      try {
        const decoded = decodeEventLog({
          abi: BRUSHES_LANE_EVENTS,
          data: log.data,
          topics: log.topics,
          strict: false,
        })
        const entry = getEntry(log)
        if (!entry) continue
        if (decoded.eventName === 'BrushCaught') {
          const args = decoded.args as unknown as { owner: Address; sender: Address }
          entry.kinds.add('brush')
          entry.owner = args.owner
          entry.sender = args.sender
        } else if (decoded.eventName === 'BrushVerified') {
          const args = decoded.args as unknown as { owner: Address; sender: Address; x: number; y: number }
          entry.kinds.add('brush')
          entry.owner = args.owner
          entry.sender = args.sender
          entry.regionsMask |= brushRegionsMask(Number(args.x), Number(args.y))
        }
      } catch {
        // Ignore unrelated Brush logs.
      }
    } else if (auctionAddress && address === auctionAddress) {
      try {
        const decoded = decodeEventLog({
          abi: AUCTION_LANE_EVENTS,
          data: log.data,
          topics: log.topics,
          strict: false,
        })
        const entry = getEntry(log)
        if (!entry) continue
        if (decoded.eventName === 'BidPlaced') {
          const args = decoded.args as unknown as { auctionId: bigint; bidder: Address }
          entry.kinds.add('auction')
          entry.auctionId = args.auctionId
          entry.owner = args.bidder
          entry.sender = args.bidder
        } else if (decoded.eventName === 'Settled') {
          const args = decoded.args as unknown as { auctionId: bigint; winner: Address }
          entry.kinds.add('auction')
          entry.auctionId = args.auctionId
          if (entry.owner === ZERO_ADDRESS) entry.owner = args.winner
        } else if (decoded.eventName === 'Cancelled') {
          const args = decoded.args as unknown as { auctionId: bigint }
          entry.kinds.add('auction')
          entry.auctionId = args.auctionId
        }
      } catch {
        // Ignore unrelated auction logs.
      }
    } else if (questsAddress && address === questsAddress) {
      try {
        const decoded = decodeEventLog({
          abi: QUEST_LANE_EVENTS,
          data: log.data,
          topics: log.topics,
          strict: false,
        })
        const entry = getEntry(log)
        if (!entry) continue
        if (decoded.eventName === 'QuestCompleted') {
          const args = decoded.args as unknown as { owner: Address; sender: Address }
          entry.kinds.add('quest')
          entry.owner = args.owner
          entry.sender = args.sender
        }
      } catch {
        // Ignore unrelated quest logs.
      }
    }
  }

  return [...grouped.values()].sort(
    (a, b) => Number(a.blockNumber - b.blockNumber) || a.firstLogIndex - b.firstLogIndex,
  )
}

export function conflicts(a: LaneTx, b: LaneTx): boolean {
  if (a.txHash === b.txHash) return false
  // Two transactions from one sender share that account's nonce and balance.
  if (a.sender !== ZERO_ADDRESS && sameAddress(a.sender, b.sender)) return true
  for (const ak of a.kinds) {
    for (const bk of b.kinds) {
      if (kindConflict(ak, bk, a, b)) return true
    }
  }
  return false
}

function kindConflict(aKind: LaneKind, bKind: LaneKind, a: LaneTx, b: LaneTx): boolean {
  if (aKind === 'paint' && bKind === 'paint') {
    return (a.regionsMask & b.regionsMask) !== 0 || sameAddress(a.owner, b.owner)
  }
  if ((aKind === 'paint' && bKind === 'mint') || (aKind === 'mint' && bKind === 'paint')) return true
  if (aKind === 'mint' && bKind === 'mint') return true
  if (aKind === 'flipbook' && bKind === 'flipbook') return true
  if ((aKind === 'flipbook' && bKind === 'reel') || (aKind === 'reel' && bKind === 'flipbook')) return true
  if (aKind === 'reel' && bKind === 'reel') return true
  if (aKind === 'weeds' && bKind === 'weeds') {
    // Same region: same world page. Same owner: same gardener-stats slot.
    return (a.regionsMask & b.regionsMask) !== 0 || sameAddress(a.owner, b.owner)
  }
  if ((aKind === 'weeds' && bKind === 'paint') || (aKind === 'paint' && bKind === 'weeds')) {
    return (a.regionsMask & b.regionsMask) !== 0
  }
  if (aKind === 'fork' && bKind === 'fork') {
    const sameFork = a.forkId !== undefined && b.forkId !== undefined && a.forkId === b.forkId
    const bothCreate = a.forkCreated === true && b.forkCreated === true
    return sameFork || bothCreate || sameAddress(a.owner, b.owner)
  }
  if (aKind === 'brush' && bKind === 'brush') return sameAddress(a.owner, b.owner)
  if ((aKind === 'brush' && bKind === 'paint') || (aKind === 'paint' && bKind === 'brush')) {
    return (a.regionsMask & b.regionsMask) !== 0
  }
  if (aKind === 'auction' && bKind === 'auction') {
    return a.auctionId !== undefined && b.auctionId !== undefined && a.auctionId === b.auctionId
  }
  if (aKind === 'quest' || bKind === 'quest') {
    return a.owner !== ZERO_ADDRESS && b.owner !== ZERO_ADDRESS && sameAddress(a.owner, b.owner)
  }
  return false
}

export function buildLaneBlock(blockNumber: bigint, txs: LaneTx[]): LaneBlock {
  const entries = txs
    .filter((tx) => tx.blockNumber === blockNumber)
    .sort((a, b) => a.firstLogIndex - b.firstLogIndex)
    .map((tx) => ({ ...tx, kinds: new Set(tx.kinds), independent: true, conflictsWith: [] as Hex[] }))

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (!conflicts(entries[i], entries[j])) continue
      entries[i].independent = false
      entries[j].independent = false
      entries[i].conflictsWith.push(entries[j].txHash)
      entries[j].conflictsWith.push(entries[i].txHash)
    }
  }

  const laneLoad = Array.from({ length: LANE_COUNT }, () => 0)
  for (const entry of entries) for (const lane of lanesFor(entry)) laneLoad[lane]++

  const chords: Chord[] = []
  for (let lane = 0; lane < 16; lane++) {
    const owners = distinctOwners(
      entries.filter((entry) => entry.kinds.has('paint') && (entry.regionsMask & (1 << lane)) !== 0),
    )
    if (owners.length >= 3) chords.push({ lane, owners })
  }
  const independentCount = entries.filter((entry) => entry.independent).length
  return {
    blockNumber,
    storm: isStorm(blockNumber),
    entries,
    independentCount,
    sharedCount: entries.length - independentCount,
    laneLoad,
    chords,
  }
}

export function buildLaneWindow(txs: LaneTx[], fromBlock: bigint, toBlock: bigint): LaneBlock[] {
  if (toBlock < fromBlock) return []
  const byBlock = new Map<bigint, LaneTx[]>()
  for (const tx of txs) {
    if (tx.blockNumber < fromBlock || tx.blockNumber > toBlock) continue
    const group = byBlock.get(tx.blockNumber)
    if (group) group.push(tx)
    else byBlock.set(tx.blockNumber, [tx])
  }

  const out: LaneBlock[] = []
  for (let block = fromBlock; block <= toBlock; block++)
    out.push(buildLaneBlock(block, byBlock.get(block) ?? []))
  return out
}

export function summarize(blocks: LaneBlock[]): {
  blocks: number
  txs: number
  independentShare: number
  chords: number
  busiestLane: number | null
} {
  const txs = blocks.reduce((sum, block) => sum + block.entries.length, 0)
  const independent = blocks.reduce((sum, block) => sum + block.independentCount, 0)
  const chords = blocks.reduce((sum, block) => sum + block.chords.length, 0)
  const loads = Array.from({ length: LANE_COUNT }, () => 0)
  for (const block of blocks)
    for (let lane = 0; lane < LANE_COUNT; lane++) loads[lane] += block.laneLoad[lane]
  let busiestLane: number | null = null
  let busiestLoad = 0
  for (let lane = 0; lane < loads.length; lane++) {
    if (loads[lane] > busiestLoad) {
      busiestLoad = loads[lane]
      busiestLane = lane
    }
  }
  return {
    blocks: blocks.length,
    txs,
    independentShare: txs === 0 ? 0 : independent / txs,
    chords,
    busiestLane,
  }
}

export function lanesFor(tx: LaneTx): number[] {
  const lanes = new Set<number>()
  if (tx.kinds.has('paint') || tx.kinds.has('weeds') || tx.kinds.has('brush')) {
    for (let lane = 0; lane < 16; lane++) if ((tx.regionsMask & (1 << lane)) !== 0) lanes.add(lane)
  }
  if (tx.kinds.has('flipbook') || tx.kinds.has('reel')) lanes.add(LANE_FLIPBOOK)
  if (tx.kinds.has('mint')) lanes.add(LANE_MINT)
  if (tx.kinds.has('fork') || tx.kinds.has('brush') || tx.kinds.has('auction') || tx.kinds.has('quest'))
    lanes.add(LANE_LAB)
  return [...lanes]
}

function brushRegionsMask(x: number, y: number): number {
  const rx0 = x >> 6
  const rx1 = (x + 7) >> 6
  const ry0 = y >> 6
  const ry1 = (y + 7) >> 6
  let mask = 0
  for (let ry = ry0; ry <= ry1; ry++) {
    for (let rx = rx0; rx <= rx1; rx++) mask |= 1 << (ry * 4 + rx)
  }
  return mask
}

function distinctOwners(entries: LaneTx[]): Hex[] {
  const seen = new Set<string>()
  const owners: Hex[] = []
  for (const entry of entries) {
    const key = entry.owner.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    owners.push(entry.owner)
  }
  return owners
}

function sameAddress(a: Hex, b: Hex): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function hexByteLength(value: Hex): number {
  return (value.length - 2) / 2
}

function pixelCountFromPaintRuns(runs: Hex): number {
  const hex = runs.slice(2)
  let pixels = 0
  for (let offset = 0; offset + 8 <= hex.length; offset += 8) {
    const x0 = Number.parseInt(hex.slice(offset + 2, offset + 4), 16)
    const x1 = Number.parseInt(hex.slice(offset + 4, offset + 6), 16)
    pixels += x1 - x0 + 1
  }
  return pixels
}
