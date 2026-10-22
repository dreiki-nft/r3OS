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

/**
 * What turning the bell on ended up as. 'on': system notifications allowed. The rest still ring inside r3OS:
 * 'dismissed' the person closed or ignored the browser's question (it can be asked again), 'blocked' the site is
 * blocked in the browser (only the person can change that, in the site settings), 'unsupported' the browser has
 * no notifications for web pages (iPhone Safari unless r3OS is opened from the Home Screen).
 */
export type StormAlertToggle = 'on' | 'off' | 'dismissed' | 'blocked' | 'unsupported'
export type NotificationAnswer = Exclude<StormAlertToggle, 'off'>

/**
 * Asks the browser for notification permission. Must run straight from a click: browsers only show the question
 * then. It can't change a block; nothing a page does can.
 */
export async function askForNotifications(): Promise<NotificationAnswer> {
  if (!notificationsSupported()) return 'unsupported'
  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      permission = 'denied'
    }
  }
  return permission === 'granted' ? 'on' : permission === 'denied' ? 'blocked' : 'dismissed'
}

/** Turns the bell on or off. Turning it on asks for notifications; whatever the answer, the bell is on. */
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
  return askForNotifications()
}

function onAppleMobile() {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
}

/** The balloon after a bell click: what happened, and for 'dismissed' a button that asks again. */
export function bellBalloon(result: StormAlertToggle): Parameters<typeof pushBalloon>[0] {
  const base = { id: 'storm-bell', icon: 'lightning' as const, sound: false as const }
  if (result === 'off') return { ...base, title: 'Storm bell off', body: 'no more storm pings.' }
  if (result === 'on')
    return {
      ...base,
      title: 'Storm bell on',
      body: 'r3OS will ping you 333 blocks (about 100 seconds) before every DF1 storm, even with this tab in the background. keep r3OS open in a tab.',
    }
  const here = 'until then it rings here in r3OS, 333 blocks before every DF1 storm, while r3OS is open.'
  if (result === 'dismissed')
    return {
      ...base,
      title: 'Storm bell on · allow notifications?',
      body: `your browser didn't get a yes for notifications (in Chrome the question can hide as a small bell at the right end of the address bar). ${here}`,
      sticky: true,
      actions: [
        {
          label: 'Allow notifications',
          run: () => void askForNotifications().then((answer) => pushBalloon(bellBalloon(answer))),
        },
      ],
    }
  if (result === 'blocked')
    return {
      ...base,
      title: 'Storm bell on · notifications blocked',
      body: `notifications are blocked for this site in your browser, and only you can change that: click the icon left of the address bar › Notifications › Allow. the bell picks it up by itself. ${here}`,
      sticky: true,
    }
  return {
    ...base,
    title: 'Storm bell on',
    body: onAppleMobile()
      ? `this browser can't show notifications from websites. on iPhone or iPad, add r3OS to your Home Screen (Share › Add to Home Screen) and open it from there. ${here}`
      : `this browser can't show notifications from websites. ${here}`,
  }
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
