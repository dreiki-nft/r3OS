import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { PAINTED } from './community-stats-lib.mjs'
import { appendReplay, buildReplay, defaultOutlineHex, paletteRgb, replayFrames } from './replay-lib.mjs'
import { parseReplay } from '../src/replay/replayData'

const A = '0x00000000000000000000000000000000000000A1'
const B = '0x00000000000000000000000000000000000000b2'

function log(owner: string, season: bigint, block: bigint, logIndex: number, runs: `0x${string}`) {
  return {
    blockNumber: block,
    logIndex,
    topics: encodeEventTopics({
      abi: [PAINTED],
      eventName: 'Painted',
      args: { season, owner, sender: owner },
    }),
    data: encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint32' }, { type: 'uint16' }],
      [runs, '0x0a0b05', 4, 1],
    ),
  }
}

describe('replay export', () => {
  it('orders events by block and log index, keeps only the season, and indexes painters by first appearance', () => {
    const replay = buildReplay(
      [
        log(B, 0n, 120n, 0, '0x0b000005'),
        log(A, 0n, 110n, 1, '0x0a000103'),
        log(A, 0n, 110n, 0, '0x0a000203'),
        log(B, 1n, 115n, 0, '0x0c000003'),
      ],
      {
        chainId: 143,
        paint: '0x5102DE3817AE16B3AFAEB9D180130669A70787B3',
        season: 0n,
        fromBlock: 100n,
        toBlock: 200n,
        fromTime: 1_000n,
        toTime: 1_040n,
        face: 1,
        background: 0,
        outline: defaultOutlineHex(),
      },
    )
    expect(replay.painters).toEqual([A.toLowerCase(), B])
    expect(replay.events).toEqual([
      [10, 0, '0x0a000203', '0x0a0b05'],
      [10, 0, '0x0a000103', '0x0a0b05'],
      [20, 1, '0x0b000005', '0x0a0b05'],
    ])
    // The site's strict parser accepts exactly what the exporter writes.
    expect(parseReplay(JSON.parse(JSON.stringify(replay))).events).toHaveLength(3)
  })

  it('reads the palette and default outline from the committed sources', () => {
    const palette = paletteRgb()
    expect(palette).toHaveLength(16)
    expect(palette[11]).toEqual([95, 237, 223])
    expect(defaultOutlineHex()).toMatch(/^0x[0-9a-f]{300,}$/)
  })

  it('animates only a block window, starting from the canvas as it stood before it', () => {
    // Three strokes on row 0: x=0 before the window, x=1 inside it, x=2 after it. Background 0 shows as 9.
    const replay = {
      fromBlock: '100',
      outline: '0x',
      face: 1,
      background: 9,
      events: [
        [0, 0, '0x00000003', '0x'],
        [50, 0, '0x00010104', '0x'],
        [150, 0, '0x00020205', '0x'],
      ],
    }
    const frames = replayFrames(replay, 2, { fromBlock: 120n, toBlock: 200n })
    expect([frames[0][0], frames[0][1], frames[0][2]]).toEqual([3, 9, 9])
    expect([frames[1][0], frames[1][1], frames[1][2]]).toEqual([3, 4, 9])
    const all = replayFrames(replay, 3)
    expect([all[2][0], all[2][1], all[2][2]]).toEqual([3, 4, 5])
  })
})

describe('replay refresh', () => {
  const C = '0x00000000000000000000000000000000000000c3'
  const meta = (toBlock: bigint, toTime: bigint) => ({
    chainId: 143,
    paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
    season: 0n,
    fromBlock: 100n,
    toBlock,
    fromTime: 1_000n,
    toTime,
    face: 1,
    background: 0,
    outline: defaultOutlineHex(),
  })

  it('appends only the new blocks and matches a full rescan', () => {
    const early = [log(A, 0n, 110n, 0, '0x0a000203'), log(B, 0n, 120n, 0, '0x0b000005')]
    const late = [log(C, 0n, 160n, 0, '0x0c000003'), log(A, 0n, 170n, 0, '0x0d000001')]
    const existing = buildReplay(early, meta(150n, 1_020n))
    const tail = buildReplay(late, meta(200n, 1_040n))
    const merged = appendReplay(existing, tail)
    const full = buildReplay([...early, ...late], meta(200n, 1_040n))
    expect(merged).toEqual(full)
    expect(merged.painters).toEqual([A.toLowerCase(), B, C])
    expect(parseReplay(JSON.parse(JSON.stringify(merged))).events).toHaveLength(4)
  })

  it('keeps the file when nothing is newer and refuses mismatched or overlapping exports', () => {
    const existing = buildReplay([log(A, 0n, 110n, 0, '0x0a000203')], meta(150n, 1_020n))
    expect(appendReplay(existing, buildReplay([], meta(150n, 1_020n)))).toBe(existing)
    expect(() => appendReplay(existing, { ...buildReplay([], meta(200n, 1_040n)), season: 1 })).toThrow(/season/)
    const overlap = buildReplay([log(B, 0n, 140n, 0, '0x0b000005')], meta(200n, 1_040n))
    expect(() => appendReplay(existing, overlap)).toThrow(/overlap/)
  })
})
