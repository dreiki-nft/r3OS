import { describe, expect, it } from 'vitest'
import { builtInStamps, labStampInfo } from './stamps'

const base = {
  firstPaintBlock: 1n,
  framesMinted: 0n,
  sessionPaints: 4n,
  stormPaints: 0n,
  activeDays: 3n,
  holder: false,
}

describe('stamps explain how to earn them', () => {
  it('shows progress for counted stamps and the storm note', () => {
    const rows = builtInStamps({ ...base, stormNote: 'next storm in about 2 h 5 m.' })
    const by = (name: string) => rows.find((row) => row.name === name)!
    expect(by('LIVE PAINTER').progress).toBe('4 of 10 Live Mode paints')
    expect(by('REGULAR').progress).toBe('3 of 7 days')
    expect(by('STORM CHASER').progress).toBe('next storm in about 2 h 5 m.')
    expect(by('FIRST PAINT').earned).toBe(true)
  })

  it('never shows progress above the goal', () => {
    const rows = builtInStamps({ ...base, activeDays: 12n })
    expect(rows.find((row) => row.name === 'REGULAR')!.progress).toBe('7 of 7 days')
  })

  it('gives every Lab stamp a real rule instead of a placeholder', () => {
    expect(labStampInfo('RECYCLER').rule).toContain('recycle 100 frames')
    expect(labStampInfo('QUESTS 3')).toMatchObject({ program: 'quests', lab: 'Quests' })
    expect(labStampInfo('MONAD CARD').rule).toContain('Monad Card')
    expect(labStampInfo('SOMETHING NEW').rule).not.toContain('Lab-specific')
  })
})
