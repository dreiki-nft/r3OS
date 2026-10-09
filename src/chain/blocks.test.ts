import { describe, expect, it, vi } from 'vitest'
import {
  blockEta,
  emaBlockTime,
  headerFromRpc,
  isStormAt,
  normalizeHeader,
  readLatestHeader,
  stormCountdown,
  __setBlockSnapshotForTests,
} from './blocks'

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

  it('keeps long storm ETAs stable even when WebSocket delivery timing jitters', () => {
    __setBlockSnapshotForTests({ blockTimeMs: 450 })
    expect(blockEta(100_001n)).toBe(30_000_300)
    expect(blockEta(600n)).toBe(270_000)
  })
})

describe('header block clock', () => {
  it('normalizes number, timestamp and miner for subscribers', () => {
    expect(
      normalizeHeader({
        number: 123n,
        timestamp: 456n,
        miner: '0x1234567890123456789012345678901234567890',
        gasUsed: 12n,
        gasLimit: 34n,
      }),
    ).toEqual({
      number: 123n,
      timestamp: 456n,
      miner: '0x1234567890123456789012345678901234567890',
      gasUsed: 12n,
      gasLimit: 34n,
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

describe('newHeads headers', () => {
  it('reads the raw subscription payload without fetching the block again', () => {
    const miner = '0x00000000000000000000000000000000000000aa'
    const hash = `0x${'ab'.repeat(32)}` as const
    expect(
      headerFromRpc({
        number: '0x10',
        timestamp: '0x5f5e100',
        miner,
        hash,
        gasUsed: '0x0',
        gasLimit: '0x1dcd6500',
      }),
    ).toEqual({ number: 16n, timestamp: 100_000_000n, miner, hash, gasUsed: 0n, gasLimit: 500_000_000n })
  })

  it('leaves missing or malformed fields unknown', () => {
    expect(headerFromRpc(undefined)).toMatchObject({ number: 0n, timestamp: 0n })
    const header = headerFromRpc({
      number: '0x2',
      timestamp: 'soon',
      miner: '0x1234',
      hash: 'nope',
      gasUsed: '0x',
    })
    expect(header).toMatchObject({ number: 2n, timestamp: 0n })
    expect(header).not.toHaveProperty('hash')
    expect(header).not.toHaveProperty('gasUsed')
    expect(header.miner).toBe('0x0000000000000000000000000000000000000000')
  })
})
