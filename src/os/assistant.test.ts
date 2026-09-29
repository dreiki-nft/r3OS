import { describe, expect, it } from 'vitest'
import { ASSISTANT_AUTO_HIDE_MS, assistantAutoHidden, assistantOverlapsWindows } from './assistantStore'

describe('assistant auto-hide', () => {
  it('stays visible before eight seconds and hides at eight seconds', () => {
    expect(assistantAutoHidden(1_000, 1_000 + ASSISTANT_AUTO_HIDE_MS - 1)).toBe(false)
    expect(assistantAutoHidden(1_000, 1_000 + ASSISTANT_AUTO_HIDE_MS)).toBe(true)
  })

  it('detects windows overlapping the assistant corner', () => {
    expect(
      assistantOverlapsWindows(
        [{ rect: { x: 900, y: 650, width: 400, height: 180 }, minimized: false, maximized: false }],
        1280,
        800,
      ),
    ).toBe(true)
    expect(
      assistantOverlapsWindows(
        [{ rect: { x: 10, y: 10, width: 300, height: 200 }, minimized: false, maximized: false }],
        1280,
        800,
      ),
    ).toBe(false)
  })
})
