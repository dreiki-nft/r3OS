import { describe, expect, it } from 'vitest'
import { buildKernelLinesFromReport, type ProcessReportData } from './kernel'
import { processKeyStorageKey } from './processKey'

const report: ProcessReportData = {
  owner: '0x0000000000000000000000000000000000000001',
  pid: 7n,
  graceful: true,
  value: 10_000_000_000_000_000n,
  reserveOk: true,
  dipAtEntry: true,
  dipAfter: false,
  optionalOk: false,
  valueKept: false,
}

describe('Kernel Debugger helpers', () => {
  it('uses a process-key namespace separate from the live burner', () => {
    expect(processKeyStorageKey('0x0000000000000000000000000000000000000001', 143)).toBe(
      'r3os.kernel.key.143.0x0000000000000000000000000000000000000001',
    )
  })

  it('builds the successful graceful report only from report + receipt data', () => {
    const lines = buildKernelLinesFromReport(report, { status: 'success', blockNumber: 99n }, 'burst-graceful')
    expect(lines.join('\n')).toContain('PROCESS 7 STARTED (block 99)')
    expect(lines.join('\n')).toContain('FAILED (isolated)')
    expect(lines.join('\n')).toContain('RETURNED (deferred)')
    expect(lines.join('\n')).toContain('PRESERVED')
  })

  it('labels the naive reverted case as inference instead of inventing a report', () => {
    const lines = buildKernelLinesFromReport(undefined, { status: 'reverted', blockNumber: 101n }, 'burst-naive')
    expect(lines.join('\n')).toContain('ROLLED BACK')
    expect(lines.join('\n')).toContain('INFERRED POSSIBLE')
    expect(lines.join('\n')).toContain('consistent with an uncorrected reserve dip')
  })
})
