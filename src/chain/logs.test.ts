import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isRangeError,
  LogWindowTooLarge,
  __getLogRangeForTests,
  __resetLogRangeForTests,
  getLogsWindow,
  scanBackward,
} from './logs'

// Tests must not depend on the developer's .env.local (VITE_DEPLOY_BLOCK / VITE_LOGS_RANGE).
vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>()
  return { ...actual, config: { ...actual.config, deployBlock: 0n, logsRange: 100 } }
})

const address = '0x0000000000000000000000000000000000000001' as const

afterEach(() => {
  vi.useRealTimers()
  __resetLogRangeForTests(100)
})

describe('getLogsWindow', () => {
  it('clamps to the deploy floor and resolves latest once before chunking', async () => {
    __resetLogRangeForTests(100)
    const getBlockNumber = vi.fn().mockResolvedValue(250n)
    const getLogs = vi.fn().mockResolvedValue([])
    await getLogsWindow({
      address,
      fromBlock: -20n,
      toBlock: 'latest',
      maxBlocks: 500,
      client: { getBlockNumber, getLogs },
    })
    expect(getBlockNumber).toHaveBeenCalledOnce()
    expect(getLogs.mock.calls.map(([args]) => [args.fromBlock, args.toBlock])).toEqual([
      [0n, 99n],
      [100n, 199n],
      [200n, 250n],
    ])
  })

  it('rejects a window larger than the caller cap', async () => {
    await expect(
      getLogsWindow({
        address,
        fromBlock: 1n,
        toBlock: 101n,
        maxBlocks: 100,
        client: { getLogs: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(LogWindowTooLarge)
  })

  it('shrinks 1000 to 100 to 50 and retries the same cursor', async () => {
    __resetLogRangeForTests(1000)
    const spans: bigint[] = []
    const getLogs = vi.fn(async (args: { fromBlock: bigint; toBlock: bigint }) => {
      const span = args.toBlock - args.fromBlock + 1n
      spans.push(span)
      if (span > 50n) throw Object.assign(new Error('block range limit exceeded'), { code: -32005 })
      return []
    })
    await getLogsWindow({ address, fromBlock: 1n, toBlock: 1_200n, maxBlocks: 1_300, client: { getLogs } })
    expect(spans.slice(0, 3)).toEqual([1_000n, 100n, 50n])
    expect(__getLogRangeForTests()).toBe(50)
  })

  it('backs off and retries ordinary errors three times', async () => {
    vi.useFakeTimers()
    const getLogs = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue([])
    const promise = getLogsWindow({ address, fromBlock: 1n, toBlock: 2n, client: { getLogs } })
    await vi.advanceTimersByTimeAsync(1_500)
    await expect(promise).resolves.toEqual([])
    expect(getLogs).toHaveBeenCalledTimes(3)
  })

  it('honours an aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      getLogsWindow({
        address,
        fromBlock: 1n,
        toBlock: 2n,
        signal: controller.signal,
        client: { getLogs: vi.fn() },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('scanBackward', () => {
  it('starts newest-first and stops once until succeeds', async () => {
    __resetLogRangeForTests(10)
    const calls: Array<[bigint, bigint]> = []
    const getLogs = vi.fn(async (args: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push([args.fromBlock, args.toBlock])
      return args.toBlock === 50n ? [{ blockNumber: 49n }] : []
    })
    const rows = await scanBackward({
      address,
      fromBlock: 1n,
      toBlock: 50n,
      maxBlocks: 30,
      until: (found) => found.length > 0,
      client: { getLogs },
    })
    expect(rows).toHaveLength(1)
    expect(calls).toEqual([[41n, 50n]])
  })
})

describe('range vs rate-limit errors', () => {
  it('treats provider range caps as range errors', () => {
    expect(
      isRangeError(Object.assign(new Error('eth_getLogs is limited to a 100 range'), { code: -32000 })),
    ).toBe(true)
    expect(isRangeError(Object.assign(new Error('bad'), { code: -32614 }))).toBe(true)
  })

  it('never shrinks the range on a 429 or rate limit', () => {
    expect(isRangeError(Object.assign(new Error('HTTP request failed. Status: 429'), { status: 429 }))).toBe(
      false,
    )
    expect(isRangeError(new Error('Too Many Requests'))).toBe(false)
    expect(isRangeError(Object.assign(new Error('rate limit exceeded'), { code: -32005 }))).toBe(false)
  })
})
