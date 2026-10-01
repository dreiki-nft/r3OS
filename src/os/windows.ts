export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export interface WindowState {
  id: string
  rect: Rect
  minSize: Size
  restoreRect?: Rect
  minimized: boolean
  maximized: boolean
  z: number
  alwaysOnTop?: boolean
}

export interface WindowStoreState {
  windows: WindowState[]
  active?: string
  zCounter: number
}

type Listener = () => void

const listeners = new Set<Listener>()
let state: WindowStoreState = { windows: [], zCounter: 1 }
const storageKey = (id: string) => `r3os.window.${id}`

export function clampRect(
  rect: Rect,
  viewportWidth = typeof innerWidth === 'number' ? innerWidth : 1_280,
  viewportHeight = typeof innerHeight === 'number' ? innerHeight : 800,
  minSize: Size = { width: 280, height: 180 },
): Rect {
  const taskbar = 48
  const width = Math.min(Math.max(minSize.width, rect.width), Math.max(minSize.width, viewportWidth))
  const height = Math.min(
    Math.max(minSize.height, rect.height),
    Math.max(minSize.height, viewportHeight - taskbar),
  )
  return {
    x: Math.max(0, Math.min(rect.x, viewportWidth - width)),
    y: Math.max(0, Math.min(rect.y, viewportHeight - taskbar - height)),
    width,
    height,
  }
}

function save(win: WindowState) {
  try {
    localStorage.setItem(storageKey(win.id), JSON.stringify(win.rect))
  } catch {
    // Storage can be blocked.
  }
}

function load(id: string, fallback: Rect, minSize: Size) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(id)) || 'null') as Rect | null
    return stored ? clampRect(stored, undefined, undefined, minSize) : fallback
  } catch {
    return fallback
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeWindows(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getWindows() {
  return state
}

export function nextWindowPosition(
  size: Size,
  minSize: Size,
  viewportWidth = typeof innerWidth === 'number' ? innerWidth : 1_440,
  viewportHeight = typeof innerHeight === 'number' ? innerHeight : 900,
) {
  const iconAreaRight = viewportWidth <= 640 ? 0 : 208
  const baseX = iconAreaRight + 24
  const baseY = 24
  const openCount = state.windows.filter((win) => !win.minimized).length
  const step = (openCount % 10) * 24
  let x = baseX + step
  let y = baseY + step
  if (x + size.width > viewportWidth || y + size.height > viewportHeight - 48) {
    x = baseX
    y = baseY
  }
  return clampRect({ x, y, ...size }, viewportWidth, viewportHeight, minSize)
}

export function bottomRightWindowPosition(
  size: Size,
  minSize: Size,
  viewportWidth = typeof innerWidth === 'number' ? innerWidth : 1_440,
  viewportHeight = typeof innerHeight === 'number' ? innerHeight : 900,
) {
  const gap = 8
  return clampRect(
    {
      x: viewportWidth - size.width - gap,
      y: viewportHeight - 48 - size.height - gap,
      ...size,
    },
    viewportWidth,
    viewportHeight,
    minSize,
  )
}

export function openWindow(
  id: string,
  rect: Rect,
  minSize: Size = { width: 280, height: 180 },
  alwaysOnTop = false,
  restoreStoredPosition = true,
) {
  const existing = state.windows.find((win) => win.id === id)
  if (existing) {
    focusWindow(id)
    return
  }
  const win: WindowState = {
    id,
    rect: restoreStoredPosition
      ? load(id, clampRect(rect, undefined, undefined, minSize), minSize)
      : clampRect(rect, undefined, undefined, minSize),
    minSize,
    minimized: false,
    maximized: false,
    z: state.zCounter + 1,
    alwaysOnTop,
  }
  state = {
    ...state,
    zCounter: state.zCounter + 1,
    windows: [...state.windows, win],
    active: id,
  }
  emit()
}

/** Drop `#/<id>` from the URL when that window closes, without firing hashchange, so the
 *  closed program is not reopened by routing or by a page reload. */
function clearHashFor(id: string) {
  if (typeof window === 'undefined' || typeof location === 'undefined') return
  const current = location.hash.split('/')[1]?.split('?')[0]
  if (current !== id) return
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  } catch {
    // ignore: some embedded contexts forbid history writes
  }
}

export function closeWindow(id: string) {
  clearHashFor(id)
  const remaining = state.windows.filter((win) => win.id !== id)
  state = {
    ...state,
    windows: remaining,
    active: state.active === id ? [...remaining].sort((a, b) => b.z - a.z)[0]?.id : state.active,
  }
  emit()
}

export function focusWindow(id: string) {
  const z = state.zCounter + 1
  state = {
    ...state,
    active: id,
    zCounter: z,
    windows: state.windows.map((win) => (win.id === id ? { ...win, z, minimized: false } : win)),
  }
  emit()
}

export function minimizeWindow(id: string) {
  state = {
    ...state,
    windows: state.windows.map((win) => (win.id === id ? { ...win, minimized: true } : win)),
    active: state.active === id ? undefined : state.active,
  }
  emit()
}

export function maximizeWindow(id: string) {
  state = {
    ...state,
    active: id,
    windows: state.windows.map((win) => {
      if (win.id !== id) return win
      if (win.maximized) {
        return { ...win, maximized: false, rect: win.restoreRect ?? win.rect, restoreRect: undefined }
      }
      return { ...win, maximized: true, restoreRect: win.rect }
    }),
  }
  emit()
}

export function moveWindow(id: string, x: number, y: number) {
  state = {
    ...state,
    windows: state.windows.map((win) =>
      win.id === id && !win.maximized
        ? { ...win, rect: clampRect({ ...win.rect, x, y }, undefined, undefined, win.minSize) }
        : win,
    ),
  }
  const win = state.windows.find((candidate) => candidate.id === id)
  if (win) save(win)
  emit()
}

export function resizeWindow(id: string, width: number, height: number) {
  state = {
    ...state,
    windows: state.windows.map((win) =>
      win.id === id && !win.maximized
        ? {
            ...win,
            rect: clampRect({ ...win.rect, width, height }, undefined, undefined, win.minSize),
          }
        : win,
    ),
  }
  const win = state.windows.find((candidate) => candidate.id === id)
  if (win) save(win)
  emit()
}

export function setAlwaysOnTop(id: string, alwaysOnTop: boolean) {
  state = {
    ...state,
    windows: state.windows.map((win) => (win.id === id ? { ...win, alwaysOnTop } : win)),
  }
  emit()
}

export function windowZIndex(win: WindowState) {
  return (win.alwaysOnTop ? 1_000_000_000 : 0) + win.z
}

export function sortWindowsForDisplay(windows: readonly WindowState[]) {
  return [...windows].sort((a, b) => {
    if (Boolean(a.alwaysOnTop) !== Boolean(b.alwaysOnTop)) return a.alwaysOnTop ? 1 : -1
    return a.z - b.z
  })
}

export function resetWindows() {
  state = { windows: [], zCounter: 1 }
  emit()
}

export function clampAllWindows() {
  state = {
    ...state,
    windows: state.windows.map((win) =>
      win.maximized ? win : { ...win, rect: clampRect(win.rect, undefined, undefined, win.minSize) },
    ),
  }
  for (const win of state.windows) if (!win.maximized) save(win)
  emit()
}

export function shouldStartTitleDrag(targetIsButton: boolean, maximized: boolean, mobile: boolean) {
  return !targetIsButton && !maximized && !mobile
}
