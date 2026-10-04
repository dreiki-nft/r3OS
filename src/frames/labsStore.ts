import { zeroAddress, type Address } from 'viem'
import { publicClient, wsClient } from '../chain/clients'
import { readHeavy, readMany } from '../chain/readMany'
import { R3OS_LABS_ABI } from '../lib/generated/abi'
import { readLabsToken, resolveLabsAddress, type LabsTokenData } from '../labs/labsToken'

export type LabsOwnedToken = { id: bigint; data?: LabsTokenData }

function same(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

export function applyLabsTransfer(
  ids: readonly bigint[],
  owner: Address,
  from: Address,
  to: Address,
  id: bigint,
) {
  const next = new Set(ids.map(String))
  if (same(from, owner)) next.delete(String(id))
  if (same(to, owner)) next.add(String(id))
  return [...next].map(BigInt).sort((a, b) => (a < b ? -1 : 1))
}

export function ownedFromOwnerScan(results: readonly any[], owner: Address, startId = 1n) {
  return results.flatMap((row, index) =>
    row?.status === 'success' && same(String(row.result), owner) ? [startId + BigInt(index)] : [],
  )
}

let labsAddressPromise: Promise<Address> | undefined
const ownedLabsInflight = new Map<string, Promise<bigint[]>>()
const ownedLabsCache = new Map<string, { ids: bigint[]; at: number }>()
const ownedLabsSources = new Map<
  string,
  { values: Map<string, Address>; at: number; promise?: Promise<Map<string, Address>> }
>()
const OWNED_LABS_FRESH_MS = 8_000
let stopLabsTransferWatch: (() => void) | undefined

function ensureLabsTransferWatch(labs: Address) {
  if (!wsClient || stopLabsTransferWatch) return
  stopLabsTransferWatch = wsClient.watchContractEvent({
    address: labs,
    abi: R3OS_LABS_ABI,
    eventName: 'Transfer',
    onLogs: (logs) => {
      const prefix = `${labs.toLowerCase()}:`
      for (const log of logs) {
        const args = log.args as { from?: Address; to?: Address; tokenId?: bigint }
        if (args.tokenId == null) continue
        for (const [key, cached] of ownedLabsCache) {
          if (!key.startsWith(prefix)) continue
          const owner = key.slice(prefix.length) as Address
          const next = applyLabsTransfer(
            cached.ids,
            owner,
            args.from ?? zeroAddress,
            args.to ?? zeroAddress,
            args.tokenId,
          )
          if (next.length !== cached.ids.length || next.some((id, index) => id !== cached.ids[index])) {
            ownedLabsCache.set(key, { ids: next, at: Date.now() })
            ownedLabsSources.delete(key)
          }
        }
      }
    },
  })
}

export async function labsAddress() {
  if (!labsAddressPromise) {
    labsAddressPromise = resolveLabsAddress().catch((error) => {
      labsAddressPromise = undefined
      throw error
    })
  }
  const address = await labsAddressPromise
  ensureLabsTransferWatch(address)
  return address
}

export async function scanOwnedLabs(labs: Address, owner: Address, force = false) {
  if (!publicClient) return []
  const key = `${labs.toLowerCase()}:${owner.toLowerCase()}`
  const cached = ownedLabsCache.get(key)
  if (!force && cached && Date.now() - cached.at < OWNED_LABS_FRESH_MS) return cached.ids
  const active = ownedLabsInflight.get(key)
  if (active) return active

  const pending = (async () => {
    const total = BigInt(
      await publicClient.readContract({ address: labs, abi: R3OS_LABS_ABI, functionName: 'totalMinted' }),
    )
    if (total === 0n) return []
    // readMany already slices Multicall3 into 100-call chunks and runs four chunks at a time.
    // Feeding it the whole owner scan avoids a serial 100-token waterfall as Labs grows.
    const rows = await readMany(
      Array.from({ length: Number(total) }, (_, i) => ({
        address: labs,
        abi: R3OS_LABS_ABI,
        functionName: 'ownerOf',
        args: [1n + BigInt(i)],
      })),
      { allowFailure: true },
    )
    const ids = ownedFromOwnerScan(rows, owner, 1n)
    ownedLabsCache.set(key, { ids, at: Date.now() })
    return ids
  })().finally(() => {
    if (ownedLabsInflight.get(key) === pending) ownedLabsInflight.delete(key)
  })

  ownedLabsInflight.set(key, pending)
  return pending
}

export async function loadOwnedLabsSources(labs: Address, owner: Address, force = false) {
  const key = `${labs.toLowerCase()}:${owner.toLowerCase()}`
  const cached = ownedLabsSources.get(key)
  if (!force && cached && Date.now() - cached.at < OWNED_LABS_FRESH_MS) return cached.values
  if (cached?.promise) return cached.promise
  const entry: { values: Map<string, Address>; at: number; promise?: Promise<Map<string, Address>> } =
    cached ?? { values: new Map(), at: 0 }
  const pending = (async () => {
    const ids = await scanOwnedLabs(labs, owner, force)
    if (!ids.length) return new Map<string, Address>()
    const rows = await readMany(
      ids.map((id) => ({ address: labs, abi: R3OS_LABS_ABI, functionName: 'sourceOf', args: [id] })),
      { allowFailure: true },
    )
    const values = new Map<string, Address>()
    ids.forEach((id, index) => {
      const row = rows[index] as any
      if (row?.status === 'success') values.set(id.toString(), row.result as Address)
    })
    return values
  })()
    .then((values) => {
      entry.values = values
      entry.at = Date.now()
      return values
    })
    .finally(() => {
      if (entry.promise === pending) entry.promise = undefined
    })
  entry.promise = pending
  ownedLabsSources.set(key, entry)
  return pending
}

async function loadLabsTokenIds(ids: readonly bigint[]) {
  if (!ids.length) return []
  const rows = await readHeavy(
    ids.map((id) => ({ run: () => readLabsToken(id) })),
    { concurrency: 4 },
  )
  return ids.map((id, index) => ({
    id,
    data: rows[index]?.status === 'success' ? (rows[index].result as LabsTokenData) : undefined,
  }))
}

export async function loadOwnedLabsTokens(owner: Address) {
  const address = await labsAddress()
  return loadLabsTokenIds(await scanOwnedLabs(address, owner))
}

/** Load metadata only for Labs tokens minted by the requested source contracts. */
export async function loadOwnedLabsTokensBySources(
  owner: Address,
  sources: readonly Address[],
  force = false,
) {
  const allowed = new Set(sources.map((source) => source.toLowerCase()))
  if (!allowed.size) return []
  const address = await labsAddress()
  const [ids, sourceMap] = await Promise.all([
    scanOwnedLabs(address, owner, force),
    loadOwnedLabsSources(address, owner, force),
  ])
  return loadLabsTokenIds(
    ids.filter((id) => {
      const source = sourceMap.get(id.toString())
      return Boolean(source && allowed.has(source.toLowerCase()))
    }),
  )
}

export function labsBucket(data?: LabsTokenData) {
  const type = String(data?.attributes.Type ?? '').toLowerCase()
  if (type === 'cd' || type.includes('cd')) return 'CDs'
  if (type.includes('portrait')) return 'Portraits'
  return 'All'
}

export function __resetLabsStoreForTests() {
  labsAddressPromise = undefined
  ownedLabsInflight.clear()
  ownedLabsCache.clear()
  ownedLabsSources.clear()
  stopLabsTransferWatch?.()
  stopLabsTransferWatch = undefined
}
