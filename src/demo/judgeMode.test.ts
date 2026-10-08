import { describe, expect, it } from 'vitest'
import { JUDGE_STEPS, judgeStepProgram, moveJudgeStep } from './judgeSteps'

// The judge route has no transaction operations and only opens existing, safe program windows.
describe('judge route', () => {
  it('leads with people painting together, then the chain proof, then the idea', () => {
    expect(JUDGE_STEPS.map((s) => s.title)).toEqual([
      'One canvas, everyone',
      "Who's here",
      'Paint together',
      'Keep a piece of it',
      'Live on Monad',
      'Made by a community',
      'The idea underneath',
    ])
  })

  it('only opens Paint, CD-ROM, X-ray and Season Replay and never an admin contract surface', () => {
    expect(JUDGE_STEPS.map((_, i) => judgeStepProgram(i))).toEqual([
      undefined,
      'paint',
      'paint',
      'cdrom',
      'xray',
      'replay',
      undefined,
    ])
    expect(judgeStepProgram(-1)).toBeUndefined()
    expect(judgeStepProgram(100)).toBeUndefined()
  })

  it('clamps forwards and backwards instead of running past the guide', () => {
    expect(moveJudgeStep(0, -1)).toBe(0)
    expect(moveJudgeStep(0, 1)).toBe(1)
    expect(moveJudgeStep(5, 1)).toBe(6)
    expect(moveJudgeStep(6, 1)).toBe(6)
  })
})
