/**
 * "You've Got Paint": when other wallets paint while you're elsewhere in the OS, one quiet balloon says so,
 * and "Open Paint" outlines exactly where. Rules (pure, unit-tested):
 * - never during boot, while the welcome box is open, or in the first 30 s after boot;
 * - only other wallets (Live mode paints report their owner, so your own burner never counts);
 * - not while Paint is the focused window (Paint outlines live strokes itself);
 * - strokes are collected for 10 s and reported as one balloon; at most one every 2 min (5 min on phones).
 */
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { focusPaint, pingBoxes, strokeFromActivity, type Box, type Stroke } from '../paint/presence'
import { subscribeCanvasActivity } from '../paint/canvasStore'
import { pushBalloon, dismissBalloon } from './balloons'
import { isBooting, subscribeBooting } from './bootState'
import { isFirstRunOpen } from './firstRunState'
import { openProgram } from './programs'
import { getWindows, subscribeWindows } from './windows'
import { painterName } from '../chain/names'

export const BALLOON_ID = 'youve-got-paint'
export const QUIET_AFTER_BOOT_MS = 30_000
export const COALESCE_MS = 10_000
export const MIN_GAP_MS = 120_000
export const MIN_GAP_NARROW_MS = 300_000
/** a stroke this close (px) to one of yours counts as "next to your art" */
export const NEAR_PX = 16

export function isSuppressed(facts: {
  booting: boolean
  firstRun: boolean
  bootEndedAt?: number
  now: number
}) {
  if (facts.booting || facts.firstRun) return true
  return facts.bootEndedAt != null && facts.now - facts.bootEndedAt < QUIET_AFTER_BOOT_MS
}

export function paintFocused(state: {
  active?: string
  windows: readonly { id: string; minimized: boolean }[]
}) {
  if (state.active !== 'paint') return false
  return state.windows.some((win) => win.id === 'paint' && !win.minimized)
}

export function canEmit(lastEmitAt: number | undefined, now: number, narrow: boolean) {
  if (lastEmitAt == null) return true
  return now - lastEmitAt >= (narrow ? MIN_GAP_NARROW_MS : MIN_GAP_MS)
}

export function boxesNear(a: Box, b: Box, margin = NEAR_PX) {
  return a.x0 <= b.x1 + margin && b.x0 <= a.x1 + margin && a.y0 <= b.y1 + margin && b.y0 <= a.y1 + margin
}

export function shortAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** The balloon text for a batch of other people's strokes. */
export function youveGotPaintBody(strokes: readonly Stroke[], mine: readonly Box[]) {
  const painters = [...new Set(strokes.map((stroke) => stroke.owner))]
  const pixels = strokes.reduce((sum, stroke) => sum + stroke.pixels, 0)
  const near = strokes.some((stroke) => mine.some((box) => boxesNear(stroke.box, box)))
  const who = painters.length === 1 ? painterName(painters[0]) : `${painters.length} painters`
  const where = near ? ' right next to your art' : ''
  return `${who} just painted ${pixels.toLocaleString('en-US')} px${where}.`
}

/** The smallest box around every stroke, for scrolling Paint to the action. */
export function unionBox(boxes: readonly Box[]): Box | undefined {
  if (!boxes.length) return undefined
  return boxes.reduce((all, box) => ({
    x0: Math.min(all.x0, box.x0),
    y0: Math.min(all.y0, box.y0),
    x1: Math.max(all.x1, box.x1),
    y1: Math.max(all.y1, box.y1),
  }))
}

// ---- store ----

