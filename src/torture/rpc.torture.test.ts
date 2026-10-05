import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Hex } from 'viem'
import { createActionRpcPool, type ActionRpcClient } from '../chain/actionRpc'
import {
  PUBLIC_RPC_RETRY_COUNT,
  PUBLIC_RPC_TIMEOUT_MS,
  publicRpcWorstCaseSingleEndpointMs,
} from '../chain/readRpcPolicy'

const hash = `0x${'11'.repeat(32)}` as Hex
const raw = `0x${'22'.repeat(80)}` as Hex

function client(overrides: Partial<ActionRpcClient> = {}): ActionRpcClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(10n),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1n }),
    estimateContractGas: vi.fn().mockResolvedValue(100_000n),
    simulateContract: vi.fn().mockResolvedValue({}),
    getBalance: vi.fn().mockResolvedValue(1_000n),
    getTransactionCount: vi.fn().mockResolvedValue(1),
    getTransactionReceipt: vi.fn().mockRejectedValue(new Error('transaction receipt not found')),
    sendRawTransaction: vi.fn().mockResolvedValue(hash),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RPC resilience', () => {
  it('keeps the public-read failure budget bounded instead of reviving the old 15s x retries path', () => {
    expect(PUBLIC_RPC_RETRY_COUNT).toBe(0)
    expect(PUBLIC_RPC_TIMEOUT_MS).toBeLessThanOrEqual(2_500)
    expect(publicRpcWorstCaseSingleEndpointMs()).toBeLessThanOrEqual(2_500)
  })

  it('survives a dead primary repeatedly and keeps returning data from a healthy action RPC', async () => {
    const dead = client({
      getBlockNumber: vi.fn().mockRejectedValue(new Error('503 Service Unavailable')),
    })
    const healthy = client({
      getBlockNumber: vi.fn().mockImplementation(async () => 777n),
    })
    const pool = createActionRpcPool([dead, healthy])

    for (let index = 0; index < 100; index++) {
      await expect(pool.request((rpc) => rpc.getBlockNumber({ cacheTime: 0 }))).resolves.toBe(777n)
    }

    const snapshot = pool.getSnapshot()
    expect(snapshot.endpoints[0].failures).toBeGreaterThanOrEqual(1)
    expect(snapshot.endpoints[1].successes).toBe(100)
    expect(pool.ranked()[0]).toBe(1)
  })

  it('hedges a hung latency-sensitive read without waiting for the hung promise to finish', async () => {
    vi.useFakeTimers()
    const hung = client({
      estimateContractGas: vi.fn(() => new Promise<bigint>(() => undefined)),
    })
    const healthy = client({ estimateContractGas: vi.fn().mockResolvedValue(88_888n) })
    const pool = createActionRpcPool([hung, healthy])

    const pending = pool.hedgedRequest((rpc) => rpc.estimateContractGas({}), 80)
    await vi.advanceTimersByTimeAsync(79)
    expect(healthy.estimateContractGas).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(88_888n)
    expect(healthy.estimateContractGas).toHaveBeenCalledTimes(1)
  })

  it('broadcasts through mixed dead/already-known/healthy endpoints and still accepts the transaction', async () => {
    const dead = client({
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    })
    const known = client({
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('already known')),
    })
    const healthy = client({ sendRawTransaction: vi.fn().mockResolvedValue(hash) })
    const pool = createActionRpcPool([dead, known, healthy])

    const result = await pool.broadcast(raw, hash)
    expect(result.hash).toBe(hash)
    expect([1, 2]).toContain(result.endpointIndex)
    expect(dead.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(known.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(healthy.sendRawTransaction).toHaveBeenCalledTimes(1)
  })

  it('does not let one stale funding RPC veto a quorum that can see the funded burner', async () => {
    const address = `0x${'44'.repeat(20)}` as Hex
    const stale = client({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getBalance: vi.fn().mockResolvedValue(0n),
    })
    const readyA = client({
      getBlockNumber: vi.fn().mockResolvedValue(104n),
      getBalance: vi.fn().mockResolvedValue(2_000n),
    })
    const readyB = client({
      getBlockNumber: vi.fn().mockResolvedValue(105n),
      getBalance: vi.fn().mockResolvedValue(2_000n),
    })
    const pool = createActionRpcPool([stale, readyA, readyB])

    await expect(
      pool.waitForFundingSettlement(address, 1_000n, 100n, {
        settleBlocks: 3n,
        pollMs: 1,
        timeoutMs: 100,
        quorum: 2,
      }),
    ).resolves.toMatchObject({ quorum: 2, ready: 2 })
    expect([1, 2]).toContain(pool.ranked()[0])
  })
})
