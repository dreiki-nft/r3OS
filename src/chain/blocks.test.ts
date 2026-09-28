import { describe, expect, it } from 'vitest'
import { emaBlockTime, isStormAt, stormCountdown } from './blocks'
describe('storms', () => {
  it('detects boundaries', () => {
    expect(isStormAt(0n)).toBe(true)
    expect(isStormAt(599n)).toBe(true)
    expect(isStormAt(600n)).toBe(false)
    expect(isStormAt(200000n)).toBe(true)
  })
  it('counts down', () => {
    expect(stormCountdown(599n).stormEndsIn).toBe(1n)
    expect(stormCountdown(600n).nextStormIn).toBe(199400n)
  })
  it('smooths block time with an EMA', () => {
    expect(emaBlockTime(300, 800, 2)).toBe(320)
  })
})
