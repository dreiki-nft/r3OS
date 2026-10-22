import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem'
import { SESSION_STARTED, appendSessions, buildSessions, sameIndex } from './live-sessions-lib.mjs'

const PAINT = '0x5102de3817ae16b3afaeb9d180130669a70787b3'
const OWNER = '0x00000000000000000000000000000000000000a1'
const KEY1 = '0x00000000000000000000000000000000000000b1'
const KEY2 = '0x00000000000000000000000000000000000000b2'

const started = (owner: string, sessionKey: string, blockNumber: bigint) => ({
  blockNumber,
  topics: encodeEventTopics({
    abi: [SESSION_STARTED],
    eventName: 'SessionStarted',
    args: { owner, sessionKey },
  }),
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [blockNumber + 100_000n, 5000n]),
})

describe('Live Mode session index', () => {
  it('records [owner, sessionKey, block], checksummed and oldest first; skips foreign logs', () => {
    const index = buildSessions(
      [
        started(OWNER, KEY2, 20n),
        started(OWNER, KEY1, 10n),
        { blockNumber: 5n, topics: ['0x01'], data: '0x' },
      ],
      { chainId: 143, paint: PAINT, fromBlock: 1n, toBlock: 30n },
    )
    expect(index.sessions).toEqual([
      [getAddress(OWNER), getAddress(KEY1), 10],
      [getAddress(OWNER), getAddress(KEY2), 20],
    ])
    expect(index).toMatchObject({ version: 1, chainId: 143, fromBlock: '1', toBlock: '30' })
    expect(sameIndex(index, { chainId: 143, paint: PAINT.toUpperCase().replace('0X', '0x') })).toBe(true)
    expect(sameIndex(index, { chainId: 10143, paint: PAINT })).toBe(false)
  })

  it('appends a refresh that starts right after the file, and refuses a gap', () => {
    const meta = { chainId: 143, paint: PAINT }
    const first = buildSessions([started(OWNER, KEY1, 10n)], { ...meta, fromBlock: 1n, toBlock: 30n })
    const next = buildSessions([started(OWNER, KEY2, 40n)], { ...meta, fromBlock: 31n, toBlock: 50n })
    const both = appendSessions(first, next)
    expect(both.toBlock).toBe('50')
    expect(both.sessions.map((row: unknown[]) => row[2])).toEqual([10, 40])
    const gap = buildSessions([], { ...meta, fromBlock: 60n, toBlock: 70n })
    expect(() => appendSessions(both, gap)).toThrow(/gap/)
  })
})
