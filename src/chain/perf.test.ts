import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPerfForTests,
  clearPerf,
  formatPerfReport,
  getPerfSnapshot,
  markProgramDataReady,
  markProgramMounted,
  markProgramOpen,
  recordPerf,
  summarizePerf,
} from './perf'

afterEach(() => {
  vi.restoreAllMocks()
  __resetPerfForTests()
})

describe('performance measurements', () => {
  it('keeps percentile summaries per kind and label', () => {
    for (const ms of [10, 20, 30, 40, 100]) recordPerf('quote', 'paint', ms)
    recordPerf('quote', 'mintFrame', 7)
    const rows = summarizePerf(getPerfSnapshot().samples)
    expect(rows.find((row) => row.key === 'quote:paint')).toMatchObject({
      count: 5,
      last: 100,
      p50: 30,
      p95: 100,
      max: 100,
    })
    expect(rows.find((row) => row.key === 'quote:mintFrame')?.p50).toBe(7)
  })

  it('measures first program open to mounted and ignores unmatched mounts', () => {
    let t = 100
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    markProgramMounted('paint')
    expect(getPerfSnapshot().samples).toHaveLength(0)
    markProgramOpen('paint')
    t = 137
    markProgramMounted('paint')
    t = 149
    markProgramDataReady('paint')
    expect(getPerfSnapshot().samples[0]).toMatchObject({ kind: 'program-open', label: 'paint', ms: 37 })
    expect(getPerfSnapshot().samples[1]).toMatchObject({ kind: 'program-ready', label: 'paint', ms: 49 })
  })

  it('clears samples and produces a copyable local-only report', () => {
    recordPerf('tx-receipt', 'paint', 250)
    expect(formatPerfReport()).toContain('tx-receipt · paint')
    expect(formatPerfReport()).toContain('no telemetry is uploaded')
    clearPerf()
    expect(getPerfSnapshot().samples).toHaveLength(0)
  })
})
