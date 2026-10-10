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

  it('starts at half volume on a fresh device', async () => {
    const s = await import('./sound')
    expect(s.getVolume()).toBe(0.5)
    expect(s.DEFAULT_VOLUME).toBe(0.5)
  })

  it('plays through Web Audio with the chosen volume once the sound is loaded', async () => {
    const gains: number[] = []
    let started = 0
    class Ctx {
      state = 'running'
      destination = {}
      resume = async () => {}
      decodeAudioData = async () => ({ duration: 0.1 })
      createGain() {
        const node = { gain: { value: 1 }, connect: (target: unknown) => target }
        gains.push(0)
        const index = gains.length - 1
        Object.defineProperty(node.gain, 'value', {
          set: (v: number) => (gains[index] = v),
          get: () => gains[index],
        })
        return node
      }
      createBufferSource() {
        return { buffer: null, connect: (target: unknown) => target, start: () => started++ }
      }
    }
    vi.stubGlobal('window', {
      addEventListener: vi.fn((_n: string, fn: () => void) => {
        gesture = fn
      }),
      removeEventListener: vi.fn(),
      AudioContext: Ctx,
    })
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
    const s = await import('./sound')
    s.initSound()
    s.setVolume(0.3)
    gesture?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    s.playSound('select')
    expect(started).toBe(1)
    expect(plays).toBe(0)
    expect(gains.at(-1)).toBe(0.3)
  })
})
