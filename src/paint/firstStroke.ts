/**
 * Past the first stroke. In season 1, a new wallet that sent a single stroke on its first day came back on a later
 * day 6 times in 16; one that sent 10 or more came back 20 times in 36. So the moment a first stroke lands, say
 * plainly what it did and what the next one earns, using the contract's own rule: a UTC day with 16+ pixels is an
 * active day, and every active day adds 32 px to the hourly budget, for good.
 *
 * Two notices, both from the chain (painterStats, read only after a paint of this wallet lands):
 *  - first:  the wallet's first paint ever just landed (firstPaintBlock is that block). Once per wallet.
 *  - credit: today just became an active day. Once per wallet per UTC day, and never together with "first".
 * Nothing is tracked or sent anywhere: two flags per wallet in this browser.
 */
import type { Address } from 'viem'
import { invalidatePainterProfile, readPainterProfile } from '../chain/painterProfile'
import { getTxTraceSnapshot, subscribeTxTrace, type TxTrace } from '../chain/txTrace'
import { getWalletSnapshot } from '../chain/wallet'
import { pushBalloon } from '../os/balloons'
import { openProgram } from '../os/programs'

/** R3OSPaint on mainnet (checked by scripts/launch-doctor): BASE_PIXELS_PER_HOUR, PIXELS_PER_ACTIVE_DAY, … */
export const BUDGET_RULES = { base: 512, perActiveDay: 32, max: 2_048, activeDayPixels: 16 } as const

/** The painterStats fields this needs (indexes from the ABI: activeDays 0, pixelsToday 1, firstPaintBlock 4, paintCount 6). */
export type StrokeStats = {
  activeDays: number
  pixelsToday: number
  firstPaintBlock: bigint
  paintCount: number
}

export function statsFrom(raw: readonly bigint[]): StrokeStats | undefined {
  if (raw.length < 7) return undefined
  return {
    activeDays: Number(raw[0]),
    pixelsToday: Number(raw[1]),
    firstPaintBlock: raw[4],
    paintCount: Number(raw[6]),
  }
}

export const hourlyBudget = (activeDays: number, rules = BUDGET_RULES) =>
  Math.min(rules.max, rules.base + rules.perActiveDay * Math.max(0, activeDays))

const fmt = (n: number) => n.toLocaleString('en-US')

export type StrokeNotice = { kind: 'first' | 'credit'; title: string; body: string }

/**
 * What to say after paints of this visit landed in `blocks`. `firstDone`: this wallet already got (or never
 * needed) the first notice. `creditedToday`: the active-day notice was already shown today.
 */
export function strokeNotice(
  stats: StrokeStats,
  {
    blocks,
    firstDone,
    creditedToday,
  }: { blocks: readonly bigint[]; firstDone: boolean; creditedToday: boolean },
  rules = BUDGET_RULES,
): StrokeNotice | undefined {
  const credited = stats.pixelsToday >= rules.activeDayPixels
  const budget = hourlyBudget(stats.activeDays, rules)
  if (!firstDone && blocks.includes(stats.firstPaintBlock)) {
    const next = credited
      ? `today already counts as an active day: your budget is ${fmt(budget)} px an hour. paint ${rules.activeDayPixels}+ px on another day (UTC) for +${rules.perActiveDay} more. it never goes down.`
      : `paint ${rules.activeDayPixels - stats.pixelsToday} more px today and today counts as an active day: +${rules.perActiveDay} px an hour to your budget, for good.`
    return {
      kind: 'first',
      title: 'Your first pixels are onchain',
      body: `block #${stats.firstPaintBlock}, in this season's canvas and its replay now. ${next}`,
    }
  }
  if (credited && !creditedToday) {
    const growth =
      budget >= rules.max
        ? `that's the ${fmt(rules.max)} max.`
        : `paint on another day for +${rules.perActiveDay} more.`
    return {
      kind: 'credit',
      title: 'Today counts',
      body: `active day ${stats.activeDays}: your budget is now ${fmt(budget)} px an hour. ${growth}`,
    }
  }
  return undefined
}

/** A paint of this visit that landed and didn't revert. */
export const landedPaint = (trace: TxTrace) =>
  trace.blockNumber != null && trace.receiptStatus !== 'reverted' && /^paint \d+ px/.test(trace.action)

export const utcDay = (now = Date.now()) => Math.floor(now / 86_400_000)

const FIRST_KEY = (owner: string) => `r3os.firstStroke.${owner.toLowerCase()}`
const CREDIT_KEY = (owner: string) => `r3os.activeDayShown.${owner.toLowerCase()}`

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the notices may repeat in a later visit, nothing worse.
  }
}

let started = false
let stop: (() => void) | undefined
const seen = new Set<string>()
/** Blocks this visit's paints landed in: the first paint ever is one of them. */
const landedBlocks: bigint[] = []
let busy = false

async function check(owner: Address) {
  const firstDone = read(FIRST_KEY(owner)) === '1'
  const creditedToday = read(CREDIT_KEY(owner)) === String(utcDay())
  if (firstDone && creditedToday) return // nothing left to say today: no read at all
  let stats: StrokeStats | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    invalidatePainterProfile(owner)
    stats = statsFrom((await readPainterProfile(owner, true)).stats)
    // The read node can trail the receipt by a block: wait once if it hasn't seen this paint yet.
    if (stats && stats.firstPaintBlock !== 0n && stats.paintCount > 0) break
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  if (!stats || stats.firstPaintBlock === 0n) return
  const notice = strokeNotice(stats, { blocks: landedBlocks, firstDone, creditedToday })
  // An old painter never needs the first notice; a first stroke big enough also settles today.
  if (!firstDone) write(FIRST_KEY(owner), '1')
  if (stats.pixelsToday >= BUDGET_RULES.activeDayPixels) write(CREDIT_KEY(owner), String(utcDay()))
  if (!notice) return
  pushBalloon({
    id: `stroke-${notice.kind}`,
    icon: 'paint',
    title: notice.title,
    body: notice.body,
    ...(notice.kind === 'first'
      ? {
          sticky: true,
          actions: [
            { label: 'Keep painting', run: () => undefined },
            { label: 'Open My Pass', run: () => void openProgram('pass') },
          ],
        }
      : {}),
  })
}

/** Watches this visit's paints and speaks after the ones that matter. Started once by the shell. */
export function initFirstStroke() {
  if (started) return
  started = true
  // Paints already in the trace when this starts (none, normally) are not news.
  for (const trace of getTxTraceSnapshot().traces) seen.add(trace.hash)
  stop = subscribeTxTrace(() => {
    if (busy) return
    const owner = getWalletSnapshot().account
    if (!owner) return
    const fresh = getTxTraceSnapshot().traces.filter((entry) => !seen.has(entry.hash) && landedPaint(entry))
    if (!fresh.length) return
    for (const trace of fresh) {
      seen.add(trace.hash)
      landedBlocks.push(trace.blockNumber!)
    }
    busy = true
    void check(owner)
      .catch(() => undefined)
      .finally(() => {
        busy = false
      })
  })
}

export function __resetFirstStrokeForTests() {
  stop?.()
  stop = undefined
  started = false
  seen.clear()
  landedBlocks.length = 0
  busy = false
}
