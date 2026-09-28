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
