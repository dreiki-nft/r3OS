import { describe, expect, it } from 'vitest'
import {
  BOOT_SESSION_KEY,
  BOOT_TIMING,
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

  it('stays short', () => {
    const lines = postLines(base).length
    const total =
      lines * BOOT_TIMING.postLineMs + BOOT_TIMING.postHoldMs + BOOT_TIMING.splashMs + BOOT_TIMING.fadeMs
    expect(total).toBeLessThan(4_000)
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
