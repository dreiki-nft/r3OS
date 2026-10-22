import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'

const OWNER = '0x649995F20D11F54188e865D8a4ADcFDE4692ecd1' as Address
const BURNER = '0x2217C255B93D2fd636fa4020d75e9bc1b7CeD5c6' as Address
const MON = 10n ** 18n

let balance = 2n * MON
const sent: string[] = []
const deleteBurner = vi.fn()

vi.mock('../chain/config', () => ({
  config: { paintAddress: '0x5102de3817ae16b3afaeb9d180130669a70787b3', chainId: 143 },
}))
vi.mock('../chain/clients', () => ({ publicClient: { getBalance: async () => balance } }))
vi.mock('../chain/tx', () => ({
  quoteAction: async () => ({
    gasLimit: 21_000n,
    maxFeePerGas: 10n ** 11n,
    maxCost: '0.0021 MON',
    quotedAtBlock: 1n,
  }),
  sendAction: async (opts: { functionName: string }) => {
    sent.push(opts.functionName)
    if (opts.functionName === 'transfer') {
      // The race: another sweep already sent the MON back, so this one can't pay its own gas.
      balance = 420_000_000_000_000n
      throw new Error('not enough MON to pay for this transaction and its gas')
    }
  },
}))
vi.mock('../lib/generated/abi', () => ({ R3OS_PAINT_ABI: [] }))
vi.mock('../os/confirm', () => ({ confirmHigherCost: async () => true }))
vi.mock('./burner', () => ({ deleteBurner: (...a: unknown[]) => deleteBurner(...a) }))
vi.mock('./liveStore', () => ({
  refreshLiveStatus: async () => {},
  sweepAmount: (b: bigint, g: bigint, f: bigint) => (b > g * f ? b - g * f : 0n),
}))

const { endLiveSession } = await import('./endSession')
const { liveSetupRunning, trackAutoSweep } = await import('./liveSetup')

describe('ending a Live Mode session', () => {
  beforeEach(() => {
    balance = 2n * MON
    sent.length = 0
    deleteBurner.mockReset()
  })

  it('holds the automatic sweep off while it runs', async () => {
    let during = false
    const run = endLiveSession({
      account: OWNER,
      burner: BURNER,
      active: true,
      onProgress: () => (during = liveSetupRunning()),
    })
    await run
    expect(during).toBe(true)
    expect(liveSetupRunning()).toBe(false)
  })

  it('a sweep that fails because the MON is already back still ends the session cleanly', async () => {
    await expect(endLiveSession({ account: OWNER, burner: BURNER, active: true })).resolves.toBeUndefined()
    expect(sent).toEqual(['revokeSession', 'transfer'])
    expect(deleteBurner).toHaveBeenCalledWith(OWNER)
  })

  it('a sweep that fails with the MON still there is a real error, and the key stays', async () => {
    const tx = await import('../chain/tx')
    vi.spyOn(tx, 'sendAction').mockImplementation(async (opts: { functionName: string }) => {
      if (opts.functionName === 'transfer') throw new Error('rejected')
      return undefined as never
    })
    await expect(endLiveSession({ account: OWNER, burner: BURNER, active: false })).rejects.toThrow(
      'rejected',
    )
    expect(deleteBurner).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('waits for an automatic sweep that is already sending before sweeping', async () => {
    let release!: () => void
    const order: string[] = []
    void trackAutoSweep(new Promise<void>((r) => (release = r))).then(() => order.push('auto-sweep done'))
    const run = endLiveSession({
      account: OWNER,
      burner: BURNER,
      active: false,
      onProgress: (text) => order.push(text.slice(0, 6)),
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toEqual([]) // still waiting
    release()
    await run
    expect(order.indexOf('auto-sweep done')).toBeLessThan(order.lastIndexOf('3 of 3'))
    expect(sent).toEqual(['transfer'])
  })
})
