import { decodeEventLog, formatEther, type Abi, type Log, type TransactionReceipt } from 'viem'
import type { KernelScenario, KernelScenarioResult } from './processKey'

export interface ProcessReportData {
  owner: string
  pid: bigint
  graceful: boolean
  value: bigint
  reserveOk: boolean
  dipAtEntry: boolean
  dipAfter: boolean
  optionalOk: boolean
  valueKept: boolean
}

export function decodeProcessReport(logs: readonly Log[], abi: Abi | readonly unknown[]) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: abi as Abi, data: log.data, topics: log.topics })
      if (decoded.eventName !== 'ProcessReport') continue
      const args = decoded.args as unknown as ProcessReportData
      return args
    } catch {
      // Other logs in the receipt are expected.
    }
  }
  return undefined
}

function dots(label: string, value: string) {
  return `${label} ${'.'.repeat(Math.max(1, 24 - label.length))} ${value}`
}

export function buildKernelLinesFromReport(
  report: ProcessReportData | undefined,
  receipt: Pick<TransactionReceipt, 'status' | 'blockNumber'> | undefined,
  scenario: KernelScenario,
  gasLimit = 160_000n,
) {
  const lines = ['KERNEL DEBUGGER']
  if (!receipt) {
    lines.push('PROCESS — NOT INCLUDED')
    lines.push(dots('tx status', 'no receipt'))
    return lines
  }

  lines.push(`PROCESS ${report?.pid?.toString() ?? '—'} STARTED (block ${receipt.blockNumber.toString()})`)
  if (receipt.status === 'reverted' || !report) {
    lines.push(dots('primary state', 'ROLLED BACK / no report'))
    lines.push(dots('optional call', 'no report'))
    lines.push(dots('reserve device', 'unknown'))
    lines.push(dots('RESERVE CONDITION', scenario === 'burst-naive' ? 'INFERRED POSSIBLE' : 'unknown'))
    lines.push(dots('optional deposit', 'ROLLED BACK'))
    lines.push(dots('re-check', 'unavailable'))
    lines.push(dots('primary state', 'ROLLED BACK'))
    lines.push(dots('tx status', `REVERTED by the chain (charged limit ${gasLimit.toString()})`))
    if (scenario === 'burst-naive') {
      lines.push('inference: consistent with an uncorrected reserve dip; no ProcessReport survived the revert.')
    }
    return lines
  }

  lines.push(dots('primary state', 'OK'))
  lines.push(dots('optional call', report.optionalOk ? 'OK' : 'FAILED (isolated)'))
  lines.push(dots('reserve device', report.reserveOk ? 'present' : 'absent'))
  lines.push(dots('RESERVE CONDITION', report.dipAtEntry ? 'DETECTED' : 'none'))
  let deposit = 'none'
  if (report.value > 0n) {
    deposit = report.valueKept ? `KEPT (${formatEther(report.value)} MON)` : 'RETURNED (deferred)'
  }
  lines.push(dots('optional deposit', deposit))
  lines.push(dots('re-check', report.reserveOk ? (report.dipAfter ? 'still dipped' : 'clear') : 'unavailable'))
  lines.push(dots('primary state', 'PRESERVED'))
  lines.push(dots('tx status', 'success'))
  return lines
}

export function buildKernelLines(
  result: KernelScenarioResult,
  abi: Abi | readonly unknown[],
) {
  if (!result.runReceipt) {
    const lines = ['KERNEL DEBUGGER', 'PROCESS — NOT INCLUDED', dots('tx status', 'no receipt')]
    if (result.runSendError) lines.push(`rpc: ${result.runSendError}`)
    return lines
  }
  const report = decodeProcessReport(result.runReceipt.logs, abi)
  return buildKernelLinesFromReport(report, result.runReceipt, result.scenario, result.gasLimit)
}
