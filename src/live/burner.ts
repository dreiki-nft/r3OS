import { createWalletClient, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { appChain, appTransport, publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'

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

export function burnerWallet(owner: Address) {
  const account = burnerAccount(owner)
  if (!account || config.demo) return undefined
  return createWalletClient({
    account,
    chain: appChain,
    transport: appTransport,
  })
}

export async function burnerStatus(owner: Address): Promise<BurnerStatus | undefined> {
  const burner = loadBurner(owner)
  if (!burner || !publicClient || !config.paintAddress) return undefined
  const client = publicClient
  const [rawSession, balance] = await Promise.all([
    client.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
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
