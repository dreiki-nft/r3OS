import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { PAINTED } from './community-stats-lib.mjs'
import { buildReplay, defaultOutlineHex, paletteRgb } from './replay-lib.mjs'
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
})
