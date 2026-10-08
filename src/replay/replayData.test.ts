import { describe, expect, it } from 'vitest'
import {
  KEYFRAME_EVERY,
  applyEventInPlace,
  createCanvasAt,
  eventTime,
  eventsAtFraction,
  fractionOfEvent,
  outlineMask,
  parseReplay,
  type ReplayFile,
} from './replayData'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'

function file(events: ReplayFile['events'], extra: Partial<ReplayFile> = {}): ReplayFile {
  return {
    version: 1,
    chainId: 143,
    paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
    season: 0,
    fromBlock: '1000',
    toBlock: '1100',
    fromTime: 1_000_000,
    toTime: 1_000_040,
    face: 1,
    background: 0,
    outline: '0x000000',
    painters: [A, B],
    events,
    ...extra,
  }
}

describe('season replay data', () => {
  it('validates the file and counts painters in order of first appearance', () => {
    const replay = parseReplay(
      file([
        [0, 0, '0x0a000103', '0x'],
        [10, 1, '0x0b000005', '0x'],
        [20, 0, '0x0c000006', '0x'],
      ]),
    )
    expect(replay.events).toHaveLength(3)
    expect([...replay.paintersSoFar]).toEqual([1, 2, 2])
    expect(() =>
      parseReplay(
        file([
          [5, 0, '0x', '0x'],
          [1, 0, '0x', '0x'],
        ]),
      ),
    ).toThrow('out of order')
    expect(() => parseReplay(file([[0, 1, '0x', '0x']]))).toThrow('painter order')
    expect(() => parseReplay(file([[0, 9, '0x', '0x']]))).toThrow('painter')
    expect(() => parseReplay(file([], { painters: ['nope'] }))).toThrow('bad painter address')
    expect(() => parseReplay(file([], { face: 16 }))).toThrow('bad colour')
    expect(() => parseReplay({ version: 2 })).toThrow('unsupported version')
  })

  it('applies runs and DF1 corruptions like the contract, never over the outline', () => {
    const pixels = new Uint8Array(256 * 256)
    const outline = outlineMask(new Uint8Array([10, 2, 2])) // (2,10) is protected
    applyEventInPlace(pixels, outline, {
      block: 0,
      painter: 0,
      runs: new Uint8Array([10, 0, 4, 9]),
      corruptions: new Uint8Array([3, 10, 4]), // x=3, y=10 → colour 4
    })
    expect([...pixels.slice(10 * 256, 10 * 256 + 6)]).toEqual([9, 9, 0, 4, 9, 0])
  })

  it('rebuilds the canvas at any point, forwards and backwards, using keyframes', () => {
    const events: ReplayFile['events'] = []
    for (let i = 0; i < KEYFRAME_EVERY * 2 + 10; i++) {
      const y = i % 256
      events.push([
        i,
        0,
        `0x${y.toString(16).padStart(2, '0')}0000${((i % 15) + 1).toString(16).padStart(2, '0')}` as `0x${string}`,
        '0x',
      ])
    }
    const replay = parseReplay(file(events, { toBlock: String(1000 + events.length) }))
    const canvasAt = createCanvasAt(replay)
    const reference = (count: number) => {
      const pixels = new Uint8Array(256 * 256)
      for (let i = 0; i < count; i++) applyEventInPlace(pixels, replay.outlineMask, replay.events[i])
      return pixels
    }
    for (const count of [0, 1, KEYFRAME_EVERY + 3, events.length, 5, KEYFRAME_EVERY * 2]) {
      expect(canvasAt(count)).toEqual(reference(count))
    }
  })

  it('maps events to time and playback fractions', () => {
    const replay = parseReplay(
      file([
        [0, 0, '0x', '0x'],
        [50, 1, '0x', '0x'],
        [100, 0, '0x', '0x'],
      ]),
    )
    expect(eventTime(replay, 1)).toBe(1_000_020)
    expect(eventsAtFraction(replay, 0)).toBe(1)
    expect(eventsAtFraction(replay, 0.49)).toBe(1)
    expect(eventsAtFraction(replay, 0.5)).toBe(2)
    expect(eventsAtFraction(replay, 1)).toBe(3)
    expect(fractionOfEvent(replay, 2)).toBe(0.5)
    expect(fractionOfEvent(replay, 3)).toBe(1)
  })
})
