import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex, type Log } from 'viem'
import {
  AUCTION_LANE_EVENTS,
  BRUSHES_LANE_EVENTS,
  FORKS_LANE_EVENTS,
  LANE_LAB,
  LANE_MINT,
  PAINT_LANE_EVENTS,
  QUEST_LANE_EVENTS,
  WEEDS_LANE_EVENTS,
  buildLaneBlock,
  buildLaneWindow,
  conflicts,
  decodeLaneLogs,
  isStorm,
  summarize,
  type LaneKind,
  type LaneTx,
} from './lanes'

const PAINT = '0x1000000000000000000000000000000000000001' as Address
const FLIPBOOK = '0x2000000000000000000000000000000000000002' as Address
const WEEDS = '0x3000000000000000000000000000000000000003' as Address
const FORKS = '0x4000000000000000000000000000000000000004' as Address
const BRUSHES = '0x5000000000000000000000000000000000000005' as Address
const AUCTION = '0x6000000000000000000000000000000000000006' as Address
const QUESTS = '0x7000000000000000000000000000000000000007' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const A = '0xa000000000000000000000000000000000000001' as Address
const B = '0xb000000000000000000000000000000000000002' as Address
const C = '0xc000000000000000000000000000000000000003' as Address

function tx(hashByte: string, kinds: LaneKind[], opts: Partial<LaneTx> = {}): LaneTx {
  return {
    txHash: `0x${hashByte.repeat(64)}` as Hex,
    blockNumber: 1000n,
    firstLogIndex: 0,
    kinds: new Set(kinds),
    owner: A,
    regionsMask: 1,
    pixels: 1,
    corrupted: 0,
    ...opts,
    sender: opts.sender ?? opts.owner ?? A,
  }
}

