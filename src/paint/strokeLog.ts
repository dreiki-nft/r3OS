/**
 * Why strokes didn't land: a small local log for DXDIAG, so a "Live Mode wouldn't paint" report comes with the
 * exact reason instead of a guess. Kept in this browser only (last 20 entries, survives a reload so logging out
 * and back in doesn't wipe it); nothing is uploaded. Messages are friendly error text with URLs and 32-byte hex stripped, so no RPC URL or key
 * can end up in the log or in a copied report.
 */
import { screenSafeMessage } from '../chain/errors'

export type StrokeIssueKind = 'failed' | 'retrying' | 'dropped' | 'held'
export type StrokeIssue = {
  at: number
  block: string
  storm: boolean
  live: boolean
  px: number
  kind: StrokeIssueKind
  reason: string
}

const KEY = 'r3os.strokeIssues.v1'
const MAX = 20
type Listener = () => void
const listeners = new Set<Listener>()
let entries: StrokeIssue[] = load()
let snapshot = { entries }

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function load(): StrokeIssue[] {
  try {
    const raw = JSON.parse(storage()?.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((row) => row && typeof row.reason === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function recordStrokeIssue(issue: Omit<StrokeIssue, 'at' | 'reason'> & { reason: unknown }) {
  const text = typeof issue.reason === 'string' ? issue.reason : screenSafeMessage(issue.reason)
  const reason = text
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/0x[0-9a-fA-F]{64}/g, '[hex]')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
  const row: StrokeIssue = { ...issue, reason, at: Date.now() }
  // A held stroke is re-checked often; keep one row per stretch instead of flooding the log.
  const first = entries[0]
  if (first && first.kind === row.kind && first.reason === row.reason && row.at - first.at < 30_000) {
    entries = [
      { ...first, px: Math.max(first.px, row.px), block: row.block, at: row.at },
      ...entries.slice(1),
    ]
  } else {
    entries = [row, ...entries].slice(0, MAX)
  }
  snapshot = { entries }
  try {
    storage()?.setItem(KEY, JSON.stringify(entries))
  } catch {
    // storage full or blocked: the in-memory log still works for this page
  }
  for (const listener of listeners) listener()
}

export function getStrokeIssues() {
  return snapshot
}

export function subscribeStrokeIssues(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function formatStrokeIssues(rows: readonly StrokeIssue[]) {
  if (!rows.length) return 'PAINT PROBLEMS\nnone recorded in this browser'
  return [
    'PAINT PROBLEMS',
    'strokes that failed, were retried, came off the canvas or were held back; newest first',
    ...rows.map(
      (row) =>
        `${new Date(row.at).toISOString().slice(5, 19).replace('T', ' ')} UTC · block ${row.block}${row.storm ? ' · STORM' : ''} · ${row.live ? 'live' : 'wallet'} · ${row.px} px · ${row.kind} · ${row.reason}`,
    ),
  ].join('\n')
}

export function __resetStrokeIssuesForTests() {
  entries = []
  snapshot = { entries }
  try {
    storage()?.removeItem(KEY)
  } catch {
    // ignore
  }
}
