/**
 * Power-on sequence, like a 1998 PC: a BIOS screen that checks the real chain, then the r3tardOS splash, then
 * the desktop. Pure rules and text live here (unit-tested); BootScreen.tsx draws them.
 */

export const BOOT_SESSION_KEY = 'r3os.booted'
export const BOOT_LAST_FULL_KEY = 'r3os.boot.lastFull'
export type BootMode = 'none' | 'full' | 'splash'

/** BIOS lines appear one by one, then the splash. Useful startup work may hold the splash briefly, but total boot is hard-capped below ten seconds; input may skip cosmetic POST work, never unfinished critical prefetch. */
export const BOOT_TIMING = {
  postLineMs: 120,
  postHoldMs: 350,
  splashMs: 1_300,
  returningSplashMs: 1_000,
  fadeMs: 300,
  maxTotalMs: 9_500,
} as const

/**
 * Like a real BIOS detecting drives, the screen pauses on a line until its value is real: after "Latest block"
 * until the first block arrives, after "Block clock" until it has been measured, each capped so boot never hangs.
 * Keys are the number of lines already printed.
 */
export const POST_WAITS: Readonly<Record<number, { until: 'block' | 'clock'; maxMs: number }>> = {
  6: { until: 'block', maxMs: 1_500 },
  7: { until: 'clock', maxMs: 1_200 },
}

export interface SessionLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function calendarDay(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Full POST once per day; every other page load still gets the short splash so prefetch can gate the desktop. */
export function bootMode(
  session: SessionLike | undefined,
  local: SessionLike | undefined,
  _firstRunDone: boolean,
  today = calendarDay(),
): BootMode {
  try {
    // A reload in the same tab skips the cosmetic POST, not the useful warm-up. Phase 5B's invariant is
    // "desktop appears = hot", so every fresh page load keeps at least the short splash in front of prefetch.
    if (session?.getItem(BOOT_SESSION_KEY) === '1') return 'splash'
  } catch {
    // With blocked session storage we conservatively show a boot.
  }
  try {
    if (local?.getItem(BOOT_LAST_FULL_KEY) === today) return 'splash'
  } catch {
    return 'full'
  }
  return 'full'
}

/** Legacy helper for the tab's full-POST marker. bootMode may still choose the short prefetch splash. */
export function shouldBoot(session: SessionLike | undefined) {
  try {
    return session?.getItem(BOOT_SESSION_KEY) !== '1'
  } catch {
    return true
  }
}

export function rememberBoot(
  session: SessionLike | undefined,
  local?: SessionLike,
  mode: BootMode = 'full',
  today = calendarDay(),
) {
  try {
    session?.setItem(BOOT_SESSION_KEY, '1')
  } catch {
    // Storage blocked: it just boots again on reload.
  }
  if (mode !== 'full') return
  try {
    local?.setItem(BOOT_LAST_FULL_KEY, today)
  } catch {
    // The next new tab may show the full boot again.
  }
}

export interface PostFacts {
  chainName: string
  chainId: number
  /** latest block the app has seen; 0 while still connecting */
  block: bigint
  /** measured ms per block, or undefined until two blocks have arrived */
  blockMs?: number
  offline: boolean
  demo: boolean
}

function dots(label: string, width = 17) {
  return `${label} ${'.'.repeat(Math.max(2, width - label.length))}`
}

/**
 * What the BIOS screen prints. Everything after the memory test is real: the configured chain, the newest
 * block this browser has seen, and the block time it measured. Nothing is invented while still connecting.
 */
export function postLines(facts: PostFacts): string[] {
  const block = facts.demo
    ? 'demo mode (no chain)'
    : facts.offline
      ? 'no signal'
      : facts.block > 0n
        ? `#${facts.block.toLocaleString('en-US')}`
        : 'searching…'
  const clock =
    facts.demo || facts.offline
      ? '—'
      : facts.blockMs != null && Number.isFinite(facts.blockMs)
        ? `${(facts.blockMs / 1_000).toFixed(2)} s per block`
        : 'measuring…'
  return [
    'r3tardOS BIOS v4.98  (C) 1998-2026 r3tards',
    '',
    `${dots('Processor')} parallel EVM · MonadBFT`,
    `${dots('Memory test')} 8192K OK`,
    `${dots('Detecting chain')} ${facts.demo ? 'none' : `${facts.chainName} (${facts.chainId})`}`,
    `${dots('Latest block')} ${block}`,
    `${dots('Block clock')} ${clock}`,
    `${dots('Canvas')} 256 x 256 · 16 colours`,
    '',
    'Press DEL to enter SETUP · any key to skip POST',
  ]
}

// While the boot screen is up, the welcome dialog and the assistant wait (and ignore keys).
type Listener = () => void
const listeners = new Set<Listener>()
let booting = false

export const isBooting = () => booting
export function setBooting(next: boolean) {
  if (booting === next) return
  booting = next
  for (const listener of listeners) listener()
}
export function subscribeBooting(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
