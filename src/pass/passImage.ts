/**
 * The connected wallet's Painter Pass picture (the onchain SVG from tokenURI), for places outside My Pass
 * that want to show it, like the Quests header. Read-only; cached per pass and per caller-supplied state key
 * (the picture changes when stats or quest counts change).
 */
import type { Address } from 'viem'
import { publicClient } from '../chain/clients'
import { decodeJsonDataUri } from '../lib/dataUri'
import { R3OS_PAINTER_PASS_ABI } from '../lib/generated/abi'
import { readPassCoreIdentity } from './passData'

const memory = new Map<string, Promise<string | undefined>>()

export function readPassImage(owner: Address, stateKey = ''): Promise<string | undefined> {
  const client = publicClient
  if (!client) return Promise.resolve(undefined)
  return readPassCoreIdentity(owner).then(({ passAddress, passId }) => {
    if (!passAddress || !passId) return undefined
    const key = `${passAddress}:${passId}:${stateKey}`
    let pending = memory.get(key)
    if (!pending) {
      pending = (
        client.readContract({
          address: passAddress,
          abi: R3OS_PAINTER_PASS_ABI,
          functionName: 'tokenURI',
          args: [passId],
        }) as Promise<string>
      )
        .then((uri) => decodeJsonDataUri<{ image?: string }>(uri).image)
        .catch(() => {
          memory.delete(key)
          return undefined
        })
      memory.set(key, pending)
    }
    return pending
  })
}
