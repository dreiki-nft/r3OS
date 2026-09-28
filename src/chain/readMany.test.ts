import { describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { readManyUsing } from './readMany'

const address = '0x0000000000000000000000000000000000000001' as Address
const calls = [{ address, abi: [] as const, functionName: 'x' }]

describe('readMany', () => {
  it('uses Multicall3 when a verified address is supplied', async () => {
    const client = { multicall: vi.fn().mockResolvedValue([{ status: 'success', result: 7n }]) }
    await expect(
      readManyUsing(client, calls, { allowFailure: false, multicallAddress: address }),
    ).resolves.toEqual([7n])
    expect(client.multicall).toHaveBeenCalledOnce()
  })

  it('falls back to parallel readContract with the same allowFailure shape', async () => {
    const client = { readContract: vi.fn().mockResolvedValue(9n) }
    await expect(readManyUsing(client, calls, { allowFailure: true })).resolves.toEqual([
      { status: 'success', result: 9n },
    ])
  })

  it('reports an individual failure when allowFailure is true', async () => {
    const client = { readContract: vi.fn().mockRejectedValue(new Error('boom')) }
    const rows = (await readManyUsing(client, calls, { allowFailure: true })) as any[]
    expect(rows[0].status).toBe('failure')
    expect(rows[0].error.message).toBe('boom')
  })
})
