import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }))

vi.mock('../chain/clients', () => ({
  wsClient: { transport: { subscribe: mocks.subscribe } },
}))

import {
  __resetMonadTraceFeedForTests,
  decodeMonadNotification,
  getMonadTraceFeedSnapshot,
  restartMonadTraceFeed,
  startMonadTraceFeed,
} from '../chain/monadLogs'

const paint = '0x032D5e1591DA2919A4aa5D24Ee9278bFE5F1CdA1' as Address
const hash = `0x${'22'.repeat(32)}`

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('WebSocket resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.subscribe.mockReset()
    __resetMonadTraceFeedForTests()
  })

  afterEach(() => {
    __resetMonadTraceFeedForTests()
    vi.useRealTimers()
  })

  it('recovers from a live websocket drop without a page reload', async () => {
    const stops = [vi.fn(), vi.fn()]
    let fail: ((error: Error) => void) | undefined
    mocks.subscribe
      .mockImplementationOnce(async (args: { onError: (error: Error) => void }) => {
        fail = args.onError
        return { unsubscribe: stops[0] }
      })
      .mockImplementationOnce(async () => ({ unsubscribe: stops[1] }))

    await startMonadTraceFeed([paint])
    expect(getMonadTraceFeedSnapshot().mode).toBe('live')

    fail?.(new Error('socket dropped'))
    expect(getMonadTraceFeedSnapshot().mode).toBe('unavailable')
    await vi.advanceTimersByTimeAsync(1_500)
    await flush()

    expect(mocks.subscribe).toHaveBeenCalledTimes(2)
    expect(getMonadTraceFeedSnapshot().mode).toBe('live')
  })

  it('bounds automatic reconnect attempts and still permits an explicit recovery', async () => {
    mocks.subscribe
      .mockRejectedValueOnce(new Error('offline #1'))
      .mockRejectedValueOnce(new Error('offline #2'))
      .mockRejectedValueOnce(new Error('offline #3'))
      .mockResolvedValueOnce({ unsubscribe: vi.fn() })

    await startMonadTraceFeed([paint])
    await flush()
    expect(getMonadTraceFeedSnapshot().mode).toBe('unavailable')

    await vi.advanceTimersByTimeAsync(1_500)
    await flush()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()

    expect(mocks.subscribe).toHaveBeenCalledTimes(3)
    expect(getMonadTraceFeedSnapshot().mode).toBe('unavailable')

    await restartMonadTraceFeed([paint])
    await flush()
    expect(mocks.subscribe).toHaveBeenCalledTimes(4)
    expect(getMonadTraceFeedSnapshot().mode).toBe('live')
  })

  it('ignores malformed websocket payloads under a large noisy burst instead of throwing', () => {
    for (let index = 0; index < 5_000; index++) {
      expect(decodeMonadNotification({ params: { result: { nonsense: index } } })).toBeUndefined()
    }
    expect(
      decodeMonadNotification({
        params: {
          result: {
            commitState: 'Finalized',
            transactionHash: hash,
            log: { blockNumber: '0x2a' },
          },
        },
      }),
    ).toMatchObject({ commitState: 'Finalized', transactionHash: hash, blockNumber: 42n })
  })
})
