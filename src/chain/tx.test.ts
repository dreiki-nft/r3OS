import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'

const mocks = vi.hoisted(() => ({
  block: 10n,
  simulateContract: vi.fn(),
  estimateContractGas: vi.fn(),
  estimateFeesPerGas: vi.fn(),
  getBlockNumber: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  sendTransaction: vi.fn(),
  signBurnerTransaction: vi.fn(),
  broadcastRawTransaction: vi.fn(),
  debitBurnerBalance: vi.fn(),
  notifyBurnerChanged: vi.fn(),
  refreshWalletBalance: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('./clients', () => ({
  appChain: { id: 31337 },
}))
vi.mock('./actionRpc', () => {
  const client = {
    simulateContract: mocks.simulateContract,
    estimateContractGas: mocks.estimateContractGas,
    estimateFeesPerGas: mocks.estimateFeesPerGas,
    getBlockNumber: mocks.getBlockNumber,
  }
  return {
    actionRpcRequest: vi.fn((work: (rpc: typeof client) => Promise<unknown>) => work(client)),
    actionRpcHedgedRequest: vi.fn((work: (rpc: typeof client) => Promise<unknown>) => work(client)),
    probeActionRpcs: vi.fn().mockResolvedValue(undefined),
    broadcastActionRawTransaction: mocks.broadcastRawTransaction,
    waitForActionReceipt: mocks.waitForTransactionReceipt,
  }
})
vi.mock('./blocks', () => ({ getBlockSnapshot: () => ({ block: mocks.block }) }))
vi.mock('./wallet', () => ({
  getWalletSnapshot: () => ({ client: { sendTransaction: mocks.sendTransaction } }),
  refreshWalletBalance: mocks.refreshWalletBalance,
}))
vi.mock('../os/sound', () => ({ playSound: mocks.playSound }))

vi.mock('../live/burner', () => ({
  burnerAccount: () => ({ signTransaction: mocks.signBurnerTransaction }),
  cachedBurnerBalance: () => 10n ** 30n,
  debitCachedBurnerBalance: mocks.debitBurnerBalance,
  loadBurner: () => ({ address: '0x00000000000000000000000000000000000000c1' }),
  notifyBurnerChanged: mocks.notifyBurnerChanged,
}))
vi.mock('../live/nonce', () => ({
  sendWithBurnerNonce: (_address: Address, sender: (nonce: number) => Promise<unknown>) => sender(7),
}))

import {
  __resetFeeCacheForTests,
  burnerCanAfford,
  quoteAction,
  refreshActionQuoteFees,
  sendAction,
  type ActionQuote,
} from './tx'

const account = '0x00000000000000000000000000000000000000a1' as Address
const address = '0x00000000000000000000000000000000000000b1' as Address
const abi = [
  { type: 'function', name: 'ping', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

function quote(overrides: Partial<ActionQuote> = {}): ActionQuote {
  return {
    gasLimit: 150_000n,
    maxFeePerGas: 9n,
    maxPriorityFeePerGas: 2n,
    maxCost: '0.000000 MON max',
    quotedAtBlock: 10n,
    ...overrides,
  }
}

describe('transaction pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetFeeCacheForTests()
    mocks.block = 10n
    mocks.simulateContract.mockResolvedValue({ request: { address, abi, functionName: 'ping', account } })
    mocks.estimateContractGas.mockResolvedValue(100_000n)
    mocks.estimateFeesPerGas.mockResolvedValue({ maxFeePerGas: 20n, maxPriorityFeePerGas: 3n })
    mocks.getBlockNumber.mockResolvedValue(10n)
    mocks.sendTransaction.mockResolvedValue(`0x${'11'.repeat(32)}`)
    mocks.signBurnerTransaction.mockResolvedValue('0x1234')
    mocks.broadcastRawTransaction.mockImplementation(
      async (_serialized: string, expectedHash: string) => ({ hash: expectedHash, endpointIndex: 0 }),
    )
    mocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 11n,
      logs: [],
      gasUsed: 90_000n,
      effectiveGasPrice: 8n,
    })
    mocks.refreshWalletBalance.mockResolvedValue(undefined)
  })

  it('does not duplicate execution work for estimated quotes', async () => {
    const result = await quoteAction({ kind: 'estimate', address, abi, functionName: 'ping', account })
    expect(result.gasLimit).toBe(110_000n)
    expect(mocks.estimateContractGas).toHaveBeenCalledTimes(1)
    expect(mocks.simulateContract).not.toHaveBeenCalled()
  })

  it('refreshes fee caps without re-estimating a validated gas limit', async () => {
    const shown = quote({ gasLimit: 222_000n, maxFeePerGas: 4n, maxPriorityFeePerGas: 1n })
    mocks.block = 19n
    mocks.estimateFeesPerGas.mockResolvedValueOnce({ maxFeePerGas: 33n, maxPriorityFeePerGas: 5n })
    const next = await refreshActionQuoteFees(shown)
    expect(next.gasLimit).toBe(222_000n)
    expect(next.maxFeePerGas).toBe(33n)
    expect(next.maxPriorityFeePerGas).toBe(5n)
    expect(next.quotedAtBlock).toBe(19n)
    expect(mocks.estimateContractGas).not.toHaveBeenCalled()
  })

  it('shares an in-flight fee quote across concurrent actions', async () => {
    let resolveFees!: (value: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) => void
    mocks.estimateFeesPerGas.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFees = resolve }),
    )

    const first = quoteAction({ kind: 'estimate', address, abi, functionName: 'ping', account })
    const second = quoteAction({ kind: 'estimate', address, abi, functionName: 'ping', account })
    await Promise.resolve()
    resolveFees({ maxFeePerGas: 20n, maxPriorityFeePerGas: 3n })
    await Promise.all([first, second])

    expect(mocks.estimateFeesPerGas).toHaveBeenCalledTimes(1)
    expect(mocks.estimateContractGas).toHaveBeenCalledTimes(2)
  })

  it('opens the wallet from the fresh quote without a redundant pre-send simulation', async () => {
    const shown = quote()
    await sendAction({ kind: 'estimate', address, abi, functionName: 'ping', account, quote: shown })
    expect(mocks.simulateContract).not.toHaveBeenCalled()
    expect(mocks.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: address,
        data: expect.stringMatching(/^0x/),
        gas: shown.gasLimit,
        maxFeePerGas: shown.maxFeePerGas,
        maxPriorityFeePerGas: shown.maxPriorityFeePerGas,
      }),
    )
  })

  it('requires confirmation when a stale re-quote raises max cost', async () => {
    mocks.block = 40n
    const confirm = vi.fn().mockResolvedValue(false)
    await expect(
      sendAction({
        kind: 'estimate',
        address,
        abi,
        functionName: 'ping',
        account,
        quote: quote({ gasLimit: 100_000n, maxFeePerGas: 1n, quotedAtBlock: 1n }),
        confirmHigherCost: confirm,
      }),
    ).rejects.toThrow('you closed the wallet')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
  })

  it('signs burner transactions locally before broadcasting the exact raw transaction', async () => {
    const shown = quote({ gasLimit: 21_000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n })
    await sendAction({
      kind: 'estimate',
      address,
      abi,
      functionName: 'ping',
      account,
      signer: 'burner',
      quote: shown,
      action: 'paint 1 px',
    })
    expect(mocks.signBurnerTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 31337,
        gas: 21_000n,
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 2n,
        nonce: 7,
        type: 'eip1559',
      }),
    )
    expect(mocks.broadcastRawTransaction).toHaveBeenCalledWith('0x1234', expect.stringMatching(/^0x/))
  })

  it('can suppress the failure sound for an internal retry attempt', async () => {
    mocks.broadcastRawTransaction.mockRejectedValueOnce(new Error('Missing or invalid parameters'))
    await expect(
      sendAction({
        kind: 'estimate',
        address,
        abi,
        functionName: 'ping',
        account,
        signer: 'burner',
        quote: quote(),
        suppressFailureSound: true,
      }),
    ).rejects.toThrow()
    expect(mocks.playSound).not.toHaveBeenCalled()
  })

  it('keeps a burner send pending when its balance cannot cover the gas cap', () => {
    const shown = quote({ gasLimit: 21_000n, maxFeePerGas: 10n })
    expect(burnerCanAfford(209_999n, shown)).toBe(false)
    expect(burnerCanAfford(210_000n, shown)).toBe(true)
    expect(burnerCanAfford(310_000n, shown, 100_001n)).toBe(false)
  })
})
