import type { Address, Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'

export interface BurnerRecord {
  privateKey: Hex
  address: Address
  createdAt: number
}

export interface BurnerSession {
  owner: Address
  expiryBlock: bigint
  maxUnits: bigint
  unitsSpent: bigint
  revoked: boolean
  active: boolean
}

export interface BurnerStatus {
  burner: BurnerRecord
  session: BurnerSession
  balance: bigint
}

type BurnerListener = (owner: Address) => void
const listeners = new Set<BurnerListener>()

type BalanceCacheEntry = { balance: bigint; at: number }
const balanceCache = new Map<string, BalanceCacheEntry>()

function balanceKey(owner: Address) {
  return owner.toLowerCase()
}

export function cachedBurnerBalance(owner: Address, maxAgeMs = 60_000) {
  const cached = balanceCache.get(balanceKey(owner))
  if (!cached || Date.now() - cached.at > maxAgeMs) return undefined
  return cached.balance
}

/**
 * Seed the hot-path balance cache from a balance transition whose receipt this browser already observed.
 * This avoids immediately asking a different RPC endpoint for state that may lag the receipt by a block.
 */
export function setCachedBurnerBalance(owner: Address, balance: bigint) {
  balanceCache.set(balanceKey(owner), { balance, at: Date.now() })
}

export function debitCachedBurnerBalance(owner: Address, amount: bigint) {
  const key = balanceKey(owner)
  const cached = balanceCache.get(key)
  if (!cached) return
  balanceCache.set(key, { balance: cached.balance > amount ? cached.balance - amount : 0n, at: Date.now() })
}

export function burnerStorageKey(owner: Address, chainId = config.chainId) {
  return `r3os.burner.${chainId}.${owner.toLowerCase()}`
}

function validRecord(value: unknown): value is BurnerRecord {
  const record = value as Partial<BurnerRecord> | null
  return Boolean(
    record &&
    typeof record.privateKey === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(record.privateKey) &&
    typeof record.address === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(record.address) &&
    typeof record.createdAt === 'number',
  )
}

export function loadBurner(owner: Address, chainId = config.chainId): BurnerRecord | undefined {
  try {
    const raw = localStorage.getItem(burnerStorageKey(owner, chainId))
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    return validRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function createBurner(owner: Address, chainId = config.chainId) {
  const existing = loadBurner(owner, chainId)
  if (existing) return existing
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const record: BurnerRecord = { privateKey, address: account.address, createdAt: Date.now() }
  try {
    localStorage.setItem(burnerStorageKey(owner, chainId), JSON.stringify(record))
  } catch {
    // The wizard can continue for this page load only if storage works; callers verify by reloading it.
  }
  notifyBurnerChanged(owner)
  return record
}

/**
 * Runs `task` while holding a lock shared by every r3OS tab of this browser (Web Locks API). Without the API
 * (old Safari) it just runs: the callers re-check storage, so that is no worse than before.
 */
export function withTabLock<T>(name: string, task: () => Promise<T> | T): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks?.request) return Promise.resolve().then(task)
  return locks.request(name, async () => task()) as Promise<T>
}

/**
 * Two tabs starting Live Mode at the same moment could each make a key and the later write would replace the
 * first, after that tab had already signed a session for it. Under one lock the second tab finds and reuses
 * the first tab's burner.
 */
export function createBurnerOnce(owner: Address, chainId = config.chainId) {
  return withTabLock(`r3os.burner.create.${chainId}.${owner.toLowerCase()}`, () =>
    createBurner(owner, chainId),
  )
}

/** Another tab made, replaced or removed a burner: tell this tab's Live Mode state to re-read it. */
export function watchBurnerStorage() {
  if (typeof window === 'undefined') return () => undefined
  const onStorage = (event: StorageEvent) => {
    const match = event.key?.match(/^r3os\.burner\.(\d+)\.(0x[0-9a-f]{40})$/)
    if (!match || Number(match[1]) !== config.chainId) return
    balanceCache.delete(match[2])
    notifyBurnerChanged(match[2] as Address)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

export function deleteBurner(owner: Address, chainId = config.chainId) {
  try {
    localStorage.removeItem(burnerStorageKey(owner, chainId))
  } catch {
    // Storage can be blocked.
  }
  balanceCache.delete(balanceKey(owner))
  notifyBurnerChanged(owner)
}

export function burnerAccount(owner: Address) {
  const burner = loadBurner(owner)
  return burner ? privateKeyToAccount(burner.privateKey) : undefined
}

export async function burnerStatus(owner: Address): Promise<BurnerStatus | undefined> {
  const burner = loadBurner(owner)
  if (!burner || !publicClient || !config.paintAddress) return undefined
  const client = publicClient
  const [rawSession, balance] = await Promise.all([
    client.readContract({
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'sessionInfo',
      args: [burner.address],
    }) as Promise<readonly [Address, bigint, bigint, bigint, boolean, boolean]>,
    client.getBalance({ address: burner.address }),
  ])
  balanceCache.set(balanceKey(owner), { balance, at: Date.now() })
  return {
    burner,
    session: {
      owner: rawSession[0],
      expiryBlock: rawSession[1],
      maxUnits: rawSession[2],
      unitsSpent: rawSession[3],
      revoked: rawSession[4],
      active: rawSession[5],
    },
    balance,
  }
}

export function subscribeBurnerChanges(listener: BurnerListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyBurnerChanged(owner: Address) {
  for (const listener of listeners) listener(owner)
}

export function __resetBurnerBalanceCacheForTests() {
  balanceCache.clear()
}
