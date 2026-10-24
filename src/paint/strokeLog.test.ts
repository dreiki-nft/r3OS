import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetStrokeIssuesForTests,
  formatStrokeIssues,
  getStrokeIssues,
  recordStrokeIssue,
} from './strokeLog'

const base = { block: '116200185', storm: true, live: true, px: 40 }

describe('stroke problems log', () => {
  beforeEach(() => __resetStrokeIssuesForTests())

  it('records why a stroke did not land, newest first, with the storm flag', () => {
    recordStrokeIssue({ ...base, kind: 'failed', reason: 'TileTooHot: tile 171 is too hot' })
    recordStrokeIssue({
      ...base,
      kind: 'held',
      reason: 'auto-paint is off: strokes wait for the Paint button',
    })
    const rows = getStrokeIssues().entries
    expect(rows.map((row) => row.kind)).toEqual(['held', 'failed'])
    const report = formatStrokeIssues(rows)
    expect(report).toContain('PAINT PROBLEMS')
    expect(report).toContain('block 116200185 · STORM · live · 40 px · failed · TileTooHot')
  })

  it('never keeps a URL or a 32-byte hex string', () => {
    recordStrokeIssue({
      ...base,
      kind: 'failed',
      reason: `HTTP request failed. URL: https://rpc.example.com/v1/secretkey key 0x${'ab'.repeat(32)}`,
    })
    const reason = getStrokeIssues().entries[0].reason
    expect(reason).not.toContain('secretkey')
    expect(reason).not.toContain('abab')
    expect(reason).toContain('[url]')
  })

  it('folds repeats into one row and keeps at most 20', () => {
    for (let i = 0; i < 5; i++) recordStrokeIssue({ ...base, px: 10 + i, kind: 'held', reason: 'same' })
    expect(getStrokeIssues().entries).toHaveLength(1)
    expect(getStrokeIssues().entries[0].px).toBe(14)
    for (let i = 0; i < 30; i++) recordStrokeIssue({ ...base, kind: 'failed', reason: `error ${i}` })
    expect(getStrokeIssues().entries).toHaveLength(20)
    expect(formatStrokeIssues([])).toContain('none recorded')
  })
})
