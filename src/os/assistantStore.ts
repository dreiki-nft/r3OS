type Listener = () => void

let tip: string | undefined
let expiry: number | undefined
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

export function setAssistantTip(next?: string, durationMs = 12_000) {
  if (expiry) window.clearTimeout(expiry)
  expiry = undefined
  tip = next
  emit()
  if (next && typeof window !== 'undefined' && durationMs > 0) {
    expiry = window.setTimeout(() => {
      tip = undefined
      expiry = undefined
      emit()
    }, durationMs)
  }
}

export function clearAssistantTip(match?: string) {
  if (match && tip !== match) return
  setAssistantTip(undefined)
}

export function getAssistantTip() {
  return tip
}

export function subscribeAssistant(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const ASSISTANT_AUTO_HIDE_MS = 8_000

export function assistantAutoHidden(spokenAtMs: number, nowMs: number, delayMs = ASSISTANT_AUTO_HIDE_MS) {
  return nowMs - spokenAtMs >= delayMs
}

export function assistantOverlapsWindows(
  windows: readonly {
    rect: { x: number; y: number; width: number; height: number }
    minimized: boolean
    maximized: boolean
  }[],
  viewportWidth: number,
  viewportHeight: number,
) {
  const assistant = {
    x: Math.max(0, viewportWidth - 430),
    y: Math.max(0, viewportHeight - 230),
    width: 420,
    height: 170,
  }
  return windows.some((win) => {
    if (win.minimized) return false
    if (win.maximized) return true
    return !(
      win.rect.x + win.rect.width <= assistant.x ||
      assistant.x + assistant.width <= win.rect.x ||
      win.rect.y + win.rect.height <= assistant.y ||
      assistant.y + assistant.height <= win.rect.y
    )
  })
}
