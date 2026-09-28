import { describe, expect, it, vi } from 'vitest'
import { createNonceManager } from './nonce'

describe('burner nonce manager', () => {
  it('sends strictly one at a time with no nonce gaps', async () => {
    const manager = createNonceManager(async () => 8)
    const order: string[] = []
    let release!: () => void
    const first = manager.send(async (nonce) => {
      order.push(`first:${nonce}`)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return nonce
    })
    const second = manager.send(async (nonce) => {
      order.push(`second:${nonce}`)
      return nonce
    })
    await vi.waitFor(() => expect(order).toEqual(['first:8']))
    release()
    await expect(first).resolves.toBe(8)
    await expect(second).resolves.toBe(9)
    expect(order).toEqual(['first:8', 'second:9'])
  })

  it('resyncs once after nonce too low', async () => {
    const pending = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(5)
    const manager = createNonceManager(pending)
    const sender = vi
      .fn<(nonce: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error('nonce too low'))
      .mockResolvedValueOnce(5)
    await expect(manager.send(sender)).resolves.toBe(5)
    expect(sender.mock.calls.map(([nonce]) => nonce)).toEqual([3, 5])
    expect(pending).toHaveBeenCalledTimes(2)
  })
})
