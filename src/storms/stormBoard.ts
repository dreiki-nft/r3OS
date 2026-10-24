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

/** Average Monad block time over season 1 so far (blocks 111,020,589 → 116,200,735): forecasts days ahead. */
export const AVG_BLOCK_MS = 302.3

/** A known block and its timestamp (block 116,200,735, Oct 24 2026 13:55:27 UTC) for when the chain isn't reachable. */
const ANCHOR_BLOCK = 116_200_735n
const ANCHOR_MS = 1_792_850_127_000

/** The head block estimated from the clock, used only until the real head arrives. */
export function estimatedHead(nowMs: number) {
  return ANCHOR_BLOCK + BigInt(Math.max(0, Math.floor((nowMs - ANCHOR_MS) / AVG_BLOCK_MS)))
}

/** The season storms still to come, with an estimated start time from the current block. */
export function upcomingStorms(
  head: bigint,
  nowMs: number,
  firstStorm = SEASON_FIRST_STORM,
  total = SEASON_STORMS,
) {
  const out: { number: number; start: bigint; at: number }[] = []
  for (let n = 1; n <= total; n++) {
    const start = firstStorm + BigInt(n - 1) * STORM_PERIOD
    if (start + 600n <= head) continue
    out.push({ number: n, start, at: nowMs + Number(start - head) * AVG_BLOCK_MS })
  }
  return out
}

const icsTime = (ms: number) =>
  new Date(Math.round(ms / 60_000) * 60_000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

/**
 * A calendar file with every storm still to come. Times are estimates (block speed drifts a little over days),
 * so each event opens 10 minutes early and runs 20 minutes, with a reminder and the live countdown link.
 */
export function stormsIcs(storms: { number: number; start: bigint; at: number }[], nowMs: number) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//r3OS//Storm Chasers//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:r3OS storms',
  ]
  for (const storm of storms) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:storm-${storm.number}-${storm.start}@r3os.app`,
      `DTSTAMP:${icsTime(nowMs)}`,
      `DTSTART:${icsTime(storm.at - 10 * 60_000)}`,
      `DTEND:${icsTime(storm.at + 10 * 60_000)}`,
      `SUMMARY:⚡ r3OS storm ${storm.number} of ${SEASON_STORMS}`,
      `DESCRIPTION:Paint 1 pixel during the storm = 1 ticket for the end-of-season r3tard raffle. Block ${storm.start.toLocaleString('en-US')}\\, the time is an estimate: live countdown at https://r3os.app/#/storms`,
      'URL:https://r3os.app/#/storms',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:r3OS storm ${storm.number} soon`,
      'TRIGGER:-PT5M',
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  // RFC 5545: lines over 75 octets are folded (CRLF + a space). 60 characters keeps multi-byte ⚡ safe.
  const fold = (line: string) => line.match(/.{1,60}/gu)?.join('\r\n ') ?? line
  return lines.map(fold).join('\r\n') + '\r\n'
}
