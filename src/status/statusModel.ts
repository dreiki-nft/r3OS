/**
 * r3OS Status: one plain answer to "is r3OS working right now?", from what this browser already sees
 * (the block clock, the action RPC pool, recent paints) plus two small public files for data freshness.
 * Pure helpers here so the thresholds are tested. Never shows an RPC URL: endpoints are counted, not named.
 */
import type { ActionRpcEndpointState } from '../chain/actionRpc'

export type Level = 'ok' | 'degraded' | 'down' | 'starting'

/** How old the newest block this browser has seen is: Monad makes one about every 0.3 s. */
export function chainLevel(blockAgeMs: number | undefined, mode: string): Level {
  if (blockAgeMs == null) return mode === 'offline' ? 'down' : 'starting'
  if (blockAgeMs > 60_000) return 'down'
  if (blockAgeMs > 10_000 || mode === 'polling') return 'degraded'
  return 'ok'
}

export function rpcSummary(endpoints: readonly ActionRpcEndpointState[], now = Date.now()) {
  const measured = endpoints.filter((endpoint) => endpoint.samples > 0)
  const failing = endpoints.filter(
    (endpoint) =>
      (endpoint.cooldownUntil != null && endpoint.cooldownUntil > now) || endpoint.consecutiveFailures > 0,
  )
  const healthy = measured.filter((endpoint) => !failing.includes(endpoint))
  const latencies = healthy.map((endpoint) => endpoint.ewmaMs).filter((ms): ms is number => ms != null)
  const best = latencies.length ? Math.min(...latencies) : undefined
  const level: Level = !endpoints.length
    ? 'down'
    : !measured.length
      ? 'starting'
      : !healthy.length
        ? 'down'
        : failing.length
          ? 'degraded'
          : 'ok'
  return { total: endpoints.length, healthy: healthy.length, failing: failing.length, best, level }
}

const ORDER: Level[] = ['ok', 'starting', 'degraded', 'down']
export function overall(levels: Level[]): Level {
  return levels.reduce((worst, level) => (ORDER.indexOf(level) > ORDER.indexOf(worst) ? level : worst), 'ok')
}

export const LEVEL_TEXT: Record<Level, string> = {
  ok: 'All systems normal',
  starting: 'Connecting…',
  degraded: 'Working, but slower than usual',
  down: 'Having trouble reaching Monad',
}

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${m % 60} min ago`
  return `${Math.floor(h / 24)} days ago`
}
