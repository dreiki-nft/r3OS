import { describe, expect, it } from 'vitest'
import { binEligibleFrames, cdEligibleFrames, recyclePath } from './recycle'

describe('recycle path choice', () => {
  it('uses the no-approval safe-transfer path for one frame', () => {
    expect(recyclePath(1, false)).toBe('safeTransfer')
  })

  it('approves once before recycling several frames', () => {
    expect(recyclePath(3, false)).toBe('approveThenRecycle')
  })

  it('recycles directly when operator approval already exists', () => {
    expect(recyclePath(3, true)).toBe('recycle')
  })
})

describe('picker filters', () => {
  const frames = [
    { id: 0, finale: false },
    { id: 1, finale: false },
    { id: 2, finale: true },
  ]

  it('excludes token zero and finales from the Bin', () => {
    expect(binEligibleFrames(frames).map((frame) => frame.id)).toEqual([1])
  })

  it('excludes token zero but keeps finales for CDs', () => {
    expect(cdEligibleFrames(frames).map((frame) => frame.id)).toEqual([1, 2])
  })
})
