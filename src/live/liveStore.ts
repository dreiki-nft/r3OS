import { formatEther, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { readPainterProfile } from '../chain/painterProfile'
import { subscribeCanvasActivity } from '../paint/canvasStore'
import {
  burnerStatus,
  cachedBurnerBalance,
  loadBurner,
  subscribeBurnerChanges,
  type BurnerRecord,
  type BurnerSession,
} from './burner'

export const START_SESSION_TYPE_STRING =
  'StartSession(address owner,address sessionKey,uint256 expiryBlock,uint256 maxUnits,' +
  'uint256 nonce,uint256 deadline)'

export const START_SESSION_TYPES = {
  StartSession: [
    { name: 'owner', type: 'address' },
    { name: 'sessionKey', type: 'address' },
    { name: 'expiryBlock', type: 'uint256' },
    { name: 'maxUnits', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export interface StartSessionMessage {
  owner: Address
  sessionKey: Address
  expiryBlock: bigint
  maxUnits: bigint
  nonce: bigint
  deadline: bigint
}

export interface LiveSnapshot {
  owner?: Address
  burner?: BurnerRecord
  session?: BurnerSession
  balance: bigint
  sessionPaints: bigint
  loading: boolean
  version: number
}

type Listener = () => void
const listeners = new Set<Listener>()
let snapshot: LiveSnapshot = { balance: 0n, sessionPaints: 0n, loading: false, version: 0 }
let started = false
let refreshSerial = Promise.resolve()
let reconcileTimer: ReturnType<typeof setTimeout> | undefined
let reconcileOwner: Address | undefined
let reconcileForceProfile = false
const LIVE_RECONCILE_DELAY_MS = 1_200

function emit(patch: Partial<LiveSnapshot>) {
  snapshot = { ...snapshot, ...patch, version: snapshot.version + 1 }
  for (const listener of listeners) listener()
}

export function subscribeLive(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getLiveSnapshot() {
  return snapshot
}

function sameOwner(a?: Address, b?: Address) {
  return a?.toLowerCase() === b?.toLowerCase()
}

function clearScheduledReconcile(owner?: Address) {
  if (!reconcileTimer) return
  if (owner && reconcileOwner && !sameOwner(owner, reconcileOwner)) return
  clearTimeout(reconcileTimer)
  reconcileTimer = undefined
  reconcileOwner = undefined
  reconcileForceProfile = false
}

function scheduleLiveReconcile(owner: Address, forceProfile = false) {
  reconcileOwner = owner
  reconcileForceProfile ||= forceProfile
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => {
    const nextOwner = reconcileOwner
    const nextForceProfile = reconcileForceProfile
    reconcileTimer = undefined
    reconcileOwner = undefined
    reconcileForceProfile = false
    if (nextOwner) void refreshLiveStatus(nextOwner, nextForceProfile)
  }, LIVE_RECONCILE_DELAY_MS)
}

export function advanceObservedSessionUsage(session: BurnerSession | undefined, units: bigint) {
  if (!session || units <= 0n) return session
  const unitsSpent = session.unitsSpent + units
  return { ...session, unitsSpent: unitsSpent > session.maxUnits ? session.maxUnits : unitsSpent }
}

function ensureStarted() {
  if (started) return
  started = true
  subscribeBurnerChanges((owner) => {
    if (!sameOwner(owner, snapshot.owner)) return
    const burner = loadBurner(owner)
    const cachedBalance = cachedBurnerBalance(owner)
    const burnerChanged = burner?.address.toLowerCase() !== snapshot.burner?.address.toLowerCase()
    if (burnerChanged || !burner) {
      void refreshLiveStatus(owner)
      return
    }
    emit({ burner, ...(cachedBalance == null ? {} : { balance: cachedBalance }) })
    scheduleLiveReconcile(owner)
  })
  subscribeCanvasActivity((activity) => {
    if (!snapshot.owner) return
    if (
      (activity.eventName === 'SessionStarted' || activity.eventName === 'SessionRevoked') &&
      sameOwner(activity.owner as Address | undefined, snapshot.owner)
    ) {
      void refreshLiveStatus()
    }
    if (
      activity.eventName === 'Painted' &&
      sameOwner(activity.owner as Address | undefined, snapshot.owner)
    ) {
      const owner = snapshot.owner
      const burner = snapshot.burner
      const paintedByCurrentSession =
        owner &&
        burner &&
        activity.sessionKey &&
        sameOwner(activity.sessionKey as Address, burner.address)
      if (owner && paintedByCurrentSession) {
        emit({
          session: advanceObservedSessionUsage(snapshot.session, activity.units ?? 0n),
          sessionPaints: snapshot.sessionPaints + 1n,
        })
        // Chain reads are reconciliation, not the interaction loop. Coalesce them until the user pauses.
        scheduleLiveReconcile(owner, true)
      }
    }
  })
  subscribeBlocks(() => {
    const session = snapshot.session
    if (!session?.active) return
    if (getBlockSnapshot().block > session.expiryBlock) {
      emit({ session: { ...session, active: false } })
    }
  })
}

export function setLiveOwner(owner?: Address) {
  ensureStarted()
  if (sameOwner(owner, snapshot.owner)) return
  clearScheduledReconcile()
  const burner = owner ? loadBurner(owner) : undefined
  snapshot = {
    owner,
    burner,
    session: undefined,
    balance: 0n,
    sessionPaints: 0n,
    loading: Boolean(owner && burner),
    version: snapshot.version + 1,
  }
  for (const listener of listeners) listener()
  if (owner) void refreshLiveStatus(owner)
}

export function refreshLiveStatus(owner = snapshot.owner, forceProfile = false) {
  if (!owner) return Promise.resolve()
  clearScheduledReconcile(owner)
  const run = refreshSerial.then(async () => {
    const burner = loadBurner(owner)
    if (!publicClient || !config.paintAddress) {
      if (sameOwner(owner, snapshot.owner)) {
        emit({ burner, session: undefined, balance: 0n, loading: false })
      }
      return
    }
    const [status, profile] = await Promise.all([
      burner ? burnerStatus(owner) : Promise.resolve(undefined),
      readPainterProfile(owner, forceProfile),
    ])
    if (!sameOwner(owner, snapshot.owner)) return
    emit({
      burner,
      session: status?.session,
      balance: status?.balance ?? 0n,
      sessionPaints: profile.stats[8] ?? 0n,
      loading: false,
    })
  })
  refreshSerial = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Update the visible burner balance from a transition whose receipt this browser already observed. */
export function confirmBurnerBalance(owner: Address, balance: bigint) {
  if (!sameOwner(owner, snapshot.owner)) return
  emit({ balance })
}

/**
 * Commit a session we just saw succeed in a transaction receipt. The receipt is stronger evidence than an
 * immediate follow-up read from another public RPC, which may briefly lag the accepted block. We still
 * refresh from chain afterward, but Live Mode should become active from the observed receipt immediately.
 */
export function confirmLiveSessionStarted(owner: Address, message: StartSessionMessage) {
  ensureStarted()
  const burner = loadBurner(owner)
  if (!burner || burner.address.toLowerCase() !== message.sessionKey.toLowerCase()) return
  if (!sameOwner(owner, snapshot.owner)) return
  emit({
    burner,
    session: {
      owner,
      expiryBlock: message.expiryBlock,
      maxUnits: message.maxUnits,
      unitsSpent: 0n,
      revoked: false,
      active: true,
    },
    balance: cachedBurnerBalance(owner) ?? snapshot.balance,
    loading: false,
  })
}

export function paintEip712Name(chainId: number) {
  // The historical testnet deployment uses the legacy domain. Mainnet/local
  // deployments from the r3OS source use the rebranded domain.
  return chainId === 10_143 ? 'r3tards paint' : 'r3OS paint'
}

export function buildStartSessionTypedData(message: StartSessionMessage) {
  return {
    domain: {
      name: paintEip712Name(config.chainId),
      version: '2',
      chainId: config.chainId,
      verifyingContract: config.paintAddress!,
    },
    types: START_SESSION_TYPES,
    primaryType: 'StartSession' as const,
    message,
  }
}

export function liveActive(snapshotValue = snapshot) {
  return Boolean(snapshotValue.burner && snapshotValue.session?.active)
}

export function unitsLeft(session?: BurnerSession) {
  if (!session) return 0n
  return session.maxUnits > session.unitsSpent ? session.maxUnits - session.unitsSpent : 0n
}

export function liveTimeLeftMs(session?: BurnerSession) {
  if (!session?.active) return 0
  const blocks = session.expiryBlock - getBlockSnapshot().block
  return Math.max(0, Number(blocks) * getBlockSnapshot().blockTimeMs)
}

export function formatLiveTime(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} h ${rest} m` : `${rest} m`
}

export function formatBurnerBalance(balance = snapshot.balance) {
  return `${Number(formatEther(balance)).toFixed(2)} MON`
}

export function sweepAmount(balance: bigint, gasLimit: bigint, maxFeePerGas: bigint) {
  const gas = gasLimit * maxFeePerGas
  return balance > gas ? balance - gas : 0n
}

/**
 * App-managed ceiling for a browser-held burner. A burner key lives in localStorage, so it should only ever
 * hold pocket change; any app funding action that would take its balance above this is refused.
 */
export const MAX_BURNER_FUND = 1n * 10n ** 18n

export function burnerFundTooLarge(value: bigint, currentBalance = 0n) {
  return currentBalance + value > MAX_BURNER_FUND
}

export function burnerTopUpValue(requested: bigint, currentBalance = 0n) {
  if (requested <= 0n || currentBalance >= MAX_BURNER_FUND) return 0n
  const headroom = MAX_BURNER_FUND - currentBalance
  return requested > headroom ? headroom : requested
}

export const FUNDING_TARGET_PAINTS = 20n

/**
 * Desired burner balance for a fresh session. We still aim for roughly twenty typical paints, but the
 * browser-held key is never auto-funded above MAX_BURNER_FUND. The cap is the security invariant; the
 * paint count is only a convenience target.
 */
export function fundingSuggestion(corePaintGas: bigint, startSessionGas: bigint, maxFeePerGas: bigint) {
  const wei = (FUNDING_TARGET_PAINTS * corePaintGas + startSessionGas) * maxFeePerGas
  const tenth = 100_000_000_000_000_000n
  const rounded = ((wei + tenth - 1n) / tenth) * tenth
  return rounded > MAX_BURNER_FUND ? MAX_BURNER_FUND : rounded
}

export function isSessionSignatureExpired(
  deadline: bigint,
  unixSeconds = BigInt(Math.floor(Date.now() / 1_000)),
) {
  return unixSeconds > deadline
}

export type SessionSignature = Hex
