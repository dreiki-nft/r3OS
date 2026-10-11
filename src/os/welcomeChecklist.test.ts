import { describe, expect, it } from 'vitest'
import { nextWelcomeStep, welcomeSteps } from './welcomeChecklist'

describe('first-visit checklist', () => {
  it('starts at connect and walks forward as the chain facts change', () => {
    expect(nextWelcomeStep(welcomeSteps({ connected: false }))?.id).toBe('connect')
    expect(nextWelcomeStep(welcomeSteps({ connected: true, paintCount: 0n }))?.id).toBe('paint')
    // The Pass only needs a paint, so it comes before saving a frame.
    expect(nextWelcomeStep(welcomeSteps({ connected: true, paintCount: 3n, hasPass: false }))?.id).toBe(
      'pass',
    )
    expect(
      nextWelcomeStep(welcomeSteps({ connected: true, paintCount: 3n, hasPass: true, framesMinted: 0n }))?.id,
    ).toBe('frame')
    expect(
      nextWelcomeStep(welcomeSteps({ connected: true, paintCount: 3n, framesMinted: 1n, hasPass: true })),
    ).toBeUndefined()
  })

  it('never marks chain steps done while disconnected, even with stale facts', () => {
    const steps = welcomeSteps({ connected: false, paintCount: 9n, framesMinted: 2n, hasPass: true })
    expect(steps.filter((step) => step.done)).toEqual([])
  })
})
