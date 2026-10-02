/**
 * Power-on sequence, like a 1998 PC: a BIOS screen that checks the real chain, then the r3tardOS splash, then
 * the desktop. Pure rules and text live here (unit-tested); BootScreen.tsx draws them.
 */

export const BOOT_SESSION_KEY = 'r3os.booted'

/** BIOS lines appear one by one, then the splash, then the desktop fades in. About 3 s plus any wait for the chain (capped at 2.7 s); any key or click skips. */
export const BOOT_TIMING = { postLineMs: 120, postHoldMs: 350, splashMs: 1_300, fadeMs: 300 } as const

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

/** Boot once per browser tab session: a reload in the same tab goes straight to the desktop. */
export function shouldBoot(session: SessionLike | undefined) {
  try {
    return session?.getItem(BOOT_SESSION_KEY) !== '1'
  } catch {
    return true
  }
}

export function rememberBoot(session: SessionLike | undefined) {
  try {
    session?.setItem(BOOT_SESSION_KEY, '1')
  } catch {
    // Storage blocked: it just boots again on reload.
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
    'Press DEL to enter SETUP · any key to skip',
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
