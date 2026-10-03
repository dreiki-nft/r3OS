import { formatEther, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { subscribeCanvasActivity } from '../paint/canvasStore'
import {
  burnerStatus,
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

function ensureStarted() {
  if (started) return
  started = true
  subscribeBurnerChanges((owner) => {
    if (sameOwner(owner, snapshot.owner)) void refreshLiveStatus()
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
      void refreshLiveStatus()
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

export function refreshLiveStatus(owner = snapshot.owner) {
  if (!owner) return Promise.resolve()
  const run = refreshSerial.then(async () => {
    const burner = loadBurner(owner)
    if (!publicClient || !config.paintAddress) {
      if (sameOwner(owner, snapshot.owner)) {
        emit({ burner, session: undefined, balance: 0n, loading: false })
      }
      return
    }
    const client = publicClient
    const [status, stats] = await Promise.all([
      burner ? burnerStatus(owner) : Promise.resolve(undefined),
      client.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'painterStats',
        args: [owner],
      }) as Promise<readonly bigint[]>,
    ])
    if (!sameOwner(owner, snapshot.owner)) return
    emit({
      burner,
      session: status?.session,
      balance: status?.balance ?? 0n,
      sessionPaints: stats[8] ?? 0n,
      loading: false,
    })
  })
  refreshSerial = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function buildStartSessionTypedData(message: StartSessionMessage) {
  return {
    domain: {
      name: 'r3tards paint',
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

export function sweepAmount(balance: bigint, maxFeePerGas: bigint) {
  const gas = 21_000n * maxFeePerGas
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

export const FUNDING_TARGET_PAINTS = 20n

export function fundingSuggestion(corePaintGas: bigint, startSessionGas: bigint, maxFeePerGas: bigint) {
  const wei = (FUNDING_TARGET_PAINTS * corePaintGas + startSessionGas) * maxFeePerGas
  const tenth = 100_000_000_000_000_000n
  return ((wei + tenth - 1n) / tenth) * tenth
}

export function isSessionSignatureExpired(
  deadline: bigint,
  unixSeconds = BigInt(Math.floor(Date.now() / 1_000)),
) {
  return unixSeconds > deadline
}

export type SessionSignature = Hex
