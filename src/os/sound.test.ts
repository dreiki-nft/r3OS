import { beforeEach, describe, expect, it, vi } from 'vitest'
let gesture: (() => void) | undefined
let plays = 0
let now = 1000
class A {
  src = ''
  volume = 1
  preload = ''
  constructor(src?: string) {
    this.src = src ?? ''
  }
  cloneNode() {
    return new A(this.src)
  }
  async play() {
    plays++
  }
}
describe('sound', () => {
  beforeEach(() => {
    vi.resetModules()
    plays = 0
    now = 1000
    gesture = undefined
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    })
    vi.stubGlobal('Audio', A)
    vi.stubGlobal('window', {
      addEventListener: vi.fn((_n: string, fn: () => void) => {
        gesture = fn
      }),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('performance', { now: () => now })
  })
  it('persists mute and volume', async () => {
    const s = await import('./sound')
    s.setMuted(true)
    s.setVolume(0.35)
    expect(s.isMuted()).toBe(true)
    expect(s.getVolume()).toBe(0.35)
  })
  it('waits for a gesture and throttles the same sound for 80ms', async () => {
    const s = await import('./sound')
    s.initSound()
    s.playSound('select')
    expect(plays).toBe(0)
    gesture?.()
    s.playSound('select')
    s.playSound('select')
    expect(plays).toBe(1)
    now += 80
    s.playSound('select')
    expect(plays).toBe(2)
  })
})
