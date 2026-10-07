import { describe, expect, it, vi } from 'vitest'
import type { Hex } from 'viem'
import {
  createActionRpcPool,
  isAlreadyKnownRawTx,
  isRpcInfrastructureError,
  type ActionRpcClient,
} from './actionRpc'

const hash = `0x${'11'.repeat(32)}` as Hex
const raw = `0x${'22'.repeat(80)}` as Hex

function client(overrides: Partial<ActionRpcClient> = {}): ActionRpcClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(10n),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1n }),
    estimateGas: vi.fn().mockResolvedValue(21_000n),
    estimateContractGas: vi.fn().mockResolvedValue(100_000n),
    simulateContract: vi.fn().mockResolvedValue({}),
    getBalance: vi.fn().mockResolvedValue(1n),
    getTransactionCount: vi.fn().mockResolvedValue(1),
    getTransactionReceipt: vi.fn().mockRejectedValue(new Error('transaction receipt not found')),
    sendRawTransaction: vi.fn().mockResolvedValue(hash),
    ...overrides,
  }
}

describe('action RPC pool', () => {
  it('fails over infrastructure errors without retrying contract errors', async () => {
    const first = client({ getBlockNumber: vi.fn().mockRejectedValue(new Error('Failed to fetch')) })
    const second = client({ getBlockNumber: vi.fn().mockResolvedValue(22n) })
    const pool = createActionRpcPool([first, second])
    await expect(pool.request((rpc) => rpc.getBlockNumber())).resolves.toBe(22n)

    const revert = new Error('execution reverted: Nope')
    first.getBlockNumber = vi.fn().mockRejectedValue(revert)
    pool.reset()
    await expect(pool.request((rpc) => rpc.getBlockNumber())).rejects.toBe(revert)
    expect(second.getBlockNumber).toHaveBeenCalledTimes(1)
  })

  it('hedges a slow read to the next ranked endpoint after the latency window', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const slow = client({
      getBlockNumber: vi.fn(() =>
        new Promise<bigint>((resolve) => {
          release = () => resolve(11n)
        }),
      ),
    })
    const fast = client({ getBlockNumber: vi.fn().mockResolvedValue(22n) })
    const pool = createActionRpcPool([slow, fast])

    const result = pool.hedgedRequest((rpc) => rpc.getBlockNumber(), 80)
    await vi.advanceTimersByTimeAsync(79)
    expect(fast.getBlockNumber).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe(22n)
    expect(slow.getBlockNumber).toHaveBeenCalledTimes(1)
    expect(fast.getBlockNumber).toHaveBeenCalledTimes(1)

    release()
    vi.useRealTimers()
  })

  it('broadcasts one signed raw transaction to every endpoint and takes the first acceptance', async () => {
    let release!: () => void
    const slow = client({
      sendRawTransaction: vi.fn(() => new Promise<Hex>((resolve) => {
        release = () => resolve(hash)
      })),
    })
    const fast = client({ sendRawTransaction: vi.fn().mockResolvedValue(hash) })
    const pool = createActionRpcPool([slow, fast])
    await expect(pool.broadcast(raw, hash)).resolves.toEqual({ hash, endpointIndex: 1 })
    expect(slow.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: raw })
    expect(fast.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: raw })
    release()
  })

  it('treats already-known responses as successful redundant broadcast', async () => {
    const known = client({ sendRawTransaction: vi.fn().mockRejectedValue(new Error('already known')) })
    const pool = createActionRpcPool([known])
    await expect(pool.broadcast(raw, hash)).resolves.toEqual({ hash, endpointIndex: 0 })
  })

  it('records probes without exposing endpoint URLs', async () => {
    const pool = createActionRpcPool([client(), client()])
    await pool.probe()
    const snapshot = pool.getSnapshot()
    expect(snapshot.endpoints).toHaveLength(2)
    expect(snapshot.endpoints.every((endpoint) => endpoint.successes === 1)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/https?:\/\//)
  })

  it('waits until the preferred action RPC can see freshly funded burner balance', async () => {
    const getBalance = vi
      .fn()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValue(1_000n)
    const pool = createActionRpcPool([client({ getBalance })])
    await expect(pool.waitForBalance(`0x${'33'.repeat(20)}` as Hex, 1_000n, 1_000)).resolves.toBe(
      1_000n,
    )
    expect(getBalance).toHaveBeenCalledTimes(3)
  })

  it('waits for multiple action RPCs to move several blocks past the funding receipt', async () => {
    const address = `0x${'44'.repeat(20)}` as Hex
    const firstBlock = vi.fn().mockResolvedValueOnce(100n).mockResolvedValue(104n)
    const secondBlock = vi.fn().mockResolvedValueOnce(101n).mockResolvedValue(104n)
    const staleBlock = vi.fn().mockResolvedValue(100n)
    const pool = createActionRpcPool([
      client({ getBlockNumber: firstBlock, getBalance: vi.fn().mockResolvedValue(1_000n) }),
      client({ getBlockNumber: secondBlock, getBalance: vi.fn().mockResolvedValue(1_000n) }),
      client({ getBlockNumber: staleBlock, getBalance: vi.fn().mockResolvedValue(0n) }),
    ])

    const result = await pool.waitForFundingSettlement(address, 1_000n, 100n, {
      settleBlocks: 3n,
      pollMs: 1,
      timeoutMs: 100,
    })

    expect(result).toMatchObject({ targetBlock: 103n, quorum: 2, ready: 2 })
    expect([0, 1]).toContain(result.preferred)
    expect(pool.ranked()[0]).toBe(result.preferred)
    await expect(pool.request((rpc) => rpc.getBlockNumber({ cacheTime: 0 }))).resolves.toBe(104n)
    const readyBlocks = [firstBlock, secondBlock]
    expect(readyBlocks[result.preferred]).toHaveBeenCalledTimes(3)
    expect(readyBlocks[result.preferred === 0 ? 1 : 0]).toHaveBeenCalledTimes(2)
    expect(staleBlock).toHaveBeenCalledTimes(2)
  })
})

describe('action RPC error classification', () => {
  it('distinguishes network failures from execution errors', () => {
    expect(isRpcInfrastructureError(new Error('HTTP request failed: 503 Service Unavailable'))).toBe(true)
    expect(isRpcInfrastructureError(new Error('execution reverted'))).toBe(false)
    expect(isAlreadyKnownRawTx(new Error('already known'))).toBe(true)
  })
})
