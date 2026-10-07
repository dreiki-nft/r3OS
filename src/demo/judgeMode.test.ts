import { describe, expect, it } from 'vitest'
import { JUDGE_STEPS, judgeStepProgram, moveJudgeStep } from './judgeSteps'

// The judge route has no transaction operations and only opens existing, safe program windows.
describe('Phase 9E judge route', () => {
  it('follows the three distinct evidence layers in the intended sequence', () => {
    expect(JUDGE_STEPS.map((s) => s.title)).toEqual([
      'World computer',
      'Local response',
      'Remote observation',
      'Protocol / settlement',
      'MIP-8 / PAGE.EXE',
      'The thesis',
    ])
  })

  it('only opens Paint, X-Ray and Explore Monad and never an admin contract surface', () => {
    expect(JUDGE_STEPS.map((_, i) => judgeStepProgram(i))).toEqual([
      undefined, 'paint', undefined, 'xray', 'monad-hw', undefined,
    ])
    expect(judgeStepProgram(-1)).toBeUndefined()
    expect(judgeStepProgram(100)).toBeUndefined()
  })

  it('clamps forwards and backwards instead of running past the guide', () => {
    expect(moveJudgeStep(0, -1)).toBe(0)
    expect(moveJudgeStep(0, 1)).toBe(1)
    expect(moveJudgeStep(4, 1)).toBe(5)
    expect(moveJudgeStep(5, 1)).toBe(5)
  })
})
