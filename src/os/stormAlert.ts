/**
 * The storm bell in the tray: when it's on, r3OS warns 333 blocks (about 100 seconds) before every DF1 storm,
 * with a balloon and a sound in r3OS and, when the tab is in the background, a browser notification.
 *
 * It runs only while r3OS is open in a tab (it reads the same block stream as the tray countdown); there is no
 * server and nothing is sent anywhere. The choice is saved per browser. If the browser can't show
 * notifications, or they are blocked for the site, the bell still works inside r3OS.
 */
import { stormCountdown } from '../chain/blocks'
import { pushBalloon } from './balloons'

/** How many blocks before a storm the bell rings. */
export const STORM_ALERT_BLOCKS = 333n
const KEY = 'r3os.stormAlert'

type Listener = () => void
const listeners = new Set<Listener>()
let enabled = readSaved()
let lastAlerted: bigint | undefined

function readSaved() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function save(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the bell still works until the tab closes.
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function getStormAlert() {
  return enabled
}

export function subscribeStormAlert(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notificationsSupported() {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined'
}

export type StormAlertToggle = 'on' | 'off' | 'in-app'

/**
 * Turns the bell on or off. Turning it on asks for notification permission once; if the browser has none
 * or the person says no, the bell is still on and rings inside r3OS only ('in-app').
 */
export async function toggleStormAlert(): Promise<StormAlertToggle> {
  if (enabled) {
    enabled = false
    save(false)
    emit()
    return 'off'
  }
  enabled = true
  save(true)
  emit()
  if (!notificationsSupported()) return 'in-app'
  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      permission = 'denied'
    }
  }
  return permission === 'granted' ? 'on' : 'in-app'
}

/**
 * Pure: the first block of the storm to ring for at `block`, or undefined. Rings once per storm, from
 * `lead` blocks before it until it starts (so a tab that wakes up late still rings, just later).
 */
export function alertDue(block: bigint, lastStorm: bigint | undefined, lead = STORM_ALERT_BLOCKS) {
  if (block <= 0n) return undefined
  const { nextStormIn } = stormCountdown(block)
  if (nextStormIn === 0n || nextStormIn > lead) return undefined
  const start = block + nextStormIn
  return start === lastStorm ? undefined : start
}

function seconds(blocks: bigint, blockTimeMs: number) {
  return Math.max(1, Math.round((Number(blocks) * blockTimeMs) / 1000))
}

/** Called on every new block (from the tray). Rings at most once per storm. */
export function checkStormAlert(block: bigint, blockTimeMs: number) {
  if (!enabled) return
  const start = alertDue(block, lastAlerted)
  if (start == null) return
  lastAlerted = start
  const left = start - block
  const title = `⚡ DF1 storm in ${left} blocks`
  const body = `about ${seconds(left, blockTimeMs)} seconds. the storm starts at block ${start.toLocaleString('en-US')} and lasts 600 blocks.`
  pushBalloon({
    id: 'storm-alert',
    title,
    body,
    icon: 'lightning',
    sound: 'df1',
    href: '#/paint',
    hrefLabel: 'Open Paint',
  })
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return // the balloon is enough
  try {
    // The tag makes several open r3OS tabs show one notification, not one each.
    const note = new Notification(title, { body, tag: `r3os-storm-${start}`, icon: '/favicon.svg' })
    note.onclick = () => {
      window.focus()
      window.location.hash = '#/paint'
      note.close()
    }
  } catch {
    // Some mobile browsers only allow notifications from a service worker: the balloon still shows.
  }
}

/** Test hook. */
export function resetStormAlertForTests(on = false) {
  enabled = on
  lastAlerted = undefined
}
