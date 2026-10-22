/**
 * Live Mode wallets left in other browsers.
 *
 * A burner key lives only in the browser that made it, and r3OS keeps one burner per wallet per browser. Start
 * Live Mode on a phone and later on a laptop and the phone's burner keeps whatever MON it had: only that browser
 * can sweep it back. This reads the published session index (public/live/sessions.json, written by
 * scripts/export-sessions.mjs from the contract's SessionStarted events), checks the live balance of each of
 * this wallet's other burners, and lists the ones that still hold MON, so the app can say where the MON is.
 *
 * Read-only. Nothing here can move that MON; it only tells the person which browser can.
 */
import { formatEther, getAddress, type Address } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'

/** Below this a burner is treated as empty: the sweep itself leaves a gas reserve about this size. */
export const STRANDED_DUST = 10n ** 15n // 0.001 MON
/** Checked per wallet: the most recent burners first. */
export const MAX_BURNERS_CHECKED = 12

export interface SessionIndex {
  version: 1
  chainId: number
  paint: Address
  fromBlock: string
  toBlock: string
  sessions: [Address, Address, number][]
}

export interface StrandedBurner {
  address: Address
  balance: bigint
  startedBlock: number
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** The index if it is well formed and for this chain and Paint contract; otherwise undefined. */
export function parseSessionIndex(
  value: unknown,
  expected: { chainId: number; paint?: Address | string } = {
    chainId: config.chainId,
    paint: config.paintAddress,
  },
): SessionIndex | undefined {
  const index = value as Partial<SessionIndex> | null
  if (!index || index.version !== 1 || index.chainId !== expected.chainId || !Array.isArray(index.sessions))
    return undefined
  if (!expected.paint || String(index.paint).toLowerCase() !== String(expected.paint).toLowerCase())
    return undefined
  const ok = index.sessions.every(
    (row) =>
      Array.isArray(row) &&
      ADDRESS.test(String(row[0])) &&
      ADDRESS.test(String(row[1])) &&
      Number.isInteger(row[2]),
  )
  return ok ? (index as SessionIndex) : undefined
}

/** This wallet's burners other than `current`, most recently started first, each once. */
export function otherBurners(index: SessionIndex, owner: Address, current?: Address) {
  const me = owner.toLowerCase()
  const skip = current?.toLowerCase()
  const latest = new Map<string, { address: Address; startedBlock: number }>()
  for (const [rowOwner, key, block] of index.sessions) {
    if (rowOwner.toLowerCase() !== me || key.toLowerCase() === skip) continue
    const previous = latest.get(key.toLowerCase())
    if (!previous || block > previous.startedBlock)
      latest.set(key.toLowerCase(), { address: getAddress(key), startedBlock: block })
  }
  return [...latest.values()].sort((a, b) => b.startedBlock - a.startedBlock)
}

/** Keeps the burners that still hold more than dust, biggest balance first. */
export function stranded(rows: StrandedBurner[], dust = STRANDED_DUST) {
  return rows.filter((row) => row.balance > dust).sort((a, b) => (b.balance > a.balance ? 1 : -1))
}

export function strandedTotal(rows: StrandedBurner[]) {
  return rows.reduce((sum, row) => sum + row.balance, 0n)
}

export function formatStranded(balance: bigint) {
  return `${Number(formatEther(balance)).toFixed(2)} MON`
}

let indexPromise: Promise<SessionIndex | undefined> | undefined
let indexAt = 0

function loadIndex() {
  // Refetched at most every 10 minutes: the file only changes when the replay is refreshed.
  if (!indexPromise || Date.now() - indexAt > 600_000) {
    indexAt = Date.now()
    indexPromise = fetch('/live/sessions.json', { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((json) => parseSessionIndex(json))
      .catch(() => undefined)
  }
  return indexPromise
}

/**
 * This wallet's Live Mode burners from other browsers that still hold MON. Empty when there are none, when
 * the index isn't published, or when the network read fails: this is a hint, never a blocker.
 */
export async function loadStrandedBurners(owner: Address, current?: Address): Promise<StrandedBurner[]> {
  const client = publicClient
  if (!client) return []
  const index = await loadIndex()
  if (!index) return []
  const candidates = otherBurners(index, owner, current).slice(0, MAX_BURNERS_CHECKED)
  if (!candidates.length) return []
  try {
    const balances = await Promise.all(candidates.map((row) => client.getBalance({ address: row.address })))
    return stranded(candidates.map((row, i) => ({ ...row, balance: balances[i] })))
  } catch {
    return []
  }
}

/** Test hook. */
export function __resetSessionIndexForTests() {
  indexPromise = undefined
  indexAt = 0
}
