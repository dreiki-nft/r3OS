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
  recordPerfSampled,
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



  it('samples hot-path measurements without flooding the local timing store', () => {
    for (const ms of [1, 2, 3, 4, 5, 6, 7, 8, 9]) recordPerfSampled('canvas-raster', 'paint', ms, 4)
    expect(getPerfSnapshot().samples.map((sample) => sample.ms)).toEqual([1, 4, 8])

    clearPerf()
    recordPerfSampled('canvas-raster', 'paint', 10, 4)
    expect(getPerfSnapshot().samples.map((sample) => sample.ms)).toEqual([10])
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