describe('conflicts', () => {
  const originalKinds: LaneKind[] = ['paint', 'flipbook', 'mint', 'reel', 'weeds']
  const expected: Record<string, Record<string, boolean>> = {
    paint: { paint: true, flipbook: false, mint: true, reel: false, weeds: true },
    flipbook: { paint: false, flipbook: true, mint: false, reel: true, weeds: false },
    mint: { paint: true, flipbook: false, mint: true, reel: false, weeds: false },
    reel: { paint: false, flipbook: true, mint: false, reel: true, weeds: false },
    weeds: { paint: true, flipbook: false, mint: false, reel: false, weeds: true },
  }

  for (const aKind of originalKinds) {
    for (const bKind of originalKinds) {
      it(`${aKind} x ${bKind}`, () => {
        const one = tx('1', [aKind], { owner: A, regionsMask: 1 })
        const two = tx('2', [bKind], { owner: B, regionsMask: 1 })
        expect(conflicts(one, two)).toBe(expected[aKind][bKind])
      })
    }
  }

  it('same owner paints collide even across different regions', () => {
    expect(
      conflicts(
        tx('1', ['paint'], { owner: A, regionsMask: 1 }),
        tx('2', ['paint'], { owner: A, regionsMask: 2 }),
      ),
    ).toBe(true)
  })

  it('different owners in different regions do not collide', () => {
    expect(
      conflicts(
        tx('1', ['paint'], { owner: A, regionsMask: 1 }),
        tx('2', ['paint'], { owner: B, regionsMask: 2 }),
      ),
    ).toBe(false)
  })

  it('one nonzero sender always collides with itself for every kind pair', () => {
    const kinds: LaneKind[] = [
      'paint',
      'flipbook',
      'mint',
      'reel',
      'weeds',
      'fork',
      'brush',
      'auction',
      'quest',
    ]
    for (const aKind of kinds) {
      for (const bKind of kinds) {
        expect(
          conflicts(
            tx('1', [aKind], { owner: A, sender: C, regionsMask: 1, forkId: 1n }),
            tx('2', [bKind], { owner: B, sender: C, regionsMask: 2, forkId: 2n }),
          ),
        ).toBe(true)
      }
    }
  })

  it('two unknown zero-address senders do not match', () => {
    expect(
      conflicts(
        tx('1', ['flipbook'], { owner: A, sender: ZERO, regionsMask: 0 }),
        tx('2', ['weeds'], { owner: B, sender: ZERO, regionsMask: 2 }),
      ),
    ).toBe(false)
  })

  it('one gardener in two regions collides even through different senders', () => {
    expect(
      conflicts(
        tx('1', ['weeds'], { owner: A, sender: A, regionsMask: 1 << 1 }),
        tx('2', ['weeds'], { owner: A, sender: C, regionsMask: 1 << 2 }),
      ),
    ).toBe(true)
  })

  it('weeds collide with paint only on overlapping canvas regions', () => {
    const weed0 = tx('4', ['weeds'], { owner: A, regionsMask: 1 })
    expect(conflicts(weed0, tx('5', ['weeds'], { owner: B, regionsMask: 2 }))).toBe(false)
    expect(conflicts(weed0, tx('6', ['paint'], { owner: B, regionsMask: 2 }))).toBe(false)
    expect(conflicts(weed0, tx('7', ['paint'], { owner: B, regionsMask: 1 }))).toBe(true)
  })

  it('forks collide on the same fork or the same owner', () => {
    expect(
      conflicts(tx('1', ['fork'], { owner: A, forkId: 7n }), tx('2', ['fork'], { owner: B, forkId: 7n })),
    ).toBe(true)
    expect(
      conflicts(
        tx('1', ['fork'], { owner: A, sender: B, forkId: 7n }),
        tx('2', ['fork'], { owner: A, sender: C, forkId: 8n }),
      ),
    ).toBe(true)
    expect(
      conflicts(tx('1', ['fork'], { owner: A, forkId: 7n }), tx('2', ['fork'], { owner: B, forkId: 8n })),
    ).toBe(false)
  })

  it('two fork creations always collide because they increment the global fork counter', () => {
    expect(
      conflicts(
        tx('1', ['fork'], { owner: A, forkId: 7n, forkCreated: true }),
        tx('2', ['fork'], { owner: B, forkId: 8n, forkCreated: true }),
      ),
    ).toBe(true)
  })

  it('auctions collide only when they share an auction id beyond the sender rule', () => {
    expect(
      conflicts(
        tx('1', ['auction'], { owner: A, auctionId: 4n }),
        tx('2', ['auction'], { owner: B, auctionId: 4n }),
      ),
    ).toBe(true)
    expect(
      conflicts(
        tx('1', ['auction'], { owner: A, auctionId: 4n }),
        tx('2', ['auction'], { owner: B, auctionId: 5n }),
      ),
    ).toBe(false)
  })

  it('quest claims collide with any transaction attributed to the same owner', () => {
    const kinds: LaneKind[] = [
      'paint',
      'flipbook',
      'mint',
      'reel',
      'weeds',
      'fork',
      'brush',
      'auction',
      'quest',
    ]
    for (const kind of kinds) {
      expect(
        conflicts(
          tx('1', ['quest'], { owner: A, sender: B }),
          tx('2', [kind], { owner: A, sender: C, forkId: 9n, auctionId: 3n }),
        ),
      ).toBe(true)
    }
    expect(
      conflicts(
        tx('1', ['quest'], { owner: A, sender: B }),
        tx('2', ['paint'], { owner: C, sender: C, regionsMask: 2 }),
      ),
    ).toBe(false)
  })

  it('brushes collide by owner, and verifies collide with overlapping paint', () => {
    expect(
      conflicts(
        tx('1', ['brush'], { owner: A, sender: B, regionsMask: 0 }),
        tx('2', ['brush'], { owner: A, sender: C, regionsMask: 0 }),
      ),
    ).toBe(true)
    expect(
      conflicts(
        tx('1', ['brush'], { owner: A, regionsMask: 1 << 5 }),
        tx('2', ['paint'], { owner: B, regionsMask: 1 << 5 }),
      ),
    ).toBe(true)
    expect(
      conflicts(
        tx('1', ['brush'], { owner: A, regionsMask: 0 }),
        tx('2', ['paint'], { owner: B, regionsMask: 1 << 5 }),
      ),
    ).toBe(false)
  })

  it('fork and brush are independent of unrelated app kinds beyond same-sender rules', () => {
    expect(
      conflicts(
        tx('1', ['fork'], { owner: A, forkId: 1n }),
        tx('2', ['paint'], { owner: B, regionsMask: 1 }),
      ),
    ).toBe(false)
    expect(
      conflicts(
        tx('1', ['fork'], { owner: A, forkId: 1n }),
        tx('2', ['weeds'], { owner: B, regionsMask: 1 }),
      ),
    ).toBe(false)
    expect(conflicts(tx('1', ['brush'], { owner: A, regionsMask: 0 }), tx('2', ['mint'], { owner: B }))).toBe(
      false,
    )
  })
})

