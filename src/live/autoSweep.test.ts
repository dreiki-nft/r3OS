import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { clearBalloons, getBalloons } from '../os/balloons'
import type { LiveSnapshot } from './liveStore'

const ME = '0xC493F2059cBE13583A97A3F1104027582071AD43' as Address
const BURNER = '0x0658FCEA7eB44c9E6C7eEc0495c63bEBaade6097' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const MON = 10n ** 18n

let live: LiveSnapshot
let account: Address | undefined = ME
let windows: { id: string }[] = []
let setup = false
const sweepBurner = vi.fn()

vi.mock('../chain/wallet', () => ({
  getWalletSnapshot: () => ({ account }),
  subscribeWallet: () => () => {},
}))
vi.mock('../os/windows', () => ({ getWindows: () => ({ windows }) }))
vi.mock('./liveSetup', () => ({
  liveSetupRunning: () => setup,
  trackAutoSweep: <T>(task: Promise<T>) => task,
}))
vi.mock('./endSession', () => ({ sweepBurner: (...args: unknown[]) => sweepBurner(...args) }))
vi.mock('./liveStore', async (load) => ({
  ...(await load<typeof import('./liveStore')>()),
  getLiveSnapshot: () => live,
  refreshLiveStatus: async () => {},
  subscribeLive: () => () => {},
}))

const { shouldAutoSweep, __autoSweepForTests } = await import('./autoSweep')

function snapshot(
  patch: Partial<LiveSnapshot['session']> = {},
  rest: Partial<LiveSnapshot> = {},
): LiveSnapshot {
  return {
    owner: ME,
    burner: { address: BURNER, privateKey: `0x${'1'.repeat(64)}`, createdAt: 1 },
    session: {
      owner: ME,
      expiryBlock: 115_623_654n,
      maxUnits: 5000n,
      unitsSpent: 799n,
      revoked: false,
      active: false,
      ...patch,
    },
    balance: 891_368_754_000_000_000n,
    sessionPaints: 0n,
    loading: false,
    version: 1,
    ...rest,
  }
}

describe('automatic sweep of finished Live Mode sessions', () => {
  beforeEach(() => {
    account = ME
    windows = []
    setup = false
    live = snapshot()
    sweepBurner.mockReset()
    clearBalloons()
    __autoSweepForTests.reset()
  })

  it('sweeps an expired or revoked session that still holds MON', () => {
    const none = new Set<string>()
    expect(shouldAutoSweep(snapshot(), ME, false, none)).toBe(true)
    expect(shouldAutoSweep(snapshot({ revoked: true }), ME, false, none)).toBe(true)
  })

  it('never touches a running session, one that never started, dust, another wallet, or while busy', () => {
    const none = new Set<string>()
    expect(shouldAutoSweep(snapshot({ active: true }), ME, false, none)).toBe(false)
    expect(shouldAutoSweep(snapshot({ owner: ZERO, expiryBlock: 0n }), ME, false, none)).toBe(false) // funded, setup unfinished
    expect(shouldAutoSweep(snapshot({}, { balance: 420_000_000_000_000n }), ME, false, none)).toBe(false)
    expect(
      shouldAutoSweep(snapshot(), '0x00000000000000000000000000000000000000a1' as Address, false, none),
    ).toBe(false)
    expect(shouldAutoSweep(snapshot({}, { loading: true }), ME, false, none)).toBe(false)
    expect(shouldAutoSweep(snapshot(), ME, true, none)).toBe(false)
    expect(shouldAutoSweep(snapshot(), ME, false, new Set([BURNER.toLowerCase()]))).toBe(false)
  })

  it('sends it back with no wallet prompt, never accepts a higher gas quote, and says so', async () => {
    sweepBurner.mockResolvedValue(891_000_000_000_000_000n)
    await __autoSweepForTests.check()
    expect(sweepBurner).toHaveBeenCalledOnce()
    const options = sweepBurner.mock.calls[0][0]
    expect(options).toMatchObject({ account: ME, burner: BURNER })
    await expect(options.confirmHigherCost()).resolves.toBe(false)
    expect(getBalloons().map((b) => b.title)).toEqual(['Live Mode MON sent back'])
    expect(getBalloons()[0].body).toContain('0.89 MON')
  })

  it('waits while Quick Start runs or the Live Mode wizard is open', async () => {
    setup = true
    await __autoSweepForTests.check()
    windows = [{ id: 'live-wizard' }]
    setup = false
    await __autoSweepForTests.check()
    expect(sweepBurner).not.toHaveBeenCalled()
  })

  it('a failure stays quiet and is not retried in the same page load', async () => {
    sweepBurner.mockRejectedValue(new Error('gas quote changed'))
    await __autoSweepForTests.check()
    await __autoSweepForTests.check()
    expect(sweepBurner).toHaveBeenCalledOnce()
    expect(getBalloons()).toHaveLength(0)
  })

  it('nothing sendable (balance below the gas): no balloon', async () => {
    sweepBurner.mockResolvedValue(0n)
    await __autoSweepForTests.check()
    expect(getBalloons()).toHaveLength(0)
  })
})
