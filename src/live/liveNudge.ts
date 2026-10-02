import { getTxTraceSnapshot, subscribeTxTrace, type TxTrace } from '../chain/txTrace'
import { pushBalloon } from '../os/balloons'
import { openProgram } from '../os/programs'
import { getLiveSnapshot, liveActive } from './liveStore'

const NEVER_KEY = 'r3os.liveNudge.never'
const BALLOON_ID = 'live-nudge'
/** Offer Live mode once the wallet has confirmed this many paints in this visit. */
export const NUDGE_AFTER_PAINTS = 2

/** Paints the main wallet confirmed (landed) in this visit. "paint N px and save frame" can't go live, so not counted. */
export function walletPaintsConfirmed(traces: readonly TxTrace[]) {
  return traces.filter(
    (trace) => trace.signer === 'wallet' && trace.blockNumber != null && /^paint \d+ px$/.test(trace.action),
  ).length
}

export function shouldNudge(facts: { walletPaints: number; live: boolean; never: boolean; shown: boolean }) {
  return facts.walletPaints >= NUDGE_AFTER_PAINTS && !facts.live && !facts.never && !facts.shown
}

function neverAgain() {
  try {
    return localStorage.getItem(NEVER_KEY) === '1'
  } catch {
    return false
  }
}

function setNeverAgain() {
  try {
    localStorage.setItem(NEVER_KEY, '1')
  } catch {
    // Storage blocked: it just asks once per visit.
  }
}

let started = false
let shown = false

/** After the 2nd wallet-confirmed paint, a balloon offers Live mode (once per visit, never after "Don't ask"). */
export function initLiveNudge() {
  if (started) return
  started = true
  subscribeTxTrace(() => {
    if (
      !shouldNudge({
        walletPaints: walletPaintsConfirmed(getTxTraceSnapshot().traces),
        live: liveActive(getLiveSnapshot()),
        never: neverAgain(),
        shown,
      })
    )
      return
    shown = true
    pushBalloon({
      id: BALLOON_ID,
      icon: 'key',
      title: 'Tired of confirming every paint?',
      body: 'turn on Live mode: 2 wallet prompts now, then paint with no popups for about 2 hours.',
      sticky: true,
      actions: [
        { label: 'Turn on Live mode', run: () => void openProgram('live-wizard') },
        { label: "Don't ask again", run: setNeverAgain },
      ],
    })
  })
}

export function __resetLiveNudgeForTests() {
  started = false
  shown = false
}
