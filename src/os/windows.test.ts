import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bottomRightWindowPosition,
  clampRect,
  closeWindow,
  focusWindow,
  getWindows,
  maximizeWindow,
  minimizeWindow,
  nextWindowPosition,
  openWindow,
  resetWindows,
  setAlwaysOnTop,
  shouldStartTitleDrag,
  sortWindowsForDisplay,
  windowZIndex,
} from './windows'

describe('windows', () => {
  beforeEach(resetWindows)

  it('opens, focuses, minimizes, maximizes and closes', () => {
    openWindow('a', { x: 1, y: 1, width: 400, height: 300 })
    openWindow('b', { x: 5, y: 5, width: 400, height: 300 })
    expect(getWindows().active).toBe('b')
    focusWindow('a')
    expect(getWindows().active).toBe('a')
    minimizeWindow('a')
    expect(getWindows().windows.find((win) => win.id === 'a')?.minimized).toBe(true)
    maximizeWindow('b')
    expect(getWindows().windows.find((win) => win.id === 'b')?.maximized).toBe(true)
    closeWindow('a')
    expect(getWindows().windows.some((win) => win.id === 'a')).toBe(false)
  })

  it('clamps geometry and honours the program minimum size', () => {
    expect(
      clampRect({ x: -20, y: -9, width: 100, height: 100 }, 800, 600, { width: 420, height: 300 }),
    ).toEqual({ x: 0, y: 0, width: 420, height: 300 })
  })

  it('cascades positions and wraps when needed', () => {
    const first = nextWindowPosition({ width: 500, height: 400 }, { width: 300, height: 200 }, 1_440, 900)
    expect(first).toMatchObject({ x: 232, y: 24 })
    openWindow('a', first)
    const second = nextWindowPosition({ width: 500, height: 400 }, { width: 300, height: 200 }, 1_440, 900)
    expect(second).toMatchObject({ x: 256, y: 48 })
    for (let index = 0; index < 9; index++) {
      openWindow(`x${index}`, { x: 10, y: 10, width: 500, height: 400 })
    }
    const wrapped = nextWindowPosition({ width: 1_000, height: 700 }, { width: 300, height: 200 }, 1_200, 800)
    expect(wrapped.x).toBeGreaterThanOrEqual(0)
    expect(wrapped.y).toBeGreaterThanOrEqual(0)
  })

  it('keeps always-on-top windows above focused normal windows', () => {
    openWindow('normal', { x: 0, y: 0, width: 300, height: 200 })
    openWindow('xray', { x: 10, y: 10, width: 300, height: 200 }, undefined, true)
    focusWindow('normal')
    const ordered = sortWindowsForDisplay(getWindows().windows)
    expect(ordered.at(-1)?.id).toBe('xray')
    const normal = getWindows().windows.find((win) => win.id === 'normal')!
    const xray = getWindows().windows.find((win) => win.id === 'xray')!
    expect(windowZIndex(xray)).toBeGreaterThan(windowZIndex(normal))
  })

  it('docks X-ray above the taskbar and lets the pin be turned off', () => {
    vi.stubGlobal('innerWidth', 1_440)
    vi.stubGlobal('innerHeight', 900)
    const rect = bottomRightWindowPosition(
      { width: 380, height: 676 },
      { width: 360, height: 520 },
      1_440,
      900,
    )
    expect(rect).toEqual({ x: 1_052, y: 168, width: 380, height: 676 })
    openWindow('xray', rect, { width: 360, height: 520 }, true, false)
    expect(getWindows().windows.find((win) => win.id === 'xray')?.rect).toEqual(rect)
    setAlwaysOnTop('xray', false)
    expect(getWindows().windows.find((win) => win.id === 'xray')?.alwaysOnTop).toBe(false)
  })

  it('does not start a title drag from a title button', () => {
    expect(shouldStartTitleDrag(true, false, false)).toBe(false)
    expect(shouldStartTitleDrag(false, false, false)).toBe(true)
    expect(shouldStartTitleDrag(false, true, false)).toBe(false)
  })
})
