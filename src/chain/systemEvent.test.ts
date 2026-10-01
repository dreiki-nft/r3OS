import { describe, expect, it } from 'vitest'
import { eventState, formatUsd, type SystemEventSnapshot } from './systemEvent'

function snapshot(overrides: Partial<SystemEventSnapshot> = {}): SystemEventSnapshot {
  return {
    loading: false,
    address: '0x0000000000000000000000000000000000000001',
    trigger: 'MON_PRICE_TRIGGER',
    feed: '0x0000000000000000000000000000000000000002',
    feedDecimals: 8,
    thresholdMilliUsd: 333n,
    maxAge: 90_000n,
    feedDescription: 'MON / USD',
    activatedBlock: 0n,
    activationAnswer: 0n,
    condition: { met: false, fresh: true, answer: 3_000_000n, updatedAt: 1n, roundId: 1n },
    ...overrides,
  }
}

describe('system event helpers', () => {
  it('derives all four event states', () => {
    expect(eventState(snapshot({ address: undefined }))).toBe('no-driver')
    expect(eventState(snapshot())).toBe('armed')
    expect(eventState(snapshot({ condition: { ...snapshot().condition, met: true } }))).toBe('condition-met')
    expect(eventState(snapshot({ activatedBlock: 123n }))).toBe('activated')
  })

  it('formats feed answers to four decimals', () => {
    expect(formatUsd(2_995_769n, 8)).toBe('$0.0299')
    expect(formatUsd(33_300_000n, 8)).toBe('$0.3330')
    expect(formatUsd(-123_456_789n, 8)).toBe('-$1.2345')
    expect(formatUsd(333n, 3)).toBe('$0.3330')
  })
})
