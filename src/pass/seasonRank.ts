/**
 * Where a wallet stands in the season, for My Pass: its rank by paints among community painters
 * (public/season/painters.json, written by `npm run season:refresh` with builder, guest and anon wallets left
 * out, the same as the README numbers) and its Storm Season tickets (public/storms/season-1.json).
 * Both are static files; each is fetched once per page.
 */
import { useEffect, useState } from 'react'

type Painters = { painters: { address: string; rank: number }[] }
type Storms = { wallets: { address: string; tickets: number }[] }

const cache = new Map<string, Promise<unknown>>()
function load<T>(path: string): Promise<T | undefined> {
  if (!cache.has(path))
    cache.set(
      path,
      fetch(path, { cache: 'no-cache' })
        .then((response) => (response.ok ? response.json() : undefined))
        .catch(() => undefined),
    )
  return cache.get(path) as Promise<T | undefined>
}

export type SeasonStanding = { rank?: number; of?: number; tickets: number }

export function standingFor(address: string, painters?: Painters, storms?: Storms): SeasonStanding {
  const lower = address.toLowerCase()
  const row = painters?.painters?.find((entry) => entry.address.toLowerCase() === lower)
  const ticket = storms?.wallets?.find((entry) => entry.address.toLowerCase() === lower)
  return { rank: row?.rank, of: painters?.painters?.length, tickets: ticket?.tickets ?? 0 }
}

export function useSeasonStanding(address?: string) {
  const [standing, setStanding] = useState<SeasonStanding>()
  useEffect(() => {
    if (!address) return setStanding(undefined)
    let live = true
    void Promise.all([load<Painters>('/season/painters.json'), load<Storms>('/storms/season-1.json')]).then(
      ([painters, storms]) => live && setStanding(standingFor(address, painters, storms)),
    )
    return () => {
      live = false
    }
  }, [address])
  return standing
}
