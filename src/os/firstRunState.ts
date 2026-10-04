/**
 * The one-time welcome shown to a new browser: three plain choices, no wallet needed, no tutorial. Pure state
 * so the "once per browser" rules are unit-tested; the dialog lives in FirstRun.tsx.
 */

export const FIRST_RUN_KEY = 'r3os.firstRun.done'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type FirstRunChoice = 'paint' | 'monad-hw' | 'help'

export const FIRST_RUN_CHOICES: readonly { id: FirstRunChoice; label: string; hint: string }[] = [
  { id: 'paint', label: 'Paint together', hint: 'watch the live canvas; no wallet needed' },
  { id: 'monad-hw', label: 'See Monad live', hint: 'blocks, storage pages, onchain hardware' },
  { id: 'help', label: '60-second tour', hint: 'what to click and why Monad matters' },
]

/** Show on a clean first visit to the bare desktop; a shared deep link (#/paint, #/frames?…) goes straight in. */
export function shouldShowFirstRun(storage: StorageLike | undefined, hash: string) {
  let done = false
  try {
    done = storage?.getItem(FIRST_RUN_KEY) === '1'
  } catch {
    done = false
  }
  if (done) return false
  return hash === '' || hash === '#' || hash === '#/'
}

export function rememberFirstRun(storage: StorageLike | undefined, dontShowAgain: boolean) {
  if (!dontShowAgain) return
  try {
    storage?.setItem(FIRST_RUN_KEY, '1')
  } catch {
    // Storage blocked: it may show again next visit, which is harmless.
  }
}

// While the welcome is open, the getting-started checklist and the assistant stay quiet.
type Listener = () => void
const listeners = new Set<Listener>()
let open = false

export const isFirstRunOpen = () => open
export function setFirstRunOpen(next: boolean) {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}
export function subscribeFirstRun(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
