import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }))

vi.mock('./clients', () => ({
  wsClient: { transport: { subscribe: mocks.subscribe } },
}))

import {
  __resetMonadTraceFeedForTests,
  decodeMonadNotification,
  getMonadTraceFeedSnapshot,
  restartMonadTraceFeed,
  startMonadTraceFeed,
} from './monadLogs'

const hash = `0x${'22'.repeat(32)}`
const blockId = `0x${'ab'.repeat(32)}`
const paint = '0x032D5e1591DA2919A4aa5D24Ee9278bFE5F1CdA1' as Address

describe('monadLogs decoder', () => {
  beforeEach(() => {
    __resetMonadTraceFeedForTests()
    mocks.subscribe.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('unwraps Proposed, Voted and Finalized notifications', () => {
    expect(
      decodeMonadNotification({
        params: {
          result: {
            blockId,
            commitState: 'Proposed',
            transactionHash: hash,
            log: { blockNumber: '0xa' },
          },
        },
      }),
    ).toEqual({ blockId, blockNumber: 10n, commitState: 'Proposed', transactionHash: hash })
    expect(
      decodeMonadNotification({ data: { commitState: 'Voted', transactionHash: hash } })?.commitState,
    ).toBe('Voted')
    expect(decodeMonadNotification({ commitState: 'Finalized', transactionHash: hash })?.commitState).toBe(
      'Finalized',
    )
  })

  it('decodes the current flat monadLogs payload including proposal identity and raw log data', () => {
    const decoded = decodeMonadNotification({
      params: {
        result: {
          blockId,
          commitState: 'Proposed',
          address: paint,
          blockHash: `0x${'cd'.repeat(32)}`,
          blockNumber: '0x2a',
          data: '0x1234',
          logIndex: '0x3',
          topics: [`0x${'11'.repeat(32)}`],
          transactionHash: hash,
        },
      },
    })
    expect(decoded).toMatchObject({
      blockId,
      blockNumber: 42n,
      commitState: 'Proposed',
      transactionHash: hash,
      log: { address: paint, blockNumber: 42n, logIndex: 3, data: '0x1234' },
    })
  })

  it('does not recurse forever when a block number is missing', () => {
    expect(decodeMonadNotification({ commitState: 'Proposed', transactionHash: hash })).toEqual({
      blockId: undefined,
      blockNumber: undefined,
      commitState: 'Proposed',
      transactionHash: hash,
    })
  })

  it('reconnects a live commit-state feed after a transient websocket drop', async () => {
    vi.useFakeTimers()
    const stops = [vi.fn(), vi.fn()]
    let firstError: ((error: Error) => void) | undefined
    mocks.subscribe
      .mockImplementationOnce(async (args: { onError: (error: Error) => void }) => {
        firstError = args.onError
        return { unsubscribe: stops[0] }
      })
      .mockImplementationOnce(async () => ({ unsubscribe: stops[1] }))

    await startMonadTraceFeed([paint])
    expect(getMonadTraceFeedSnapshot().mode).toBe('live')

    firstError?.(new Error('socket dropped'))
    expect(getMonadTraceFeedSnapshot().mode).toBe('unavailable')
    expect(stops[0]).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_500)
    await Promise.resolve()
    expect(mocks.subscribe).toHaveBeenCalledTimes(2)
    expect(getMonadTraceFeedSnapshot().mode).toBe('live')
  })

  it('allows an explicit retry after the feed is unavailable', async () => {
    const firstStop = vi.fn()
    const secondStop = vi.fn()
    let fail: ((error: Error) => void) | undefined
    mocks.subscribe
      .mockImplementationOnce(async (args: { onError: (error: Error) => void }) => {
        fail = args.onError
        return { unsubscribe: firstStop }
      })
      .mockImplementationOnce(async () => ({ unsubscribe: secondStop }))

    await startMonadTraceFeed([paint])
    fail?.(new Error('unsupported for this connection'))
    expect(getMonadTraceFeedSnapshot().mode).toBe('unavailable')

    await restartMonadTraceFeed([paint])
    expect(firstStop).toHaveBeenCalled()
    expect(mocks.subscribe).toHaveBeenCalledTimes(2)
    expect(getMonadTraceFeedSnapshot().mode).toBe('live')
  })
})
