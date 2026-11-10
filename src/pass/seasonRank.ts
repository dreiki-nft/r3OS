/**
 * Where a wallet stands, season by season, for My Pass: its rank by paints among community painters in each
 * season (public/season/painters.json for season 1, painters-N.json for season N; written by
 * `npm run season:refresh` with builder, guest, anon and AI agent wallets left out, the same as the README
 * numbers) and its Storm Season tickets (public/storms/season-1.json). All static files, each fetched once per
 * page.
 */
import { useEffect, useState } from 'react'

export type PaintersFile = { season?: number; asOf?: string; painters: { address: string; rank: number }[] }
type Storms = { wallets: { address: string; tickets: number }[] }

/** Seasons as people count them (1 = the first). */
export type SeasonPainters = { season: number; file: PaintersFile }

/** The probe for season files stops at the first missing one, and never goes past this many. */
export const MAX_SEASON_FILES = 50

/** Season 1 keeps the path it has always had; later seasons get their number. */
export function paintersPath(season: number) {
  return season === 1 ? '/season/painters.json' : `/season/painters-${season}.json`
}

const cache = new Map<string, Promise<unknown>>()
function load<T>(path: string): Promise<T | undefined> {
  if (!cache.has(path))
    cache.set(
      path,
      fetch(path, { cache: 'no-cache' })
        .then((response) => (response.ok ? response.json() : undefined))
        // A missing file can come back as the app's index.html: that fails to parse and counts as missing.
        .catch(() => undefined),
    )
  return cache.get(path) as Promise<T | undefined>
}

const isPainters = (value: unknown): value is PaintersFile =>
  !!value && Array.isArray((value as PaintersFile).painters)

let seasonsPromise: Promise<SeasonPainters[]> | undefined
/** Every season's painters file that exists, oldest first (season 1, 2, …, up to the first gap). */
export function loadSeasonPainters(): Promise<SeasonPainters[]> {
  seasonsPromise ??= (async () => {
    const out: SeasonPainters[] = []
    for (let season = 1; season <= MAX_SEASON_FILES; season++) {
      const file = await load<unknown>(paintersPath(season))
      if (!isPainters(file)) break
      out.push({ season, file })
    }
    return out
  })()
  return seasonsPromise
}

export type SeasonRank = { season: number; rank?: number; of: number }
/** `seasons` newest first. */
export type SeasonStanding = { seasons: SeasonRank[]; tickets: number }

export function standingFor(
  address: string,
  seasons: SeasonPainters[] = [],
  storms?: Storms,
): SeasonStanding {
  const lower = address.toLowerCase()
  const ticket = storms?.wallets?.find((entry) => entry.address.toLowerCase() === lower)
  return {
    seasons: [...seasons]
      .sort((a, b) => b.season - a.season)
      .map(({ season, file }) => ({
        season,
        rank: file.painters.find((entry) => entry.address.toLowerCase() === lower)?.rank,
        of: file.painters.length,
      })),
    tickets: ticket?.tickets ?? 0,
  }
}

export function useSeasonStanding(address?: string) {
  const [standing, setStanding] = useState<SeasonStanding>()
  useEffect(() => {
    if (!address) return setStanding(undefined)
    let live = true
    void Promise.all([loadSeasonPainters(), load<Storms>('/storms/season-1.json')]).then(
      ([seasons, storms]) => live && setStanding(standingFor(address, seasons, storms)),
    )
    return () => {
      live = false
    }
  }, [address])
  return standing
}

/** The cells My Pass shows: the newest two seasons' ranks (one placeholder while the files load). */
export function rankCells(standing?: SeasonStanding): [label: string, value: string][] {
  const seasons = standing?.seasons.slice(0, 2) ?? []
  if (!seasons.length) return [['SEASON RANK', '—']]
  return seasons.map(({ season, rank, of }) => [`SEASON ${season} RANK`, rank ? `#${rank} of ${of}` : '—'])
}
