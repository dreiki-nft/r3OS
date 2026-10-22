import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import type { LiveSnapshot } from './liveStore'

const ME = '0xC493F2059cBE13583A97A3F1104027582071AD43' as Address
const BURNER = '0x80a3B4cd367254c62a2e63674184d5179c953f4B' as Address
const MON = 10n ** 18n

let live: LiveSnapshot
let account: Address | undefined
const endLiveSession = vi.fn()

vi.mock('../chain/wallet', () => ({ getWalletSnapshot: () => ({ account }) }))
vi.mock('./endSession', () => ({ endLiveSession: (...args: unknown[]) => endLiveSession(...args) }))
vi.mock('./liveStore', async (load) => ({
  ...(await load<typeof import('./liveStore')>()),
  getLiveSnapshot: () => live,
}))

const {
  cancelDisconnect,
  disconnectAnyway,
  endAndDisconnect,
  getDisconnectGuard,
  guardMode,
  requestDisconnect,
} = await import('./disconnectGuardStore')

function snapshot(patch: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    owner: ME,
    burner: { address: BURNER, privateKey: `0x${'1'.repeat(64)}`, createdAt: 1 },
    session: { owner: ME, expiryBlock: 200n, maxUnits: 5000n, unitsSpent: 10n, revoked: false, active: true },
    balance: MON,
    sessionPaints: 3n,
    loading: false,
    version: 1,
    ...patch,
  }
}

describe('disconnect guard', () => {
  beforeEach(() => {
    account = ME
    live = snapshot()
    endLiveSession.mockReset()
    cancelDisconnect()
  })

  it('asks while a session runs, or when an ended one still holds MON; otherwise stays out of the way', () => {
    expect(guardMode(snapshot(), ME)).toBe('active')
    const over = {
      owner: ME,
      expiryBlock: 200n,
      maxUnits: 5000n,
      unitsSpent: 10n,
      revoked: true,
      active: false,
    }
    expect(guardMode(snapshot({ session: over }), ME)).toBe('sweep')
    expect(guardMode(snapshot({ session: over, balance: 420_000_000_000_000n }), ME)).toBeUndefined() // the sweep's reserve
    expect(guardMode(snapshot({ burner: undefined }), ME)).toBeUndefined()
    expect(guardMode(snapshot(), undefined)).toBeUndefined()
    expect(guardMode(snapshot({ owner: BURNER }), ME)).toBeUndefined() // another wallet's state
  })

  it('nothing to warn about: disconnects right away', () => {
    live = snapshot({ burner: undefined })
    const disconnect = vi.fn()
    requestDisconnect(disconnect)
    expect(disconnect).toHaveBeenCalledOnce()
    expect(getDisconnectGuard()).toBeUndefined()
  })

  it('"End session & disconnect": ends the session, then disconnects', async () => {
    const disconnect = vi.fn()
    requestDisconnect(disconnect)
    expect(getDisconnectGuard()).toMatchObject({ mode: 'active', balance: MON, burner: BURNER })
    expect(disconnect).not.toHaveBeenCalled()
    endLiveSession.mockImplementation(async ({ onProgress }) => onProgress('2 of 3 · sweeping leftover MON…'))
    await endAndDisconnect()
    expect(endLiveSession).toHaveBeenCalledWith(
      expect.objectContaining({ account: ME, burner: BURNER, active: true }),
    )
    expect(disconnect).toHaveBeenCalledOnce()
    expect(getDisconnectGuard()).toBeUndefined()
  })

  it('if ending fails: stays connected, shows why, and can still disconnect anyway', async () => {
    const disconnect = vi.fn()
    requestDisconnect(disconnect)
    endLiveSession.mockRejectedValue(new Error('User rejected the request.'))
    await endAndDisconnect()
    expect(disconnect).not.toHaveBeenCalled()
    expect(getDisconnectGuard()?.error).toBeTruthy()
    expect(getDisconnectGuard()?.busy).toBe(false)
    disconnectAnyway()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('Cancel keeps the wallet connected', () => {
    const disconnect = vi.fn()
    requestDisconnect(disconnect)
    cancelDisconnect()
    expect(getDisconnectGuard()).toBeUndefined()
    expect(disconnect).not.toHaveBeenCalled()
  })
})
