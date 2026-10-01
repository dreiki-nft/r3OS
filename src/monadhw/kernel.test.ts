import { describe, expect, it } from 'vitest'
import {
  buildKernelLinesFromReport,
  formatDeviceLines,
  formatDumpLines,
  formatEventLines,
  formatOperatorStorageLines,
  normalizeKernelOperatorRecord,
  operatorHeaderWord,
  operatorObservedLines,
  operatorStorageVerificationLine,
  parseKernelCommand,
  storageVerificationLine,
  type ProcessReportData,
} from './kernel'
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
    const lines = buildKernelLinesFromReport(
      report,
      { status: 'success', blockNumber: 99n },
      'burst-graceful',
    )
    expect(lines.join('\n')).toContain('PROCESS 7 STARTED (block 99)')
    expect(lines.join('\n')).toContain('FAILED (isolated)')
    expect(lines.join('\n')).toContain('RETURNED (deferred)')
    expect(lines.join('\n')).toContain('PRESERVED')
  })

  it('labels the naive reverted case as inference instead of inventing a report', () => {
    const lines = buildKernelLinesFromReport(
      undefined,
      { status: 'reverted', blockNumber: 101n },
      'burst-naive',
    )
    expect(lines.join('\n')).toContain('ROLLED BACK')
    expect(lines.join('\n')).toContain('INFERRED POSSIBLE')
    expect(lines.join('\n')).toContain('consistent with an uncorrected reserve dip')
  })
  it('parses CARD.DRV commands with safe defaults and bounds', () => {
    expect(parseKernelCommand('device 143')).toEqual({ kind: 'device', cardId: 143n })
    expect(parseKernelCommand('dump 143')).toEqual({ kind: 'dump', cardId: 143n, word: 0, count: 16 })
    expect(parseKernelCommand('dump 0 127 1')).toEqual({ kind: 'dump', cardId: 0n, word: 127, count: 1 })
    expect(parseKernelCommand('dump 1 127 2')).toMatchObject({ kind: 'error' })
  })

  it('formats device and dump output without inventing card state', () => {
    const info = {
      owner: '0x0000000000000000000000000000000000000001',
      exists: true,
      pageBaseSlot: 0x1000n,
      pageIndex: 0x20n,
      formatted: true,
      version: 1,
      writes: 2,
      firstWriteBlock: 10n,
      lastWriteBlock: 12n,
    }
    expect(formatDeviceLines(7n, info, '0xabc').join('\n')).toContain('format  v1')
    const dump = formatDumpLines(0x1000n, 1, [`0x4142${'00'.repeat(30)}`])
    expect(dump[0]).toContain('|AB')
    expect(dump[0]).toContain('LABEL')
    expect(storageVerificationLine('0x01', '0x0001')).toContain('verified')
    expect(storageVerificationLine('0x01', '0x02')).toContain('mismatch')
  })

  it('parses read-only router commands', () => {
    expect(parseKernelCommand('venues')).toEqual({ kind: 'venues' })
    expect(parseKernelCommand('venues WMON USDC')).toEqual({
      kind: 'venues',
      tokenIn: 'WMON',
      tokenOut: 'USDC',
    })
    expect(parseKernelCommand('route 1 WMON USDC')).toEqual({
      kind: 'route',
      amount: '1',
      tokenIn: 'WMON',
      tokenOut: 'USDC',
    })
    expect(parseKernelCommand('quote poe-mon-usdc 1 WMON USDC')).toEqual({
      kind: 'quote',
      venue: 'poe-mon-usdc',
      amount: '1',
      tokenIn: 'WMON',
      tokenOut: 'USDC',
    })
    expect(parseKernelCommand('swap 1 WMON USDC')).toMatchObject({ kind: 'error' })
    expect(parseKernelCommand('route 1 WMON')).toMatchObject({ kind: 'error' })
  })

  it('parses system-event and operator commands', () => {
    expect(parseKernelCommand('event')).toEqual({ kind: 'event' })
    expect(parseKernelCommand('operator')).toEqual({ kind: 'operator' })
    expect(parseKernelCommand('operator 0x0000000000000000000000000000000000000001')).toEqual({
      kind: 'operator',
      address: '0x0000000000000000000000000000000000000001',
    })
    expect(parseKernelCommand('operator nope')).toMatchObject({ kind: 'error' })
  })

  it('formats the event without inventing a post-activation stage', () => {
    const lines = formatEventLines({
      loading: false,
      address: '0x0000000000000000000000000000000000000001',
      trigger: 'MON_PRICE_TRIGGER',
      feed: '0x0000000000000000000000000000000000000002',
      feedDecimals: 8,
      thresholdMilliUsd: 333n,
      maxAge: 90_000n,
      feedDescription: 'MON / USD',
      activatedBlock: 99n,
      activationAnswer: 33_300_000n,
      condition: { met: true, fresh: true, answer: 33_400_000n, updatedAt: 123n, roundId: 7n },
    })
    expect(lines.join('\n')).toContain('MON_PRICE_TRIGGER')
    expect(lines.join('\n')).toContain('$0.333')
    expect(lines.join('\n')).toContain('block 99')
  })

  it('formats and verifies operator storage words', () => {
    const raw = [10n, 20n, 5n, 2n, [10n, 0n, 12n, ...Array.from({ length: 13 }, () => 0n)]]
    const record = normalizeKernelOperatorRecord(raw)
    expect(operatorObservedLines(record).join('\n')).toContain('PAINT')
    expect(operatorObservedLines(record).join('\n')).toContain('PASS')
    const header = operatorHeaderWord(record)
    const storage = formatOperatorStorageLines(0x1000n, [
      { word: 0, value: header },
      { word: 1, value: '0x02' },
    ])
    expect(storage[0]).toContain('W00')
    expect(storage[1]).toContain('W01')
    expect(operatorStorageVerificationLine(record, header)).toContain('verified')
    expect(operatorStorageVerificationLine(record, '0x01')).toContain('mismatch')
  })
})
