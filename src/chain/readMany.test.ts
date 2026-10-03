import { describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { readHeavyUsing, readManyUsing } from './readMany'

const address = '0x0000000000000000000000000000000000000001' as Address
const call = { address, abi: [] as const, functionName: 'x' }

describe('readMany', () => {
  it('splits 250 calls into three bounded multicalls', async () => {
    const multicall = vi.fn(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.map(() => ({ status: 'success', result: 7n })),
    )
    const rows = await readManyUsing(
      { multicall },
      Array.from({ length: 250 }, () => call),
      {
        allowFailure: true,
        multicallAddress: address,
      },
    )
    expect(rows).toHaveLength(250)
    expect(multicall).toHaveBeenCalledTimes(3)
    expect(multicall.mock.calls.map(([args]) => args.contracts.length)).toEqual([100, 100, 50])
  })

  it('runs at most four Multicall3 chunks at once', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const multicall = vi.fn(async ({ contracts }: { contracts: unknown[] }) => {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active--
      return contracts.map(() => ({ status: 'success', result: 7n }))
    })
    const promise = readManyUsing(
      { multicall },
      Array.from({ length: 450 }, () => call),
      { allowFailure: true, multicallAddress: address },
    )
    await vi.waitFor(() => expect(peak).toBe(4))
    while (multicall.mock.calls.length < 5 || releases.length) {
      releases.splice(0).forEach((release) => release())
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await promise
    expect(multicall).toHaveBeenCalledTimes(5)
    expect(peak).toBe(4)
  })

  it('falls back to parallel readContract with the same allowFailure shape', async () => {
    const client = { readContract: vi.fn().mockResolvedValue(9n) }
    await expect(readManyUsing(client, [call], { allowFailure: true })).resolves.toEqual([
      { status: 'success', result: 9n },
    ])
  })

  it('reports an individual failure when allowFailure is true', async () => {
    const client = { readContract: vi.fn().mockRejectedValue(new Error('boom')) }
    const rows = (await readManyUsing(client, [call], { allowFailure: true })) as any[]
    expect(rows[0].status).toBe('failure')
    expect(rows[0].error.message).toBe('boom')
  })
})

describe('readHeavy', () => {
  it('never runs more than two eth_call reads at once by default', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const client = {
      readContract: vi.fn(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active--
        return 1n
      }),
    }
    const promise = readHeavyUsing(
      client,
      Array.from({ length: 5 }, () => call),
    )
    await Promise.resolve()
    expect(peak).toBe(2)
    while (client.readContract.mock.calls.length < 5 || releases.length) {
      releases.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await promise
    expect(peak).toBe(2)
    expect(client.readContract).toHaveBeenCalledTimes(5)
  })

  it('runs bounded arbitrary RPC tasks without multicalling them', async () => {
    let active = 0
    let peak = 0
    const task = () => ({
      run: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 0))
        active--
        return 7n
      },
    })
    const rows = await readHeavyUsing({}, [task(), task(), task()], { concurrency: 2 })
    expect(peak).toBeLessThanOrEqual(2)
    expect(rows).toEqual([
      { status: 'success', result: 7n },
      { status: 'success', result: 7n },
      { status: 'success', result: 7n },
    ])
  })
})
