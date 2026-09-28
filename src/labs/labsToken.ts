import { parseAbiItem, type Address } from 'viem'
import { decodeJsonDataUri } from '../lib/dataUri'
import { publicClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { R3TARDS_FLIPBOOK_ABI, R3TARDS_LABS_ABI } from '../lib/generated/abi'

export type LabsAttributeValue = string | number | boolean
export interface LabsTokenData {
  name: string
  image: string
  attributes: Record<string, LabsAttributeValue>
}

type RawAttribute = { trait_type?: unknown; value?: unknown }
type RawToken = { name?: unknown; image?: unknown; attributes?: unknown }
const cache = new Map<string, LabsTokenData>()
let labsAddressPromise: Promise<Address> | undefined

function attributeMap(raw: unknown): Record<string, LabsAttributeValue> {
  const result: Record<string, LabsAttributeValue> = {}
  if (!Array.isArray(raw)) return result
  for (const item of raw as RawAttribute[]) {
    if (typeof item?.trait_type !== 'string') continue
    const value = item.value
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[item.trait_type] = value
    }
  }
  return result
}

export function decodeLabsTokenUri(uri: string): LabsTokenData {
  const raw = decodeJsonDataUri<RawToken>(uri)
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    image: typeof raw.image === 'string' ? raw.image : '',
    attributes: attributeMap(raw.attributes),
  }
}

async function labsAddress() {
  if (labsAddressPromise) return labsAddressPromise
  labsAddressPromise = (async () => {
    if (!publicClient) throw new Error('DEMO_MODE')
    const flipbook = (await discoverContracts()).labs.flipbook
    if (!flipbook) throw new Error("this Lab isn't deployed on this network")
    return (await publicClient.readContract({
      address: flipbook,
      abi: R3TARDS_FLIPBOOK_ABI,
      functionName: 'LABS',
    })) as Address
  })()
  return labsAddressPromise
}

async function latestMetadataUpdateBlock(labs: Address, id: bigint) {
  if (!publicClient) return 0n
  const event = parseAbiItem('event MetadataUpdate(uint256 _tokenId)')
  const logs = await publicClient.getLogs({
    address: labs,
    event,
    fromBlock: 0n,
    toBlock: 'latest',
  })
  const matching = logs.filter((log) => BigInt((log.args as { _tokenId?: bigint })._tokenId ?? -1n) === id)
  return matching.at(-1)?.blockNumber ?? 0n
}

export async function readLabsToken(id: bigint, knownMetadataUpdateBlock?: bigint) {
  if (!publicClient) throw new Error('DEMO_MODE')
  const labs = await labsAddress()
  const metadataUpdateBlock = knownMetadataUpdateBlock ?? (await latestMetadataUpdateBlock(labs, id))
  const key = `${id}:${metadataUpdateBlock}`
  const hit = cache.get(key)
  if (hit) return hit
  const uri = (await publicClient.readContract({
    address: labs,
    abi: R3TARDS_LABS_ABI,
    functionName: 'tokenURI',
    args: [id],
  })) as string
  const data = decodeLabsTokenUri(uri)
  cache.set(key, data)
  return data
}

export function __clearLabsTokenCacheForTests() {
  cache.clear()
  labsAddressPromise = undefined
}
