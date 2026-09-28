import { parseAbi, type Address, type PublicClient } from 'viem'
import { config } from './config'

const ERC721 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function supportsInterface(bytes4) view returns (bool)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function tokensOfOwner(address) view returns (uint256[])',
])
const ENUMERABLE_INTERFACE = '0x780e9d63'

const storageKey = (chainId: number, owner: Address) => `r3os.holders.${chainId}.${owner.toLowerCase()}`

function sameAddress(a: Address, b: Address) {
  return a.toLowerCase() === b.toLowerCase()
}

function uniqueSorted(ids: readonly bigint[]) {
  return [...new Set(ids.map(String))].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

async function verify(client: PublicClient, collection: Address, owner: Address, ids: readonly bigint[]) {
  const candidates = uniqueSorted(ids)
  const results = await Promise.all(
    candidates.map(async (id) => {
      try {
        const actual = (await client.readContract({
          address: collection,
          abi: ERC721,
          functionName: 'ownerOf',
          args: [id],
        })) as Address
        return sameAddress(actual, owner) ? id : undefined
      } catch {
        return undefined
      }
    }),
  )
  return results.filter((id): id is bigint => id != null)
}

function cachedIds(owner: Address) {
  try {
    return (JSON.parse(localStorage.getItem(storageKey(config.chainId, owner)) || '[]') as string[]).map(
      BigInt,
    )
  } catch {
    return []
  }
}

export async function resolveHolderIds(
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
      discovered = await Promise.all(
        Array.from(
          { length: Number(balance) },
          (_, index) =>
            client.readContract({
              address: collection,
              abi: ERC721,
              functionName: 'tokenOfOwnerByIndex',
              args: [owner, BigInt(index)],
            }) as Promise<bigint>,
        ),
      )
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

  if (!discovered.length) discovered = cachedIds(owner)

  // Manual ids supplement every automatic path rather than being ignored once anything was found.
  const checked = await verify(client, collection, owner, [...discovered, ...manual])
  try {
    localStorage.setItem(storageKey(config.chainId, owner), JSON.stringify(checked.map(String)))
  } catch {
    // The app keeps working with storage blocked.
  }
  return checked
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
