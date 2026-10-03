export type PerfKind =
  | 'quote'
  | 'tx-prewallet'
  | 'tx-wallet'
  | 'tx-submit'
  | 'tx-receipt'
  | 'tx-total'
  | 'program-open'
  | 'ui-settle'

export interface PerfSample {
  id: number
  kind: PerfKind
  label: string
  ms: number
  at: number
}

export interface PerfSummaryRow {
  key: string
  kind: PerfKind
  label: string
  count: number
  last: number
  p50: number
  p95: number
  max: number
}

export interface PerfSnapshot {
  version: number
  samples: readonly PerfSample[]
}

type Listener = () => void

const MAX_SAMPLES = 240
let nextId = 1
let snapshot: PerfSnapshot = { version: 0, samples: [] }
const listeners = new Set<Listener>()
const pendingProgramOpen = new Map<string, number>()

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function emit(samples: readonly PerfSample[]) {
  snapshot = { version: snapshot.version + 1, samples }
  for (const listener of listeners) listener()
}

export function recordPerf(kind: PerfKind, label: string, ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return
  const sample: PerfSample = {
    id: nextId++,
    kind,
    label: label.slice(0, 80),
    ms,
    at: Date.now(),
  }
  emit([...snapshot.samples.slice(-(MAX_SAMPLES - 1)), sample])
}

export function startPerf(kind: PerfKind, label: string) {
  const started = now()
  return () => {
    const ms = now() - started
    recordPerf(kind, label, ms)
    return ms
  }
}

export function markProgramOpen(id: string) {
  pendingProgramOpen.set(id, now())
}

export function markProgramMounted(id: string) {
  const started = pendingProgramOpen.get(id)
  if (started == null) return
  pendingProgramOpen.delete(id)
  recordPerf('program-open', id, now() - started)
}

export function getPerfSnapshot() {
  return snapshot
}

export function subscribePerf(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearPerf() {
  pendingProgramOpen.clear()
  emit([])
}

function percentile(sorted: readonly number[], fraction: number) {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

export function summarizePerf(samples: readonly PerfSample[]): PerfSummaryRow[] {
  const grouped = new Map<string, PerfSample[]>()
  for (const sample of samples) {
    const key = `${sample.kind}:${sample.label}`
    const row = grouped.get(key)
    if (row) row.push(sample)
    else grouped.set(key, [sample])
  }

  return [...grouped.entries()]
    .map(([key, rows]) => {
      const values = rows.map((row) => row.ms).sort((a, b) => a - b)
      return {
        key,
        kind: rows[0].kind,
        label: rows[0].label,
        count: rows.length,
        last: rows.at(-1)!.ms,
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        max: values.at(-1)!,
      }
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
}

export function formatPerfReport(input: PerfSnapshot = snapshot) {
  const rows = summarizePerf(input.samples)
  if (!rows.length) return 'PERFORMANCE\nno local measurements yet'
  return [
    'PERFORMANCE',
    'local browser timings only; no telemetry is uploaded',
    ...rows.map(
      (row) =>
        `${row.kind} · ${row.label}: n=${row.count} last=${row.last.toFixed(0)}ms p50=${row.p50.toFixed(0)}ms p95=${row.p95.toFixed(0)}ms max=${row.max.toFixed(0)}ms`,
    ),
  ].join('\n')
}

export function __resetPerfForTests() {
  nextId = 1
  pendingProgramOpen.clear()
  snapshot = { version: 0, samples: [] }
  listeners.clear()
}
