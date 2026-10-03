import { describe, expect, it } from 'vitest'
import {
  BOOT_LAST_FULL_KEY,
  BOOT_SESSION_KEY,
  BOOT_TIMING,
  bootMode,
  isBooting,
  postLines,
  rememberBoot,
  setBooting,
  shouldBoot,
  subscribeBooting,
} from './bootState'

function memory() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

const base = { chainName: 'Monad Testnet', chainId: 10143, block: 0n, offline: false, demo: false }

describe('boot screen', () => {
  it('boots once per tab session, and survives blocked storage', () => {
    const session = memory()
    expect(shouldBoot(session)).toBe(true)
    rememberBoot(session)
    expect(session.map.get(BOOT_SESSION_KEY)).toBe('1')
    expect(shouldBoot(session)).toBe(false)
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(shouldBoot(blocked)).toBe(true)
    expect(() => rememberBoot(blocked)).not.toThrow()
  })

  it('uses one full POST per day and a short prefetch splash on later page loads', () => {
    const local = memory()
    const firstTab = memory()
    expect(bootMode(firstTab, local, false, '2026-10-02')).toBe('full')
    rememberBoot(firstTab, local, 'full', '2026-10-02')
    expect(local.map.get(BOOT_LAST_FULL_KEY)).toBe('2026-10-02')
    expect(bootMode(firstTab, local, true, '2026-10-02')).toBe('splash')

    const stillWelcoming = memory()
    expect(bootMode(stillWelcoming, local, false, '2026-10-02')).toBe('splash')

    const secondTab = memory()
    expect(bootMode(secondTab, local, true, '2026-10-02')).toBe('splash')
    rememberBoot(secondTab, local, 'splash', '2026-10-02')
    expect(local.map.get(BOOT_LAST_FULL_KEY)).toBe('2026-10-02')

    const tomorrow = memory()
    expect(bootMode(tomorrow, local, true, '2026-10-03')).toBe('full')
  })

  it('prints only real chain facts, and says so while still connecting', () => {
    const connecting = postLines(base).join('\n')
    expect(connecting).toContain('Monad Testnet (10143)')
    expect(connecting).toContain('searching…')
    expect(connecting).toContain('measuring…')
    const live = postLines({ ...base, block: 67_331_845n, blockMs: 291 }).join('\n')
    expect(live).toContain('#67,331,845')
    expect(live).toContain('0.29 s per block')
    expect(postLines({ ...base, demo: true }).join('\n')).toContain('demo mode (no chain)')
    expect(postLines({ ...base, offline: true }).join('\n')).toContain('no signal')
  })

  it('keeps the cosmetic boot short and hard-caps prefetch below ten seconds', () => {
    const lines = postLines(base).length
    const cosmetic =
      lines * BOOT_TIMING.postLineMs + BOOT_TIMING.postHoldMs + BOOT_TIMING.splashMs + BOOT_TIMING.fadeMs
    expect(cosmetic).toBeLessThan(4_000)
    expect(BOOT_TIMING.maxTotalMs).toBeLessThan(10_000)
  })

  it('tells the welcome dialog and assistant to wait', () => {
    let calls = 0
    const stop = subscribeBooting(() => calls++)
    setBooting(true)
    expect(isBooting()).toBe(true)
    setBooting(false)
    stop()
    expect(calls).toBe(2)
  })
})
