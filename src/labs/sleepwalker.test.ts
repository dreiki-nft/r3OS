import { describe, expect, it } from 'vitest'
import { hashStruct, keccak256, stringToHex, type Address, type Hex } from 'viem'
import { START_SESSION_TYPE_STRING, START_SESSION_TYPES } from '../live/liveStore'
import {
  buildSleepwalkerStencil,
  cursorPixels,
  filterReadySleepers,
  orderDreamt,
  planSleepwalkerSessions,
  sleepwalkerTypedData,
  stepCodeMessage,
  suggestedSleepwalkerTip,
  sleepwalkerStepMaxCost,
  nightShiftProfit,
  dreamWindowBlocks,
  reduceNightShiftCandidates,
  untimedReplayOrder,
} from './sleepwalker'

const owner = '0x0000000000000000000000000000000000000001' as Address
const key = '0x0000000000000000000000000000000000000002' as Address

function run(y: number, x0: number, x1: number, colour: number) {
  return [y, x0, x1, colour].map((value) => value.toString(16).padStart(2, '0')).join('')
}

describe('Sleepwalker session planning', () => {
  it('uses consecutive nonces and exact MAX_SESSION_BLOCKS spacing for 1–4 sessions', () => {
    for (let count = 1; count <= 4; count++) {
      const plans = planSleepwalkerSessions({
        owner,
        sessionKey: key,
        block: 100n,
        nonce: 7n,
        count,
        maxSessionBlocks: 24_000n,
        maxUnits: 8_192n,
        deadline: 99_999n,
      })
      expect(plans).toHaveLength(count)
      expect(plans[0].expiryBlock).toBe(24_100n)
      for (let i = 0; i < plans.length; i++) {
        expect(plans[i].nonce).toBe(7n + BigInt(i))
        if (i) expect(plans[i].expiryBlock - plans[i - 1].expiryBlock).toBe(24_000n)
      }
    }
  })

  it('uses the core StartSession EIP-712 type and domain', () => {
    const [plan] = planSleepwalkerSessions({
      owner,
      sessionKey: key,
      block: 100n,
      nonce: 0n,
      count: 1,
      maxSessionBlocks: 24_000n,
      maxUnits: 100n,
      deadline: 999n,
    })
    const typed = sleepwalkerTypedData(plan)
    expect(typed.domain.name).toBe('r3tards paint')
    expect(typed.domain.version).toBe('2')
    expect(keccak256(stringToHex(START_SESSION_TYPE_STRING))).toBe(
      keccak256(
        stringToHex(
          'StartSession(address owner,address sessionKey,uint256 expiryBlock,uint256 maxUnits,uint256 nonce,uint256 deadline)',
        ),
      ),
    )
    expect(hashStruct({ data: plan, primaryType: 'StartSession', types: START_SESSION_TYPES })).toBeTypeOf(
      'string',
    )
  })
})

describe('Sleepwalker stencil/replay', () => {
  it('keeps the frozen 4-byte run format and enforces the 4096 px cap', () => {
    const hex = `0x${run(2, 3, 5, 4)}${run(9, 10, 11, 7)}` as Hex
    expect(buildSleepwalkerStencil(hex)).toMatchObject({ pixels: 5 })
    expect(cursorPixels(hex, 4)).toEqual([
      { x: 3, y: 2, colour: 4 },
      { x: 4, y: 2, colour: 4 },
      { x: 5, y: 2, colour: 4 },
      { x: 10, y: 9, colour: 7 },
    ])
    const oversized = `0x${Array.from({ length: 17 }, (_, y) => run(y, 0, 255, 1)).join('')}` as Hex
    expect(() => buildSleepwalkerStencil(oversized)).toThrow()
  })

  it('orders Dreamt events by block and cursor', () => {
    expect(
      orderDreamt([
        { cursorFrom: 64, cursorTo: 128, pixels: 64, blockNumber: 12 },
        { cursorFrom: 0, cursorTo: 64, pixels: 60, blockNumber: 11 },
      ])[0].cursorFrom,
    ).toBe(0)
  })
})

describe('Sleepwalker bounded history', () => {
  it('derives the dream window from four session windows plus slack', () => {
    expect(dreamWindowBlocks(24_000n)).toBe(100_000n)
  })

  it('replays an untimed dream in stencil order up to the cursor', () => {
    expect(untimedReplayOrder(0)).toEqual([0])
    expect(untimedReplayOrder(190, 64)).toEqual([0, 64, 128, 190])
  })
})

describe('Sleepwalker Night Shift', () => {
  it('reduces Slept and DreamResumed candidates to unique latest owners', () => {
    expect(
      reduceNightShiftCandidates([
        { owner, tip: 1n },
        { owner: key, tip: 2n },
        { owner, tip: 3n },
      ]),
    ).toEqual([
      { owner, tip: 3n },
      { owner: key, tip: 2n },
    ])
  })

  it('maps step codes to words and filters readiness', () => {
    expect(stepCodeMessage(5)).toBe("hasn't painted today")
    expect(stepCodeMessage(7, 23n)).toBe('too soon, wait 23 blocks')
    expect(filterReadySleepers([{ owner }, { owner: key }], [false, true])).toEqual([{ owner: key }])
  })
})

describe('Sleepwalker tip economics', () => {
  it('suggests at least 125% of the crank max cost and rounds up cleanly', () => {
    const fee = 2_000_000_000n
    const maxCost = sleepwalkerStepMaxCost(fee)
    const suggested = suggestedSleepwalkerTip(fee)
    expect(suggested).toBeGreaterThanOrEqual((maxCost * 125n + 99n) / 100n)
    expect(suggested % 1_000_000_000_000_000n).toBe(0n)
  })

  it('reports positive and negative Night Shift profit', () => {
    const fee = 1_000_000_000n
    expect(nightShiftProfit(2_000_000_000_000_000n, fee).profitable).toBe(true)
    const loss = nightShiftProfit(500_000_000_000_000n, fee)
    expect(loss.profitable).toBe(false)
    expect(loss.profit).toBeLessThan(0n)
  })
})
