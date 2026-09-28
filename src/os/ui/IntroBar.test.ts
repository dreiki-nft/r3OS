import { describe, expect, it } from 'vitest'
import { nextIntroOpen } from './IntroBar'

describe('IntroBar popover state', () => {
  it('opens and closes on a second click', () => {
    expect(nextIntroOpen(false, 'toggle')).toBe(true)
    expect(nextIntroOpen(true, 'toggle')).toBe(false)
  })

  it('closes on Escape and outside click', () => {
    expect(nextIntroOpen(true, 'escape')).toBe(false)
    expect(nextIntroOpen(true, 'outside')).toBe(false)
  })
})
