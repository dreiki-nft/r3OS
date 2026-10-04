import type { Address } from 'viem'
import { decodeJsonDataUri } from '../lib/dataUri'
import { publicClient, wsClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { readHeavy } from '../chain/readMany'
import { R3OS_FLIPBOOK_ABI, R3OS_LABS_ABI } from '../lib/generated/abi'

export type LabsAttributeValue = string | number | boolean
export interface LabsTokenData {
  name: string
  image: string
  attributes: Record<string, LabsAttributeValue>
}

type RawAttribute = { trait_type?: unknown; value?: unknown }
type RawToken = { name?: unknown; image?: unknown; attributes?: unknown }
type CacheEntry = { data: LabsTokenData; expiresAt: number }

const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, CacheEntry>()
let labsAddressPromise: Promise<Address> | undefined
let stopMetadataWatch: (() => void) | undefined

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
    const result = await readHeavy([{ address: flipbook, abi: R3OS_FLIPBOOK_ABI, functionName: 'LABS' }])
    if (result[0]?.status !== 'success') throw result[0]?.error ?? new Error('LABS_UNAVAILABLE')
    return result[0].result as Address
  })()
  return labsAddressPromise
}

function ensureMetadataWatch(labs: Address) {
  if (!wsClient || stopMetadataWatch) return
  stopMetadataWatch = wsClient.watchContractEvent({
    address: labs,
    abi: R3OS_LABS_ABI,
    eventName: 'MetadataUpdate',
    onLogs: (logs) => {
      for (const log of logs) {
        const id = (log.args as { _tokenId?: bigint })._tokenId
        if (id != null) invalidateLabsToken(id)
      }
    },
  })
}

export function invalidateLabsToken(id: bigint) {
  const prefix = `${id}:`
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

export async function readLabsToken(id: bigint, version: string | number | bigint = '') {
  if (!publicClient) throw new Error('DEMO_MODE')
  const labs = await labsAddress()
  ensureMetadataWatch(labs)
  const key = `${id}:${version}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.data
  const result = await readHeavy([
    { address: labs, abi: R3OS_LABS_ABI, functionName: 'tokenURI', args: [id] },
  ])
  if (result[0]?.status !== 'success') throw result[0]?.error ?? new Error('TOKEN_URI_UNAVAILABLE')
  const data = decodeLabsTokenUri(String(result[0].result))
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

export function __clearLabsTokenCacheForTests() {
  cache.clear()
  labsAddressPromise = undefined
  stopMetadataWatch?.()
  stopMetadataWatch = undefined
}
