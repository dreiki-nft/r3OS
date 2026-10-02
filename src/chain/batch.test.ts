import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Abi, Address } from 'viem'

const mocks = vi.hoisted(() => ({
  provider: {},
  getCapabilities: vi.fn(),
  sendCalls: vi.fn(),
  waitForCallsStatus: vi.fn(),
  getTransaction: vi.fn(),
  quoteAction: vi.fn(),
  sendAction: vi.fn(),
  recordTxTrace: vi.fn(),
  markTraceReceipt: vi.fn(),
  refreshWalletBalance: vi.fn(),
  bumpRefresh: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('./clients', () => ({
  appChain: { id: 10143 },
  publicClient: { getTransaction: mocks.getTransaction },
}))
vi.mock('./config', () => ({ config: { chainId: 10143, demo: false } }))
vi.mock('./wallet', () => ({
  getWalletSnapshot: () => ({
    account: ACCOUNT,
    provider: mocks.provider,
    client: {
      getCapabilities: mocks.getCapabilities,
      sendCalls: mocks.sendCalls,
      waitForCallsStatus: mocks.waitForCallsStatus,
    },
  }),
  refreshWalletBalance: mocks.refreshWalletBalance,
}))
vi.mock('./tx', () => ({ quoteAction: mocks.quoteAction, sendAction: mocks.sendAction }))
vi.mock('./txTrace', () => ({ recordTxTrace: mocks.recordTxTrace, markTraceReceipt: mocks.markTraceReceipt }))
vi.mock('./refreshTick', () => ({ bumpRefresh: mocks.bumpRefresh }))
vi.mock('../os/sound', () => ({ playSound: mocks.playSound }))

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Address
const TOKEN = '0x00000000000000000000000000000000000000bb' as Address
const AUCTION = '0x00000000000000000000000000000000000000cc' as Address
const ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'list',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
] as const satisfies Abi

const quote = {
  gasLimit: 50_000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  maxCost: 'x',
  quotedAtBlock: 1n,
}
const items = () => [
  {
    kind: 'estimate' as const,
    address: TOKEN,
    abi: ABI,
    functionName: 'approve',
    args: [AUCTION, 7n],
    account: ACCOUNT,
    quote,
  },
  {
    kind: 'estimate' as const,
    address: AUCTION,
    abi: ABI,
    functionName: 'list',
    args: [7n],
    account: ACCOUNT,
  },
]

let batch: typeof import('./batch')

beforeEach(async () => {
  vi.resetModules()
  for (const mock of Object.values(mocks)) {
    if (vi.isMockFunction(mock)) mock.mockReset()
  }
  mocks.provider = {}
  mocks.sendAction.mockImplementation(async (opts: { functionName: string }) => ({
    hash: `0x${opts.functionName === 'approve' ? '01' : '02'}`,
    receipt: { logs: [] },
  }))
  mocks.quoteAction.mockResolvedValue(quote)
  batch = await import('./batch')
})

describe('atomicBatchSupported', () => {
  it('accepts supported and ready, rejects everything else', () => {
    expect(batch.atomicBatchSupported({ atomic: { status: 'ready' } })).toBe(true)
    expect(batch.atomicBatchSupported({ atomic: { status: 'supported' } })).toBe(true)
    expect(batch.atomicBatchSupported({ atomic: { status: 'unsupported' } })).toBe(false)
    expect(batch.atomicBatchSupported({})).toBe(false)
    expect(batch.atomicBatchSupported(undefined)).toBe(false)
  })
})

describe('sendActions', () => {
  it('goes step by step when the wallet has no batch support, quoting late steps just in time', async () => {
    mocks.getCapabilities.mockRejectedValue(Object.assign(new Error('nope'), { code: -32601 }))
    const steps: unknown[] = []
    const result = await batch.sendActions(items(), {
      action: 'approve and list',
      onStep: (s) => steps.push(s),
    })
    expect(result).toMatchObject({ batched: false, hashes: ['0x01', '0x02'] })
    expect(mocks.sendCalls).not.toHaveBeenCalled()
    expect(mocks.quoteAction).toHaveBeenCalledTimes(1)
    expect(mocks.quoteAction.mock.calls[0][0].functionName).toBe('list')
    expect(steps).toEqual([
      { index: 0, total: 2, batched: false },
      { index: 1, total: 2, batched: false },
    ])
  })

  it('sends one atomic wallet_sendCalls when the wallet supports it', async () => {
    mocks.getCapabilities.mockResolvedValue({ atomic: { status: 'ready' } })
    mocks.sendCalls.mockResolvedValue({ id: 'batch-1' })
    mocks.waitForCallsStatus.mockResolvedValue({
      status: 'success',
      receipts: [{ transactionHash: '0xaa', blockNumber: 9n, gasUsed: 80_000n, logs: [{ data: '0x' }] }],
    })
    mocks.getTransaction.mockResolvedValue({ gas: 120_000n, maxFeePerGas: 100n, gasPrice: 90n })
    const result = await batch.sendActions(items(), { action: 'approve and list' })
    expect(result).toMatchObject({ batched: true, hashes: ['0xaa'] })
    expect(result.logs).toHaveLength(1)
    expect(mocks.sendAction).not.toHaveBeenCalled()
    const request = mocks.sendCalls.mock.calls[0][0]
    expect(request.forceAtomic).toBe(true)
    expect(request.calls.map((call: { to: string }) => call.to)).toEqual([TOKEN, AUCTION])
    expect(mocks.recordTxTrace.mock.calls[0][0]).toMatchObject({
      hash: '0xaa',
      action: 'approve and list',
      gasLimit: 120_000n,
    })
    expect(mocks.bumpRefresh).toHaveBeenCalled()
  })

  it('falls back to separate transactions when the wallet refuses the batch as unsupported', async () => {
    mocks.getCapabilities.mockResolvedValue({ atomic: { status: 'supported' } })
    mocks.sendCalls.mockRejectedValue(Object.assign(new Error('atomic not supported'), { code: 5710 }))
    const result = await batch.sendActions(items(), { action: 'approve and list' })
    expect(result.batched).toBe(false)
    expect(mocks.sendAction).toHaveBeenCalledTimes(2)
    // Remembered: the next task doesn't try the batch again.
    await batch.sendActions(items(), { action: 'again' })
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1)
  })

  it('does not fall back when the person rejects the batch', async () => {
    mocks.getCapabilities.mockResolvedValue({ atomic: { status: 'ready' } })
    mocks.sendCalls.mockRejectedValue(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
    await expect(batch.sendActions(items(), { action: 'approve and list' })).rejects.toThrow(
      /closed the wallet/,
    )
    expect(mocks.sendAction).not.toHaveBeenCalled()
  })

  it('reports a reverted batch', async () => {
    mocks.getCapabilities.mockResolvedValue({ atomic: { status: 'ready' } })
    mocks.sendCalls.mockResolvedValue({ id: 'batch-2' })
    mocks.waitForCallsStatus.mockResolvedValue({ status: 'failure', receipts: [] })
    await expect(batch.sendActions(items(), { action: 'approve and list' })).rejects.toThrow(/reverted/)
    expect(mocks.bumpRefresh).not.toHaveBeenCalled()
  })

  it('never batches burner calls or a single call', async () => {
    mocks.getCapabilities.mockResolvedValue({ atomic: { status: 'ready' } })
    await batch.sendActions(
      items().map((item) => ({ ...item, signer: 'burner' as const })),
      { action: 'claim' },
    )
    await batch.sendActions(items().slice(0, 1), { action: 'approve' })
    expect(mocks.sendCalls).not.toHaveBeenCalled()
    expect(mocks.getCapabilities).not.toHaveBeenCalled()
  })

  it('labels prompt counts', () => {
    expect(batch.promptCountLabel(2, true)).toBe('1 wallet prompt')
    expect(batch.promptCountLabel(2, false)).toBe('2 wallet prompts')
    expect(batch.promptCountLabel(1, false)).toBe('1 wallet prompt')
  })
})
