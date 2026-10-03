import { parseAbi, type Address, type PublicClient } from 'viem'
import { config } from './config'
import { readManyUsing, type ReadManyResult } from './readMany'

const ERC721 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function supportsInterface(bytes4) view returns (bool)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function tokensOfOwner(address) view returns (uint256[])',
])
const ENUMERABLE_INTERFACE = '0x780e9d63'

const storageKey = (chainId: number, collection: Address, owner: Address) =>
  `r3os.holders.${chainId}.${collection.toLowerCase()}.${owner.toLowerCase()}`

const inFlight = new Map<string, Promise<bigint[]>>()
const resolved = new Map<string, { ids: bigint[]; at: number }>()
const FRESH_MS = 8_000

function sameAddress(a: Address, b: Address) {
  return a.toLowerCase() === b.toLowerCase()
}

function uniqueSorted(ids: readonly bigint[]) {
  return [...new Set(ids.map(String))].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

async function verify(client: PublicClient, collection: Address, owner: Address, ids: readonly bigint[]) {
  const candidates = uniqueSorted(ids)
  if (!candidates.length) return []
  const rows = (await readManyUsing(
    client,
    candidates.map((id) => ({ address: collection, abi: ERC721, functionName: 'ownerOf', args: [id] })),
    { allowFailure: true, multicallAddress: config.multicall3Address },
  )) as ReadManyResult[]
  return candidates.filter((_, index) => {
    const row = rows[index]
    return row?.status === 'success' && sameAddress(row.result as Address, owner)
  })
}

function cachedIds(collection: Address, owner: Address) {
  try {
    return (JSON.parse(localStorage.getItem(storageKey(config.chainId, collection, owner)) || '[]') as string[]).map(
      BigInt,
    )
  } catch {
    return []
  }
}

async function resolveHolderIdsNow(
  client: PublicClient,
  collection: Address,
  owner: Address,
  manual: bigint[] = [],
  fetcher: typeof fetch = fetch,
) {
  const balance = (await client.readContract({
    address: collection,
    abi: ERC721,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint
  if (balance === 0n) return []

  let discovered: bigint[] = []
  try {
    const enumerable = (await client.readContract({
      address: collection,
      abi: ERC721,
      functionName: 'supportsInterface',
      args: [ENUMERABLE_INTERFACE],
    })) as boolean
    if (enumerable) {
      discovered = (await readManyUsing(
        client,
        Array.from({ length: Number(balance) }, (_, index) => ({
          address: collection,
          abi: ERC721,
          functionName: 'tokenOfOwnerByIndex',
          args: [owner, BigInt(index)],
        })),
        { allowFailure: false, multicallAddress: config.multicall3Address },
      )) as bigint[]
    }
  } catch {
    // Try the next strategy.
  }

  if (!discovered.length) {
    try {
      discovered = (await client.readContract({
        address: collection,
        abi: ERC721,
        functionName: 'tokensOfOwner',
        args: [owner],
      })) as bigint[]
    } catch {
      // Try the API/cache path.
    }
  }

  if (!discovered.length && config.nftApiUrl) {
    try {
      const response = await fetcher(config.nftApiUrl.replace('{owner}', owner))
      const json = (await response.json()) as { tokenIds?: (string | number)[] } | (string | number)[]
      discovered = (Array.isArray(json) ? json : (json.tokenIds ?? [])).map(BigInt)
    } catch {
      // Cache/manual ids still get a chance.
    }
  }

  if (!discovered.length) discovered = cachedIds(collection, owner)

  // Manual ids supplement every automatic path rather than being ignored once anything was found.
  const checked = await verify(client, collection, owner, [...discovered, ...manual])
  try {
    localStorage.setItem(storageKey(config.chainId, collection, owner), JSON.stringify(checked.map(String)))
  } catch {
    // The app keeps working with storage blocked.
  }
  return checked
}

export async function resolveHolderIds(
  client: PublicClient,
  collection: Address,
  owner: Address,
  manual: bigint[] = [],
  fetcher: typeof fetch = fetch,
) {
  const manualKey = uniqueSorted(manual).map(String).join(',')
  const key = `${config.chainId}:${collection.toLowerCase()}:${owner.toLowerCase()}:${manualKey}`
  const cached = resolved.get(key)
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.ids
  const active = inFlight.get(key)
  if (active) return active
  const pending = resolveHolderIdsNow(client, collection, owner, manual, fetcher)
    .then((ids) => {
      resolved.set(key, { ids, at: Date.now() })
      return ids
    })
    .finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key)
    })
  inFlight.set(key, pending)
  return pending
}

export function __resetHolderResolutionForTests() {
  inFlight.clear()
  resolved.clear()
}

export function parseManualIds(value: string) {
  return [...new Set((value.match(/\d+/g) ?? []).map(BigInt))]
}

export function choosePassDisplay(owned: bigint[], stored: string | null) {
  if (stored === 'none') return null
  const storedId = stored && /^\d+$/.test(stored) ? BigInt(stored) : undefined
  if (storedId != null && owned.includes(storedId)) return storedId
  return [...owned].sort((a, b) => (a < b ? -1 : 1))[0] ?? null
}
