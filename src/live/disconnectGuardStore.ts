/**
 * The disconnect guard. Disconnecting (Start › Disconnect, or Shut Down) is the moment people mean "I'm done
 * here", so if this browser still holds a Live Mode wallet with a running session or leftover MON, r3OS asks
 * first: end the session (or just sweep, when it's already over) and get the MON back, disconnect anyway, or
 * cancel. Nothing is lost by disconnecting itself (the key stays in this browser), but MON left here can only
 * ever be swept from here, so this is the place to offer it.
 */
import type { Address } from 'viem'
import { screenSafeMessage } from '../chain/errors'
import { getWalletSnapshot } from '../chain/wallet'
import { endLiveSession } from './endSession'
import { getLiveSnapshot, liveActive, type LiveSnapshot } from './liveStore'
import { STRANDED_DUST } from './sessionHistory'

export type GuardMode = 'active' | 'sweep'

export interface DisconnectGuardState {
  mode: GuardMode
  account: Address
  burner: Address
  balance: bigint
  busy: boolean
  progress: string
  error: string
}

type Listener = () => void
const listeners = new Set<Listener>()
let state: DisconnectGuardState | undefined
let after: (() => void) | undefined

function set(next: DisconnectGuardState | undefined) {
  state = next
  for (const listener of listeners) listener()
}

export function subscribeDisconnectGuard(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDisconnectGuard() {
  return state
}

/**
 * Pure: whether disconnecting `account` needs the guard. 'active' while its Live Mode session runs, 'sweep'
 * when the session is over but this browser's burner still holds more than the sweep's own gas reserve.
 */
export function guardMode(live: LiveSnapshot, account?: Address): GuardMode | undefined {
  if (!account || !live.burner) return undefined
  if (live.owner && live.owner.toLowerCase() !== account.toLowerCase()) return undefined
  if (liveActive(live)) return 'active'
  if (live.balance > STRANDED_DUST) return 'sweep'
  return undefined
}

/** Disconnect through the guard: runs `disconnect` right away when there's nothing to warn about. */
export function requestDisconnect(disconnect: () => void) {
  const account = getWalletSnapshot().account
  const live = getLiveSnapshot()
  const mode = guardMode(live, account)
  if (!mode || !account || !live.burner) {
    disconnect()
    return
  }
  after = disconnect
  set({
    mode,
    account,
    burner: live.burner.address,
    balance: live.balance,
    busy: false,
    progress: '',
    error: '',
  })
}

/** "End session & disconnect" / "Sweep & disconnect". On failure the dialog stays, with the error, and the key stays. */
export async function endAndDisconnect() {
  const current = state
  if (!current || current.busy) return
  set({ ...current, busy: true, error: '', progress: '' })
  try {
    await endLiveSession({
      account: current.account,
      burner: current.burner,
      active: current.mode === 'active',
      onProgress: (progress) => state && set({ ...state, progress }),
    })
  } catch (caught) {
    if (state) set({ ...state, busy: false, progress: '', error: screenSafeMessage(caught) })
    return
  }
  finish()
}

export function disconnectAnyway() {
  if (state?.busy) return
  finish()
}

export function cancelDisconnect() {
  if (state?.busy) return
  after = undefined
  set(undefined)
}

function finish() {
  const run = after
  after = undefined
  set(undefined)
  run?.()
}
