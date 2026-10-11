import { config } from '../chain/config'
import { decodeJsonDataUri } from '../lib/dataUri'

/** The r3tards collection on Monad mainnet and its Scatter image service (the same one the meme generator uses). */
export const MAINNET_R3TARDS = '0x200723a706de0013316e5cd8eba2b3f53dd90c29'
const SCATTER_COLLECTION_ID = 'mfrvr5upu9925ja07o6ckk6v'
export const R3TARD_MAX_ID = 1033n

/**
 * Scatter's rendered image for a mainnet r3tard, or '' when Scatter doesn't apply (another chain or
 * collection, or an id outside 1–1033). Shown in a plain <img>, never drawn into a canvas.
 */
export function scatterImageUrl(id: bigint, collection?: string, chainId = config.chainId) {
  if (chainId !== 143 || collection?.toLowerCase() !== MAINNET_R3TARDS) return ''
  if (id < 1n || id > R3TARD_MAX_ID) return ''
  return `https://www.scatter.art/api/instareveal/image?collectionId=${SCATTER_COLLECTION_ID}&tokenId=${id}`
}

/** Public IPFS gateways, tried in order. ipfs.io rate-limits and stalls often enough to need backups. */
export function ipfsGateways(primary = config.ipfsGateway) {
  return Array.from(new Set([primary, 'https://dweb.link/ipfs/', 'https://w3s.link/ipfs/']))
}

/** Every URL to try for a URI: one per gateway for ipfs:// (also the old ipfs://ipfs/<cid> form), else as is. */
export function candidateUrls(uri: string, gateways = ipfsGateways()) {
  if (!uri.startsWith('ipfs://')) return [uri]
  const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '')
  return gateways.map((gateway) => `${gateway}${path}`)
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/**
 * A token's image URL from its tokenURI. The image goes through the same gateway that answered for the
 * metadata, so a gateway that works for this browser is reused.
 */
export async function resolveTokenImage(tokenUri: string, fetcher: Fetcher = fetch, timeoutMs = 8_000) {
  if (tokenUri.startsWith('data:')) {
    const image = decodeJsonDataUri<{ image?: string }>(tokenUri).image
    return image ? candidateUrls(image)[0] : ''
  }
  const gateways = ipfsGateways()
  const urls = candidateUrls(tokenUri, gateways)
  for (let index = 0; index < urls.length; index++) {
    try {
      const response = await fetcher(urls[index], { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) continue
      const image = ((await response.json()) as { image?: unknown }).image
      if (typeof image !== 'string' || !image) return ''
      const gateway = tokenUri.startsWith('ipfs://') ? gateways[index] : gateways[0]
      return candidateUrls(image, [gateway, ...gateways.filter((g) => g !== gateway)])[0]
    } catch {
      // Try the next gateway.
    }
  }
  return ''
}
