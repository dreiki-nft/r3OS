/**
 * The automatic sweep. When r3OS opens (or the wallet connects) and this browser holds a Live Mode burner whose
 * session is over (expired or revoked) but which still holds MON, that MON goes straight back to the wallet. The
 * burner signs its own transfer, so there is no wallet prompt; a balloon says what came back.
 *
 * It never touches a burner whose session hasn't started (someone in the middle of setting one up), never runs
 * while Quick Start or the Live Mode wizard is going, and tries each burner at most once per page load: if gas
 * went up since the quote or anything fails, it stays quiet and tries again next time. The key stays, so the
 * next session reuses the same burner instead of making a new one.
 */
import type { Address } from 'viem'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { pushBalloon } from '../os/balloons'
import { getWindows } from '../os/windows'
import { sweepBurner } from './endSession'
import {
  formatBurnerBalance,
  getLiveSnapshot,
  refreshLiveStatus,
  subscribeLive,
  type LiveSnapshot,
} from './liveStore'
import { liveSetupRunning } from './liveSetup'
import { STRANDED_DUST } from './sessionHistory'

const ZERO = '0x0000000000000000000000000000000000000000'
const attempted = new Set<string>()
let running = false
let started = false

/** Pure: whether this snapshot is a finished session whose burner still holds more than the sweep's own reserve. */
export function shouldAutoSweep(
  live: LiveSnapshot,
  account: Address | undefined,
  busy: boolean,
  tried: Set<string>,
) {
  if (busy || !account || live.loading || !live.burner || !live.session) return false
  const me = account.toLowerCase()
  if (live.owner?.toLowerCase() !== me) return false
  const session = live.session
  // Only a session this wallet started and that is now over. Never one that hasn't started yet: that burner may
  // be holding the funding for a session someone is setting up right now.
  if (session.owner.toLowerCase() === ZERO || session.owner.toLowerCase() !== me) return false
  if (session.active || session.expiryBlock === 0n) return false
  if (live.balance <= STRANDED_DUST) return false
  return !tried.has(live.burner.address.toLowerCase())
}

function setupOpen() {
  return liveSetupRunning() || getWindows().windows.some((win) => win.id === 'live-wizard')
}

async function check() {
  const account = getWalletSnapshot().account
  const live = getLiveSnapshot()
  if (!shouldAutoSweep(live, account, running || setupOpen(), attempted) || !account || !live.burner) return
  const burner = live.burner.address
  attempted.add(burner.toLowerCase())
  running = true
  try {
    // Gas went up since the quote: skip rather than ask, it runs again on the next visit.
    const sent = await sweepBurner({ account, burner, confirmHigherCost: async () => false })
    if (sent > 0n)
      pushBalloon({
        id: 'live-auto-sweep',
        title: 'Live Mode MON sent back',
        icon: 'key',
        body: `${formatBurnerBalance(sent)} from this browser's Live Mode wallet is back in your wallet: its session was over.`,
      })
    await refreshLiveStatus(account)
  } catch {
    // Quiet on purpose: nothing was lost, the MON is still in the burner and this browser still holds its key.
  } finally {
    running = false
  }
}

/** Starts watching (once, from the shell). */
export function initAutoSweep() {
  if (started) return
  started = true
  subscribeLive(() => void check())
  subscribeWallet(() => void check())
}

/** Test hooks. */
export const __autoSweepForTests = {
  check,
  reset() {
    attempted.clear()
    running = false
  },
}
