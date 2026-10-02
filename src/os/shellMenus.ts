/**
 * Pure helpers for r3tardOS shell menus: viewport placement, the desktop / icon menu models, desktop
 * target classification and the touch long-press rules. No DOM access here, so all of it is unit-tested.
 */

export interface Size {
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

const MARGIN = 4

/** Context menu at the pointer, moved left/up so the whole menu stays inside the viewport. */
export function clampMenuPosition(
  point: { x: number; y: number },
  menu: Size,
  viewport: Viewport,
  margin = MARGIN,
) {
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin)
  const maxTop = Math.max(margin, viewport.height - menu.height - margin)
  const left =
    point.x + menu.width + margin > viewport.width ? Math.max(margin, point.x - menu.width) : point.x
  const top =
    point.y + menu.height + margin > viewport.height ? Math.max(margin, point.y - menu.height) : point.y
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
    maxHeight: viewport.height - margin * 2,
  }
}

/**
 * Cascading submenu beside its parent row: right if it fits, otherwise left, otherwise (narrow screens)
 * overlaid inside the viewport against the right edge so the parent row stays visible. Aligned to the parent
 * row's top, shifted up when it would cross the bottom edge, height-capped with scrolling when too tall.
 */
export function placeSubmenu(parent: RectLike, menu: Size, viewport: Viewport, margin = MARGIN) {
  const maxHeight = viewport.height - margin * 2
  const height = Math.min(menu.height, maxHeight)
  let side: 'right' | 'left' | 'overlay'
  let left: number
  if (parent.right + menu.width + margin <= viewport.width) {
    side = 'right'
    left = parent.right
  } else if (parent.left - menu.width - margin >= 0) {
    side = 'left'
    left = parent.left - menu.width
  } else {
    side = 'overlay'
    // Narrow screens: hug the right edge so the parent row's icon and label stay visible beside it.
    left = Math.max(margin, viewport.width - menu.width - margin)
  }
  let top = side === 'overlay' ? parent.bottom : parent.top
  if (top + height + margin > viewport.height) top = viewport.height - height - margin
  top = Math.max(margin, top)
  return { left, top, maxHeight, side }
}

// ---------------------------------------------------------------------------
// Menu models
// ---------------------------------------------------------------------------

export type ShellMenuItem =
  | { kind: 'item'; id: string; label: string; action: ShellAction; default?: boolean }
  | { kind: 'separator'; id: string }

export type ShellAction = { type: 'refresh' } | { type: 'open'; program: string; hash?: string }

/**
 * Empty-desktop menu. Every target is a real program id; opening goes through openProgram, so release
 * gating applies. "Properties" opens My Pass, which is r3tardOS's System Properties.
 */
export function desktopMenuItems(): ShellMenuItem[] {
  return [
    { kind: 'item', id: 'refresh', label: 'Refresh', action: { type: 'refresh' } },
    { kind: 'separator', id: 'sep-1' },
    { kind: 'item', id: 'run', label: 'Run…', action: { type: 'open', program: 'run' } },
    { kind: 'item', id: 'monad-hw', label: 'Explore Monad', action: { type: 'open', program: 'monad-hw' } },
    { kind: 'item', id: 'dxdiag', label: 'DXDIAG.EXE', action: { type: 'open', program: 'dxdiag' } },
    { kind: 'separator', id: 'sep-2' },
    { kind: 'item', id: 'properties', label: 'Properties', action: { type: 'open', program: 'pass' } },
  ]
}

/** Desktop icon menu: Open only. There is no filesystem, so no rename/delete/shortcut items. */
export function iconMenuItems(program: string): ShellMenuItem[] {
  return [{ kind: 'item', id: 'open', label: 'Open', action: { type: 'open', program }, default: true }]
}

// ---------------------------------------------------------------------------
// Desktop target classification
// ---------------------------------------------------------------------------

export type DesktopTarget = { kind: 'icon'; index: number } | { kind: 'desktop' } | { kind: 'ignore' }

/**
 * Who owns a contextmenu / long-press. Only the bare desktop surface and desktop icons are claimed;
 * windows, the taskbar, menus, dialogs and anything editable keep their own (or the native) behaviour.
 */
export function classifyDesktopTarget(info: {
  editable: boolean
  insideOwnedUi: boolean
  iconIndex?: number
  onSurface: boolean
}): DesktopTarget {
  if (info.editable || info.insideOwnedUi) return { kind: 'ignore' }
  if (info.iconIndex != null && info.iconIndex >= 0) return { kind: 'icon', index: info.iconIndex }
  return info.onSurface ? { kind: 'desktop' } : { kind: 'ignore' }
}

// ---------------------------------------------------------------------------
// Touch long-press
// ---------------------------------------------------------------------------

export const LONG_PRESS_MS = 500
export const LONG_PRESS_MOVE_PX = 10

export function movedBeyondThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = LONG_PRESS_MOVE_PX,
) {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold
}

// ---------------------------------------------------------------------------
// Start menu cascade state
// ---------------------------------------------------------------------------

export type StartSubmenu = 'programs' | 'tools'

/** Only one cascading submenu is ever open: opening one replaces the other; clicking the open one closes it. */
export function toggleSubmenu(current: StartSubmenu | null, which: StartSubmenu): StartSubmenu | null {
  return current === which ? null : which
}

export type StartMenuKeyAction = 'next' | 'prev' | 'open-submenu' | 'close-submenu' | 'close-start' | null

/** Keyboard model for the cascading Start menu. Enter is left to the focused button's native click. */
export function startMenuKeyAction(input: {
  key: string
  inSubmenu: boolean
  onSubmenuParent: boolean
  submenuOpen: boolean
}): StartMenuKeyAction {
  switch (input.key) {
    case 'ArrowDown':
      return 'next'
    case 'ArrowUp':
      return 'prev'
    case 'ArrowRight':
      return !input.inSubmenu && input.onSubmenuParent ? 'open-submenu' : null
    case 'ArrowLeft':
      return input.inSubmenu ? 'close-submenu' : null
    case 'Escape':
      return input.submenuOpen ? 'close-submenu' : 'close-start'
    default:
      return null
  }
}