describe('block construction', () => {
  it('detects chords only at three distinct paint owners', () => {
    const two = buildLaneBlock(1000n, [
      tx('1', ['paint'], { owner: A, regionsMask: 1, firstLogIndex: 1 }),
      tx('2', ['paint'], { owner: B, regionsMask: 1, firstLogIndex: 2 }),
    ])
    expect(two.chords).toEqual([])

    const three = buildLaneBlock(1000n, [
      tx('1', ['paint'], { owner: A, regionsMask: 1, firstLogIndex: 1 }),
      tx('2', ['paint'], { owner: B, regionsMask: 1, firstLogIndex: 2 }),
      tx('3', ['paint'], { owner: C, regionsMask: 1, firstLogIndex: 3 }),
    ])
    expect(three.chords).toHaveLength(1)
    expect(three.chords[0].lane).toBe(0)
  })

  it('puts Labs on the Lab lane, and brush verifies on region lanes too', () => {
    const block = buildLaneBlock(1000n, [
      tx('1', ['fork'], { owner: A, forkId: 1n }),
      tx('2', ['brush'], { owner: B, regionsMask: (1 << 0) | (1 << 5) }),
      tx('3', ['auction'], { owner: C, auctionId: 2n }),
      tx('4', ['quest'], { owner: B, sender: C }),
    ])
    expect(block.laneLoad[LANE_LAB]).toBe(4)
    expect(block.laneLoad[0]).toBe(1)
    expect(block.laneLoad[5]).toBe(1)
  })

  it('marks loads and independence', () => {
    const block = buildLaneBlock(1000n, [
      tx('1', ['paint'], { owner: A, regionsMask: 1, firstLogIndex: 2 }),
      tx('2', ['paint'], { owner: B, regionsMask: 2, firstLogIndex: 1 }),
      tx('3', ['mint'], { owner: C, firstLogIndex: 3 }),
    ])
    expect(block.entries.map((entry) => entry.firstLogIndex)).toEqual([1, 2, 3])
    expect(block.laneLoad[0]).toBe(1)
    expect(block.laneLoad[1]).toBe(1)
    expect(block.laneLoad[LANE_MINT]).toBe(1)
    expect(block.independentCount).toBe(0)
  })

  it('includes empty blocks in windows', () => {
    const blocks = buildLaneWindow([tx('1', ['paint'], { blockNumber: 11n })], 10n, 12n)
    expect(blocks.map((block) => block.blockNumber)).toEqual([10n, 11n, 12n])
    expect(blocks.map((block) => block.entries.length)).toEqual([0, 1, 0])
  })

  it('builds 20,000 txs over 3,000 blocks in under 500 ms', () => {
    const txs: LaneTx[] = []
    for (let i = 0; i < 20_000; i++) {
      const blockNumber = BigInt(i % 3_000)
      const hash = `0x${i.toString(16).padStart(64, '0')}` as Hex
      const owner = (i & 1) === 0 ? A : B
      txs.push({
        txHash: hash,
        blockNumber,
        firstLogIndex: i % 16,
        kinds: new Set(['paint']),
        owner,
        sender: owner,
        regionsMask: 1 << (i % 16),
        pixels: 1,
        corrupted: 0,
      })
    }
    const started = performance.now()
    const blocks = buildLaneWindow(txs, 0n, 2_999n)
    const elapsed = performance.now() - started
    expect(blocks).toHaveLength(3_000)
    expect(elapsed).toBeLessThan(500)
  })

  it('summarizes windows', () => {
    const blocks = buildLaneWindow(
      [
        tx('1', ['paint'], { blockNumber: 10n, owner: A, regionsMask: 1 }),
        tx('2', ['paint'], { blockNumber: 10n, owner: B, regionsMask: 1 }),
        tx('3', ['flipbook'], { blockNumber: 11n, owner: C }),
      ],
      10n,
      11n,
    )
    expect(summarize(blocks)).toEqual({
      blocks: 2,
      txs: 3,
      independentShare: 1 / 3,
      chords: 0,
      busiestLane: 0,
    })
  })
})

describe('storm mirror', () => {
  it('matches the core boundary', () => {
    expect(isStorm(599n)).toBe(true)
    expect(isStorm(600n)).toBe(false)
    expect(isStorm(200_000n)).toBe(true)
  })
})

