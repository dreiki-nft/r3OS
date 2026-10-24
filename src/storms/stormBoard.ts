/**
 * Storm Chasers leaderboard data: public/storms/season-1.json, written by `scripts/storm-chasers.mjs --public`
 * after each storm (the same counts the raffle loads). Pure helpers so the window stays simple and tested.
 */
export const STORM_PERIOD = 200_000n
export const SEASON_FIRST_STORM = 115_400_000n
export const SEASON_STORMS = 21

export type BoardWallet = { address: string; tickets: number; storms?: number[] }
export type BoardRow = BoardWallet & { rank: number }
export type Board = {
  updatedAt?: string
  totalStorms: number
  storms: { number: number; start: string; painters: number }[]
  wallets: BoardWallet[]
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export function parseBoard(value: unknown): Board {
  const raw = value as Partial<Board> | null
  if (!raw || !Array.isArray(raw.storms) || !Array.isArray(raw.wallets)) throw new Error('bad storm board')
  const wallets = raw.wallets
    .filter(
      (row) => row && ADDRESS.test(String(row.address)) && Number.isInteger(row.tickets) && row.tickets > 0,
    )
    .map((row) => ({
      address: String(row.address),
      tickets: Number(row.tickets),
      storms: Array.isArray(row.storms) ? row.storms.filter(Number.isInteger) : undefined,
    }))
  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    totalStorms: Number.isInteger(raw.totalStorms) ? Number(raw.totalStorms) : SEASON_STORMS,
    storms: raw.storms
      .filter((storm) => storm && Number.isInteger(storm.number))
      .map((storm) => ({
        number: storm.number,
        start: String(storm.start),
        painters: Number(storm.painters) || 0,
      })),
    wallets,
  }
}

/** Most tickets first, numbered 1, 2, 3… (ties keep address order). */
export function rankBoard(wallets: BoardWallet[]): BoardRow[] {
  return [...wallets]
    .sort((a, b) => b.tickets - a.tickets || (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
    .map((row, i) => ({ ...row, rank: i + 1 }))
}

export function findWallet(rows: BoardRow[], address?: string | null) {
  if (!address) return undefined
  const lower = address.trim().toLowerCase()
  return rows.find((row) => row.address.toLowerCase() === lower)
}

export function isAddress(text: string) {
  return ADDRESS.test(text.trim())
}

/** Season storm number (1-21) for a storm's start block, or undefined outside the season. */
export function stormNumber(start: bigint) {
  if (start < SEASON_FIRST_STORM || start % STORM_PERIOD !== 0n) return undefined
  const number = Number((start - SEASON_FIRST_STORM) / STORM_PERIOD) + 1
  return number <= SEASON_STORMS ? number : undefined
}

/** The storm happening at `block`, or the next one: its start block and season number (if in the season). */
export function currentOrNextStorm(block: bigint, length = 600n) {
  const offset = block % STORM_PERIOD
  const start = offset < length ? block - offset : block - offset + STORM_PERIOD
  return { start, number: stormNumber(start), now: offset < length }
}
