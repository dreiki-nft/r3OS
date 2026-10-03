export type ScreensaverSetting = 'canvas' | 'none'
const KEY = 'r3os.screensaver'
type Listener = () => void
const listeners = new Set<Listener>()
let setting: ScreensaverSetting = 'canvas'

try {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
  if (stored === 'none' || stored === 'canvas') setting = stored
} catch {
  // Default stays on when local storage is unavailable.
}

export function getScreensaverSetting() {
  return setting
}

export function subscribeScreensaverSetting(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setScreensaverSetting(next: ScreensaverSetting) {
  setting = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Local preference only.
  }
  for (const listener of listeners) listener()
}

export interface ScreensaverGate {
  setting: ScreensaverSetting
  narrowOrTouch: boolean
  modalOpen: boolean
  confirmOpen: boolean
  transactionPending: boolean
  blockPlayerPlaying: boolean
  booting: boolean
  firstRunOpen: boolean
}

export function canStartScreensaver(input: ScreensaverGate) {
  return (
    input.setting === 'canvas' &&
    !input.narrowOrTouch &&
    !input.modalOpen &&
    !input.confirmOpen &&
    !input.transactionPending &&
    !input.blockPlayerPlaying &&
    !input.booting &&
    !input.firstRunOpen
  )
}

export function hasRecentPendingTx(
  traces: readonly { gasUsed?: bigint; t: { sent: number } }[],
  now: number,
  maxAgeMs = 120_000,
) {
  return traces.some((trace) => trace.gasUsed == null && now - trace.t.sent >= 0 && now - trace.t.sent < maxAgeMs)
}

export function requestScreensaverPreview() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('r3os:preview-screensaver'))
}