type Listener = () => void
const listeners = new Set<Listener>()
let unread: Stroke[] = []
let pending: Stroke[] = []
let mine: Box[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined
let lastEmitAt: number | undefined
let bootEndedAt: number | undefined
let started = false

/** One-off OS moments the assistant reacts to (ActivityHost): your paint landed, or others painted. */
export type ActivityMoment =
  | { id: number; kind: 'myPaintConfirmed'; blockNumber: bigint }
  | { id: number; kind: 'othersPainted'; painters: number }
let moment: ActivityMoment | undefined
let nextMomentId = 1
const momentListeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

type MomentInput =
  { kind: 'myPaintConfirmed'; blockNumber: bigint } | { kind: 'othersPainted'; painters: number }

function emitMoment(next: MomentInput) {
  moment = { ...next, id: nextMomentId++ }
  for (const listener of momentListeners) listener()
}

export function getActivityMoment() {
  return moment
}

export function subscribeActivityMoment(listener: Listener) {
  momentListeners.add(listener)
  return () => {
    momentListeners.delete(listener)
  }
}

export function getUnreadPaint() {
  return unread
}

export function subscribeUnreadPaint(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function narrowScreen() {
  try {
    return window.matchMedia('(max-width: 640px)').matches
  } catch {
    return false
  }
}

/** Open Paint, outline every unread stroke for a few seconds and scroll to them. */
export function showUnreadPaint() {
  const strokes = unread
  unread = []
  dismissBalloon(BALLOON_ID)
  emit()
  openProgram('paint')
  const boxes = strokes.slice(0, 24).map((stroke) => stroke.box)
  const focus = unionBox(boxes)
  // Let the window mount before outlining.
  setTimeout(() => {
    if (focus) focusPaint(focus, false)
    pingBoxes(boxes)
  }, 150)
}

function flush() {
  flushTimer = undefined
  const batch = pending
  pending = []
  if (!batch.length) return
  const now = Date.now()
  if (isSuppressed({ booting: isBooting(), firstRun: isFirstRunOpen(), bootEndedAt, now })) return
  if (paintFocused(getWindows())) return
  unread = [...batch, ...unread].slice(0, 50)
  emit()
  if (!canEmit(lastEmitAt, now, narrowScreen())) return
  lastEmitAt = now
  pushBalloon({
    id: BALLOON_ID,
    icon: 'mail',
    title: "YOU'VE GOT PAINT",
    body: youveGotPaintBody(batch, mine),
    sound: false,
    actions: [{ label: 'Open Paint', run: showUnreadPaint }],
  })
  emitMoment({ kind: 'othersPainted', painters: new Set(batch.map((stroke) => stroke.owner)).size })
}

export function initActivity() {
  if (started) return
  started = true
  let wasBooting = isBooting()
  subscribeBooting(() => {
    const booting = isBooting()
    if (wasBooting && !booting) bootEndedAt = Date.now()
    wasBooting = booting
  })
  let account = getWalletSnapshot().account
  subscribeWallet(() => {
    const next = getWalletSnapshot().account
    if (next !== account) mine = []
    account = next
  })
  // Looking at Paint counts as reading the news.
  subscribeWindows(() => {
    if (unread.length && paintFocused(getWindows())) {
      unread = []
      dismissBalloon(BALLOON_ID)
      emit()
    }
  })
  subscribeCanvasActivity((activity) => {
    const stroke = strokeFromActivity(activity)
    if (!stroke) return
    const account = getWalletSnapshot().account?.toLowerCase()
    if (account && stroke.owner === account) {
      mine = [stroke.box, ...mine].slice(0, 64)
      if (!isSuppressed({ booting: isBooting(), firstRun: isFirstRunOpen(), bootEndedAt, now: Date.now() }))
        emitMoment({ kind: 'myPaintConfirmed', blockNumber: stroke.block })
      return
    }
    // Paint already outlines strokes live while it's in front.
    if (paintFocused(getWindows())) return
    pending.push(stroke)
    if (!flushTimer) flushTimer = setTimeout(flush, COALESCE_MS)
  })
}

export function __resetActivityForTests() {
  moment = undefined
  unread = []
  pending = []
  mine = []
  lastEmitAt = undefined
  bootEndedAt = undefined
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = undefined
}
