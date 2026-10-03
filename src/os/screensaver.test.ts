import { describe, expect, it } from 'vitest'
import { canStartScreensaver, hasRecentPendingTx } from './screensaver'

const ready = {
  setting: 'canvas' as const,
  narrowOrTouch: false,
  modalOpen: false,
  confirmOpen: false,
  transactionPending: false,
  blockPlayerPlaying: false,
  booting: false,
  firstRunOpen: false,
}

describe('screensaver idle rules', () => {
  it('starts only when every blocker is clear', () => {
    expect(canStartScreensaver(ready)).toBe(true)
    for (const key of [
      'narrowOrTouch',
      'modalOpen',
      'confirmOpen',
      'transactionPending',
      'blockPlayerPlaying',
      'booting',
      'firstRunOpen',
    ] as const) {
      expect(canStartScreensaver({ ...ready, [key]: true })).toBe(false)
    }
    expect(canStartScreensaver({ ...ready, setting: 'none' })).toBe(false)
  })

  it('does not let an abandoned trace block the screen forever', () => {
    expect(hasRecentPendingTx([{ t: { sent: 100 } }], 1_000)).toBe(true)
    expect(hasRecentPendingTx([{ t: { sent: 100 } }], 130_001)).toBe(false)
    expect(hasRecentPendingTx([{ t: { sent: 100 }, gasUsed: 1n }], 1_000)).toBe(false)
  })
})
