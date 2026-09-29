import { afterEach, describe, expect, it, vi } from 'vitest'
import { rateLimited } from './rateLimit'

function transport(run: (method: string) => Promise<unknown>) {
  return (() => ({
    config: {},
    key: 'test',
    name: 'test',
    type: 'custom',
    request: ({ method }: { method: string }) => run(method),
    retryCount: 0,
    retryDelay: 0,
    timeout: 10_000,
  })) as any
}

afterEach(() => vi.useRealTimers())

describe('rateLimited', () => {
  it('uses the endpoint bucket and preserves FIFO order', async () => {
    vi.useFakeTimers()
    const started: string[] = []
    const inner = transport(async (method) => {
      started.push(method)
      return method
    })
    const request = rateLimited(inner, 2)({} as any).request
    const pending = ['a', 'b', 'c', 'd'].map((method) => request({ method } as any))
    await Promise.resolve()
    expect(started).toEqual(['a', 'b'])
    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.all(pending)
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('counts every request independently', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => 'ok')
    const request = rateLimited(transport(run), 1)({} as any).request
    const a = request({ method: 'eth_call' } as any)
    const b = request({ method: 'eth_call' } as any)
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.all([a, b])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('shares one bucket across transport instances (viem fallback re-instantiates per request)', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => 'ok')
    const limited = rateLimited(transport(run), 1)
    const a = limited({} as any).request({ method: 'eth_call' } as any)
    const b = limited({} as any).request({ method: 'eth_call' } as any)
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.all([a, b])
    expect(run).toHaveBeenCalledTimes(2)
  })
})
