import { describe, expect, it } from 'vitest'
import {
  LONG_PRESS_MS,
  LONG_PRESS_MOVE_PX,
  classifyDesktopTarget,
  clampMenuPosition,
  desktopMenuItems,
  iconMenuItems,
  movedBeyondThreshold,
  placeSubmenu,
  startMenuKeyAction,
  toggleSubmenu,
} from './contextMenu'
import { programById } from './programs'

const viewport = { width: 1400, height: 900 }
const menu = { width: 180, height: 160 }

describe('context menu placement', () => {
  it('opens at the pointer when it fits', () => {
    expect(clampMenuPosition({ x: 100, y: 120 }, menu, viewport)).toMatchObject({ left: 100, top: 120 })
  })

  it('moves left / up near the right and bottom edges and never leaves the viewport', () => {
    expect(clampMenuPosition({ x: 1350, y: 120 }, menu, viewport).left).toBe(1350 - 180)
    expect(clampMenuPosition({ x: 100, y: 880 }, menu, viewport).top).toBe(880 - 160)
    const corner = clampMenuPosition({ x: 1399, y: 899 }, menu, viewport)
    expect(corner.left + menu.width).toBeLessThanOrEqual(viewport.width)
    expect(corner.top + menu.height).toBeLessThanOrEqual(viewport.height)
    const tiny = clampMenuPosition({ x: 50, y: 50 }, { width: 500, height: 500 }, { width: 320, height: 400 })
    expect(tiny.left).toBeGreaterThanOrEqual(0)
    expect(tiny.top).toBeGreaterThanOrEqual(0)
    expect(tiny.maxHeight).toBe(392)
  })
})

describe('Start submenu cascade placement', () => {
  const row = { left: 33, right: 253, top: 500, bottom: 540 }

  it('opens to the right, aligned with its parent row', () => {
    expect(placeSubmenu(row, { width: 230, height: 200 }, viewport)).toMatchObject({
      side: 'right',
      left: 253,
      top: 500,
    })
  })

  it('shifts up near the bottom edge and caps height with scrolling', () => {
    const placed = placeSubmenu(row, { width: 230, height: 600 }, viewport)
    expect(placed.top + 600).toBeLessThanOrEqual(viewport.height)
    const tall = placeSubmenu(row, { width: 230, height: 2000 }, viewport)
    expect(tall.top).toBe(4)
    expect(tall.maxHeight).toBe(892)
  })

  it('opens left when the right edge is too close', () => {
    const nearRight = { left: 1200, right: 1390, top: 100, bottom: 140 }
    expect(placeSubmenu(nearRight, { width: 230, height: 200 }, viewport)).toMatchObject({
      side: 'left',
      left: 970,
    })
  })

  it('overlays inside a narrow (mobile) viewport instead of rendering offscreen', () => {
    const phone = { width: 390, height: 844 }
    const fullWidthRow = { left: 33, right: 386, top: 400, bottom: 442 }
    const placed = placeSubmenu(fullWidthRow, { width: 260, height: 300 }, phone)
    expect(placed.side).toBe('overlay')
    expect(placed.left).toBeGreaterThanOrEqual(4)
    expect(placed.left + 260).toBeLessThanOrEqual(phone.width)
    expect(placed.top).toBe(442)
  })
})

describe('desktop / icon menu models', () => {
  it('desktop menu targets only real programs', () => {
    const items = desktopMenuItems()
    expect(
      items.filter((item) => item.kind === 'item').map((item) => item.kind === 'item' && item.label),
    ).toEqual(['Refresh', 'Run…', 'Monad Hardware', 'DXDIAG.EXE', 'Properties'])
    for (const item of items) {
      if (item.kind === 'item' && item.action.type === 'open')
        expect(programById(item.action.program), item.label).toBeTruthy()
    }
  })

  it('icon menu is Open only, routed to that program', () => {
    expect(iconMenuItems('forks')).toEqual([
      { kind: 'item', id: 'open', label: 'Open', action: { type: 'open', program: 'forks' }, default: true },
    ])
  })

  it('claims only the desktop surface and icons', () => {
    expect(
      classifyDesktopTarget({ editable: false, insideOwnedUi: false, iconIndex: 3, onSurface: false }),
    ).toEqual({
      kind: 'icon',
      index: 3,
    })
    expect(classifyDesktopTarget({ editable: false, insideOwnedUi: false, onSurface: true })).toEqual({
      kind: 'desktop',
    })
    expect(classifyDesktopTarget({ editable: true, insideOwnedUi: false, onSurface: true }).kind).toBe(
      'ignore',
    )
    expect(classifyDesktopTarget({ editable: false, insideOwnedUi: true, onSurface: false }).kind).toBe(
      'ignore',
    )
    expect(classifyDesktopTarget({ editable: false, insideOwnedUi: false, onSurface: false }).kind).toBe(
      'ignore',
    )
  })
})

describe('long press', () => {
  it('uses a ~500 ms hold and cancels past a ~10 px move', () => {
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(450)
    expect(LONG_PRESS_MS).toBeLessThanOrEqual(600)
    expect(LONG_PRESS_MOVE_PX).toBeGreaterThanOrEqual(8)
    expect(LONG_PRESS_MOVE_PX).toBeLessThanOrEqual(12)
    expect(movedBeyondThreshold({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(false)
    expect(movedBeyondThreshold({ x: 0, y: 0 }, { x: 9, y: 9 })).toBe(true)
  })
})

describe('Start menu cascade state and keys', () => {
  it('only one submenu is open at a time', () => {
    expect(toggleSubmenu(null, 'programs')).toBe('programs')
    expect(toggleSubmenu('programs', 'hardware')).toBe('hardware')
    expect(toggleSubmenu('hardware', 'programs')).toBe('programs')
    expect(toggleSubmenu('programs', 'programs')).toBeNull()
  })

  it('maps keys like a cascading Win98 menu', () => {
    const base = { inSubmenu: false, onSubmenuParent: false, submenuOpen: false }
    expect(startMenuKeyAction({ ...base, key: 'ArrowDown' })).toBe('next')
    expect(startMenuKeyAction({ ...base, key: 'ArrowUp' })).toBe('prev')
    expect(startMenuKeyAction({ ...base, key: 'ArrowRight', onSubmenuParent: true })).toBe('open-submenu')
    expect(startMenuKeyAction({ ...base, key: 'ArrowRight' })).toBeNull()
    expect(startMenuKeyAction({ ...base, key: 'ArrowLeft', inSubmenu: true, submenuOpen: true })).toBe(
      'close-submenu',
    )
    expect(startMenuKeyAction({ ...base, key: 'ArrowLeft' })).toBeNull()
    expect(startMenuKeyAction({ ...base, key: 'Escape', submenuOpen: true })).toBe('close-submenu')
    expect(startMenuKeyAction({ ...base, key: 'Escape' })).toBe('close-start')
    expect(startMenuKeyAction({ ...base, key: 'Enter' })).toBeNull()
  })
})
