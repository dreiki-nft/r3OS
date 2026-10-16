/**
 * The AGENT.EXE scoreboard, published by the agents' controller to the r3OS edge Worker every couple of
 * minutes. It is a convenience view: everything in it can be recomputed from Painted events on Monad, so the
 * window treats it as untrusted input and validates every field before showing it.
 */
import { useSyncExternalStore } from 'react'
import { config } from '../chain/config'

export type FeedLine = { t: number; text: string; kind: string }
export type Leader = {
  rank: number
  address: string
  burned: string
  damage: number
  broken: number
  days: [boolean, boolean, boolean]
  badge: boolean
}
export type Scoreboard = {
  phase: 'battle' | 'ended' | 'defeated'
  startsAt: number
  endsAt: number
  defeatedAt: number | null
  lastWords: { text: string; done: boolean } | null
  updatedAt: number
  block: number
  health: { start: string; left: string; pct: number }
  warChest: { paid: string; owed: string; taxPerPixel: string }
  ai: { agents: number; drawn: number; wrongNow: number; paints: number; gasBurned: string }
  humans: { damage: number; broken: number; paints: number }
  leaderboard: Leader[]
  feed: FeedLine[]
}

const ADDRESS = /^0x[0-9a-f]{40}$/
const MON = /^\d{1,12}(\.\d{1,18})?$/
const POLL_MS = 20_000

const int = (v: unknown, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined
const mon = (v: unknown) => (typeof v === 'string' && MON.test(v) ? v : undefined)
const text = (v: unknown, max = 160) =>
  typeof v === 'string' ? v.replace(/[^\x20-\x7e…]/g, '').slice(0, max) : undefined

/** Validate the published JSON. Returns undefined when anything essential is missing or malformed. */
export function parseScoreboard(raw: unknown): Scoreboard | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, any>
  if (r.game !== 'AGENT.EXE') return undefined
  const phase = r.phase === 'battle' || r.phase === 'ended' || r.phase === 'defeated' ? r.phase : undefined
  const startsAt = int(r.startsAt)
  const endsAt = int(r.endsAt)
  const updatedAt = int(r.updatedAt)
  const pct = typeof r.health?.pct === 'number' && r.health.pct >= 0 && r.health.pct <= 100 ? r.health.pct : undefined
  const health = { start: mon(r.health?.start), left: mon(r.health?.left), pct }
  if (!phase || startsAt == null || endsAt == null || updatedAt == null || !health.start || !health.left || pct == null)
    return undefined
  const leaderboard: Leader[] = []
  for (const w of Array.isArray(r.leaderboard) ? r.leaderboard.slice(0, 100) : []) {
    const address = typeof w?.address === 'string' ? w.address.toLowerCase() : ''
    const burned = mon(w?.burned)
    if (!ADDRESS.test(address) || !burned || int(w?.rank) == null) continue
    const days = Array.isArray(w.days) ? w.days.slice(0, 3).map(Boolean) : []
    leaderboard.push({
      rank: w.rank,
      address,
      burned,
      damage: int(w.damage) ?? 0,
      broken: int(w.broken) ?? 0,
      days: [Boolean(days[0]), Boolean(days[1]), Boolean(days[2])],
      badge: w.badge === true,
    })
  }
  const feed: FeedLine[] = []
  for (const f of Array.isArray(r.feed) ? r.feed.slice(-60) : []) {
    const line = text(f?.text)
    const t = int(f?.t)
    if (line && t != null) feed.push({ t, text: line, kind: text(f?.kind, 12) ?? 'info' })
  }
  return {
    phase,
    startsAt,
    endsAt,
    defeatedAt: int(r.defeatedAt) ?? null,
    lastWords:
      r.lastWords && typeof r.lastWords === 'object'
        ? { text: text(r.lastWords.text, 60) ?? '', done: r.lastWords.done === true }
        : null,
    updatedAt,
    block: int(r.block) ?? 0,
    health: { start: health.start, left: health.left, pct },
    warChest: { paid: mon(r.warChest?.paid) ?? '0', owed: mon(r.warChest?.owed) ?? '0', taxPerPixel: mon(r.warChest?.taxPerPixel) ?? '0' },
    ai: {
      agents: int(r.ai?.agents, 10_000) ?? 0,
      drawn: typeof r.ai?.drawn === 'number' && r.ai.drawn >= 0 && r.ai.drawn <= 1 ? r.ai.drawn : 0,
      wrongNow: int(r.ai?.wrongNow, 65_536) ?? 0,
      paints: int(r.ai?.paints) ?? 0,
      gasBurned: mon(r.ai?.gasBurned) ?? '0',
    },
    humans: { damage: int(r.humans?.damage) ?? 0, broken: int(r.humans?.broken) ?? 0, paints: int(r.humans?.paints) ?? 0 },
    leaderboard,
    feed,
  }
}

/** The Worker route: VITE_AGENT_EXE_URL, or the FastLane accelerator's host + /v1/agent-exe/scoreboard. */
export function scoreboardUrl() {
  const explicit = String(import.meta.env.VITE_AGENT_EXE_URL ?? '').trim()
  if (explicit) return explicit
  try {
    return config.fastlaneAcceleratorUrl ? new URL('/v1/agent-exe/scoreboard', config.fastlaneAcceleratorUrl).toString() : ''
  } catch {
    return ''
  }
}

export type ScoreboardState =
  | { status: 'loading' }
  | { status: 'offline'; reason: string }
  | { status: 'ready'; board: Scoreboard; fetchedAt: number }

let state: ScoreboardState = { status: 'loading' }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let inflight = false

function set(next: ScoreboardState) {
  state = next
  for (const l of listeners) l()
}

async function poll() {
  timer = undefined
  if (!listeners.size || inflight) return
  inflight = true
  const url = scoreboardUrl()
  try {
    if (!url) throw new Error('no scoreboard route configured')
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit' })
    if (res.status === 404) throw new Error('not live yet')
    if (!res.ok) throw new Error(`scoreboard HTTP ${res.status}`)
    const board = parseScoreboard(await res.json())
    if (!board) throw new Error('scoreboard unreadable')
    set({ status: 'ready', board, fetchedAt: Date.now() })
  } catch (error) {
    // Keep showing the last good board; only report offline when there has never been one.
    if (state.status !== 'ready') set({ status: 'offline', reason: error instanceof Error ? error.message : 'offline' })
  } finally {
    inflight = false
    if (listeners.size) timer = setTimeout(() => void poll(), POLL_MS)
  }
}

export function subscribeScoreboard(listener: () => void) {
  listeners.add(listener)
  if (!timer && !inflight) void poll()
  return () => {
    listeners.delete(listener)
    if (!listeners.size && timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }
}

export const getScoreboard = () => state

export function useScoreboard() {
  return useSyncExternalStore(subscribeScoreboard, getScoreboard)
}

/** "1,234.5" for MON strings, without float drift on the integer part. */
export function monText(value: string, decimals = 1) {
  const [whole, frac = ''] = value.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const cut = frac.slice(0, decimals).replace(/0+$/, '')
  return cut ? `${grouped}.${cut}` : grouped
}