describe('event decoding', () => {
  function paintedLog(hash: Hex, logIndex: number): Log {
    const topics = encodeEventTopics({
      abi: PAINT_LANE_EVENTS,
      eventName: 'Painted',
      args: { season: 0n, owner: A, sender: B },
    })
    const data = encodeAbiParameters(
      [
        { type: 'bytes', name: 'runs' },
        { type: 'bytes', name: 'corruptions' },
        { type: 'uint32', name: 'unitsSpent' },
        { type: 'uint16', name: 'regionsMask' },
      ],
      ['0x0000030401050605', '0x000104010205', 8, 5],
    )
    return {
      address: PAINT,
      blockHash: `0x${'9'.repeat(64)}`,
      blockNumber: 1000n,
      data,
      logIndex,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
  }

  it('decodes a real ABI-encoded Painted log', () => {
    const decoded = decodeLaneLogs([paintedLog(`0x${'1'.repeat(64)}`, 7)], {
      paint: PAINT,
      flipbook: FLIPBOOK,
    })
    expect(decoded).toHaveLength(1)
    expect(decoded[0].owner).toBe(getAddress(A))
    expect(decoded[0].sender).toBe(getAddress(B))
    expect(decoded[0].regionsMask).toBe(5)
    expect(decoded[0].pixels).toBe(6)
    expect(decoded[0].corrupted).toBe(2)
  })

  it('leaves finale sender unknown instead of using the recipient', () => {
    const hash = `0x${'6'.repeat(64)}` as Hex
    const topics = encodeEventTopics({
      abi: PAINT_LANE_EVENTS,
      eventName: 'SeasonFinaleMinted',
      args: { season: 0n, tokenId: 9n, recipient: A },
    })
    const log = {
      address: PAINT,
      blockHash: `0x${'7'.repeat(64)}`,
      blockNumber: 1000n,
      data: '0x',
      logIndex: 1,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
    const decoded = decodeLaneLogs([log], { paint: PAINT, flipbook: FLIPBOOK })
    expect(decoded[0].owner).toBe(getAddress(A))
    expect(decoded[0].sender).toBe(ZERO)
  })

  it('decodes Weeds ticks onto the matching canvas region lane', () => {
    const hash = `0x${'3'.repeat(64)}` as Hex
    const topics = encodeEventTopics({
      abi: WEEDS_LANE_EVENTS,
      eventName: 'Ticked',
      args: { region: 5, owner: A },
    })
    const data = encodeAbiParameters(
      [
        { type: 'uint64', name: 'generation' },
        { type: 'uint16', name: 'population' },
        { type: 'address', name: 'sender' },
      ],
      [7n, 19, B],
    )
    const log = {
      address: WEEDS,
      blockHash: `0x${'8'.repeat(64)}`,
      blockNumber: 1000n,
      data,
      logIndex: 9,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
    const decoded = decodeLaneLogs([log], { paint: PAINT, flipbook: FLIPBOOK, weeds: WEEDS })
    expect(decoded[0].regionsMask).toBe(1 << 5)
  })

  it('decodes a real ForkPainted log', () => {
    const hash = `0x${'4'.repeat(64)}` as Hex
    const topics = encodeEventTopics({
      abi: FORKS_LANE_EVENTS,
      eventName: 'ForkPainted',
      args: { forkId: 7n, owner: A, sender: B },
    })
    const data = encodeAbiParameters([{ type: 'uint16', name: 'pixels' }], [42])
    const log = {
      address: FORKS,
      blockHash: `0x${'8'.repeat(64)}`,
      blockNumber: 1000n,
      data,
      logIndex: 3,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
    const decoded = decodeLaneLogs([log], { paint: PAINT, flipbook: FLIPBOOK, forks: FORKS })
    expect(decoded[0].kinds).toEqual(new Set(['fork']))
    expect(decoded[0].forkId).toBe(7n)
    expect(decoded[0].owner).toBe(getAddress(A))
    expect(decoded[0].sender).toBe(getAddress(B))
    expect(decoded[0].pixels).toBe(42)
  })

  it('decodes a real BrushVerified log and all four touched regions', () => {
    const hash = `0x${'5'.repeat(64)}` as Hex
    const topics = encodeEventTopics({
      abi: BRUSHES_LANE_EVENTS,
      eventName: 'BrushVerified',
      args: { owner: A, blockNumber: 999n },
    })
    const data = encodeAbiParameters(
      [
        { type: 'address', name: 'sender' },
        { type: 'uint8', name: 'slot' },
        { type: 'uint8', name: 'x' },
        { type: 'uint8', name: 'y' },
        { type: 'uint256', name: 'season' },
      ],
      [B, 2, 60, 60, 0n],
    )
    const log = {
      address: BRUSHES,
      blockHash: `0x${'8'.repeat(64)}`,
      blockNumber: 1000n,
      data,
      logIndex: 4,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
    const decoded = decodeLaneLogs([log], { paint: PAINT, flipbook: FLIPBOOK, brushes: BRUSHES })
    expect(decoded[0].kinds).toEqual(new Set(['brush']))
    expect(decoded[0].regionsMask).toBe((1 << 0) | (1 << 1) | (1 << 4) | (1 << 5))
    const block = buildLaneBlock(1000n, decoded)
    expect(block.laneLoad[LANE_LAB]).toBe(1)
    expect(block.laneLoad[0]).toBe(1)
    expect(block.laneLoad[1]).toBe(1)
    expect(block.laneLoad[4]).toBe(1)
    expect(block.laneLoad[5]).toBe(1)
  })

  it('decodes a real auction BidPlaced log', () => {
    const hash = `0x${'a'.repeat(64)}` as Hex
    const topics = encodeEventTopics({
      abi: AUCTION_LANE_EVENTS,
      eventName: 'BidPlaced',
      args: { auctionId: 12n, bidder: A },
    })
    const data = encodeAbiParameters(
      [
        { type: 'uint128', name: 'total' },
        { type: 'uint48', name: 'blockNumber' },
        { type: 'uint256', name: 'bidIndex' },
      ],
      [123n, 1000, 4n],
    )
    const log = {
      address: AUCTION,
      blockHash: `0x${'8'.repeat(64)}`,
      blockNumber: 1000n,
      data,
      logIndex: 5,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
    const decoded = decodeLaneLogs([log], { paint: PAINT, flipbook: FLIPBOOK, auction: AUCTION })
    expect(decoded[0].kinds).toEqual(new Set(['auction']))
    expect(decoded[0].auctionId).toBe(12n)
    expect(decoded[0].owner).toBe(getAddress(A))
    expect(decoded[0].sender).toBe(getAddress(A))
  })

  it('decodes a real QuestCompleted log', () => {
    const hash = `0x${'b'.repeat(64)}` as Hex
    const topics = encodeEventTopics({
      abi: QUEST_LANE_EVENTS,
      eventName: 'QuestCompleted',
      args: { owner: A, sender: B, questId: 3n },
    })
    const data = encodeAbiParameters([{ type: 'uint32', name: 'count' }], [2])
    const log = {
      address: QUESTS,
      blockHash: `0x${'8'.repeat(64)}`,
      blockNumber: 1000n,
      data,
      logIndex: 6,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
    const decoded = decodeLaneLogs([log], { paint: PAINT, flipbook: FLIPBOOK, quests: QUESTS })
    expect(decoded[0].kinds).toEqual(new Set(['quest']))
    expect(decoded[0].owner).toBe(getAddress(A))
    expect(decoded[0].sender).toBe(getAddress(B))
  })

  it('groups paint + mint logs in one transaction into one entry', () => {
    const hash = `0x${'2'.repeat(64)}` as Hex
    const paintLog = paintedLog(hash, 3)
    const topics = encodeEventTopics({
      abi: PAINT_LANE_EVENTS,
      eventName: 'FrameMinted',
      args: { frameId: 1n, season: 0n, minter: A },
    })
    const data = encodeAbiParameters([{ type: 'uint256', name: 'seasonFrameIndex' }], [1n])
    const mintLog = {
      address: PAINT,
      blockHash: paintLog.blockHash,
      blockNumber: 1000n,
      data,
      logIndex: 4,
      removed: false,
      topics,
      transactionHash: hash,
      transactionIndex: 0,
    } as Log
    const decoded = decodeLaneLogs([paintLog, mintLog], { paint: PAINT, flipbook: FLIPBOOK })
    expect(decoded).toHaveLength(1)
    expect(decoded[0].kinds).toEqual(new Set(['paint', 'mint']))
  })
})
