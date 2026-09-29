import { describe, expect, it, vi } from 'vitest'
import { emaBlockTime, isStormAt, normalizeHeader, readLatestHeader, stormCountdown } from './blocks'

describe('storms', () => {
  it('detects boundaries', () => {
    expect(isStormAt(0n)).toBe(true)
    expect(isStormAt(599n)).toBe(true)
    expect(isStormAt(600n)).toBe(false)
    expect(isStormAt(200000n)).toBe(true)
  })

  it('counts down', () => {
    expect(stormCountdown(599n).stormEndsIn).toBe(1n)
    expect(stormCountdown(600n).nextStormIn).toBe(199400n)
  })

  it('smooths block time with an EMA', () => {
    expect(emaBlockTime(300, 800, 2)).toBe(320)
  })
})

describe('header block clock', () => {
  it('normalizes number, timestamp and miner for subscribers', () => {
    expect(
      normalizeHeader({
        number: 123n,
        timestamp: 456n,
        miner: '0x1234567890123456789012345678901234567890',
      }),
    ).toEqual({
      number: 123n,
      timestamp: 456n,
      miner: '0x1234567890123456789012345678901234567890',
    })
  })

  it('reads one latest header per poll', async () => {
    const getBlock = vi.fn(async () => ({
      number: 999n,
      timestamp: 111n,
      miner: '0x9999999999999999999999999999999999999999',
    }))
    const header = await readLatestHeader({ getBlock })
    expect(getBlock).toHaveBeenCalledTimes(1)
    expect(getBlock).toHaveBeenCalledWith({ blockTag: 'latest', includeTransactions: false })
    expect(header.number).toBe(999n)
    expect(header.timestamp).toBe(111n)
    expect(header.miner).toBe('0x9999999999999999999999999999999999999999')
  })
})
