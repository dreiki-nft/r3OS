import { describe, expect, it } from 'vitest'
import { candidateUrls, resolveTokenImage, scatterImageUrl } from './r3tardImages'

const G = ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/', 'https://w3s.link/ipfs/']
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

describe('r3tard images', () => {
  it('builds one URL per gateway for ipfs URIs, including the old ipfs://ipfs/ form', () => {
    expect(candidateUrls('ipfs://Qm1/904', G)).toEqual(G.map((g) => `${g}Qm1/904`))
    expect(candidateUrls('ipfs://ipfs/Qm1/904', G)[0]).toBe('https://ipfs.io/ipfs/Qm1/904')
    expect(candidateUrls('https://example.com/904.json', G)).toEqual(['https://example.com/904.json'])
  })

  it('falls back to the next gateway and serves the image through the one that worked', async () => {
    const seen: string[] = []
    const fetcher = async (url: string) => {
      seen.push(url)
      if (url.startsWith('https://ipfs.io/')) throw new Error('429')
      return json({ image: 'ipfs://QmImg/904.png' })
    }
    const image = await resolveTokenImage('ipfs://QmMeta/904', fetcher as never)
    expect(seen).toEqual(['https://ipfs.io/ipfs/QmMeta/904', 'https://dweb.link/ipfs/QmMeta/904'])
    expect(image).toBe('https://dweb.link/ipfs/QmImg/904.png')
  })

  it('gives up quietly when no gateway answers', async () => {
    const fetcher = async () => json({}, false)
    expect(await resolveTokenImage('ipfs://QmMeta/904', fetcher as never)).toBe('')
  })
})

describe('Scatter images for mainnet r3tards', () => {
  const R3 = '0x200723A706de0013316E5cd8EBa2b3f53DD90c29'
  it('uses Scatter for mainnet r3tards 1–1033', () => {
    expect(scatterImageUrl(904n, R3, 143)).toBe(
      'https://www.scatter.art/api/instareveal/image?collectionId=mfrvr5upu9925ja07o6ckk6v&tokenId=904',
    )
    expect(scatterImageUrl(1n, R3, 143)).toContain('tokenId=1')
    expect(scatterImageUrl(1033n, R3, 143)).toContain('tokenId=1033')
  })

  it('never builds a Scatter URL for other ids, collections or chains', () => {
    expect(scatterImageUrl(0n, R3, 143)).toBe('')
    expect(scatterImageUrl(1034n, R3, 143)).toBe('')
    expect(scatterImageUrl(904n, '0x0000000000000000000000000000000000000001', 143)).toBe('')
    expect(scatterImageUrl(904n, R3, 10143)).toBe('')
    expect(scatterImageUrl(904n, undefined, 143)).toBe('')
  })
})
