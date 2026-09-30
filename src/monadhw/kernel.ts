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
      lines.push(
        'inference: consistent with an uncorrected reserve dip; no ProcessReport survived the revert.',
      )
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
  lines.push(
    dots('re-check', report.reserveOk ? (report.dipAfter ? 'still dipped' : 'clear') : 'unavailable'),
  )
  lines.push(dots('primary state', 'PRESERVED'))
  lines.push(dots('tx status', 'success'))
  return lines
}

export function buildKernelLines(result: KernelScenarioResult, abi: Abi | readonly unknown[]) {
  if (!result.runReceipt) {
    const lines = ['KERNEL DEBUGGER', 'PROCESS — NOT INCLUDED', dots('tx status', 'no receipt')]
    if (result.runSendError) lines.push(`rpc: ${result.runSendError}`)
    return lines
  }
  const report = decodeProcessReport(result.runReceipt.logs, abi)
  return buildKernelLinesFromReport(report, result.runReceipt, result.scenario, result.gasLimit)
}

export type KernelCommand =
  | { kind: 'help' }
  | { kind: 'cls' }
  | { kind: 'device'; cardId: bigint }
  | { kind: 'dump'; cardId: bigint; word: number; count: number }
  | { kind: 'error'; message: string }

function parseUnsigned(value: string) {
  try {
    const parsed = BigInt(value)
    return parsed >= 0n ? parsed : undefined
  } catch {
    return undefined
  }
}

export function parseKernelCommand(input: string): KernelCommand {
  const parts = input.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { kind: 'error', message: 'enter a command; try help' }
  const command = parts[0].toLowerCase()
  if (command === 'help')
    return parts.length === 1 ? { kind: 'help' } : { kind: 'error', message: 'usage: help' }
  if (command === 'cls')
    return parts.length === 1 ? { kind: 'cls' } : { kind: 'error', message: 'usage: cls' }
  if (command === 'device') {
    if (parts.length !== 2) return { kind: 'error', message: 'usage: device <id>' }
    const cardId = parseUnsigned(parts[1])
    return cardId == null ? { kind: 'error', message: 'invalid card id' } : { kind: 'device', cardId }
  }
  if (command === 'dump') {
    if (parts.length < 2 || parts.length > 4)
      return { kind: 'error', message: 'usage: dump <id> [word] [count]' }
    const cardId = parseUnsigned(parts[1])
    const wordRaw = parts[2] == null ? 0n : parseUnsigned(parts[2])
    const countRaw = parts[3] == null ? 16n : parseUnsigned(parts[3])
    if (cardId == null) return { kind: 'error', message: 'invalid card id' }
    if (wordRaw == null || wordRaw > 127n) return { kind: 'error', message: 'word must be 0..127' }
    if (countRaw == null || countRaw < 1n || countRaw > 128n - wordRaw) {
      return { kind: 'error', message: `count must be 1..${128 - Number(wordRaw)}` }
    }
    return { kind: 'dump', cardId, word: Number(wordRaw), count: Number(countRaw) }
  }
  return { kind: 'error', message: `unknown command: ${parts[0]}` }
}

export interface KernelCardInfo {
  owner: string
  exists: boolean
  pageBaseSlot: bigint
  pageIndex: bigint
  formatted: boolean
  version: number
  writes: number
  firstWriteBlock: bigint
  lastWriteBlock: bigint
}

export function formatDeviceLines(cardId: bigint, info: KernelCardInfo, hash: string) {
  return [
    'MONAD_CARD',
    `token   ${cardId.toString()}`,
    `owner   ${info.exists ? info.owner : '0x0000000000000000000000000000000000000000'}`,
    `exists  ${info.exists ? 'yes' : 'no'}`,
    `page    0x${info.pageIndex.toString(16)}`,
    `slot    0x${info.pageBaseSlot.toString(16).padStart(64, '0')}`,
    `format  ${info.formatted ? `v${info.version}` : 'unformatted'}`,
    `writes  ${info.writes}`,
    `first   ${info.firstWriteBlock.toString()}`,
    `last    ${info.lastWriteBlock.toString()}`,
    `hash    ${hash}`,
  ]
}

function dumpAscii(bytes: Uint8Array) {
  return Array.from(bytes, (value) =>
    value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.',
  ).join('')
}

export function formatDumpLines(baseSlot: bigint, firstWord: number, words: readonly string[]) {
  return words.map((word, index) => {
    const slotIndex = firstWord + index
    const hex = word.startsWith('0x')
      ? word.slice(2).padStart(64, '0').slice(-64)
      : word.padStart(64, '0').slice(-64)
    const bytes = Uint8Array.from(
      Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)),
    )
    let region = 'USER'
    const byteOffset = slotIndex * 32
    if (byteOffset < 0x20) region = 'HEADER'
    else if (byteOffset < 0x40) region = 'LABEL'
    else if (byteOffset < 0x240) region = 'ICON'
    else if (byteOffset < 0x2c0) region = 'MESSAGE'
    else if (byteOffset < 0x2e0) region = 'FLAGS'
    else if (byteOffset < 0x300) region = 'RESERVED'
    else if (byteOffset < 0x380) region = 'CARD BUS'
    else if (byteOffset < 0x400) region = 'RESERVED'
    return `+${slotIndex.toString(16).toUpperCase().padStart(2, '0')} 0x${(baseSlot + BigInt(slotIndex)).toString(16).padStart(64, '0')} ${hex} |${dumpAscii(bytes)}| ${region}`
  })
}

export function storageVerificationLine(readPageWord0: string, storageWord0?: string) {
  const normalize = (value?: string) => (value ?? '0x0').toLowerCase().replace(/^0x0*/, '0x')
  return normalize(readPageWord0) === normalize(storageWord0)
    ? 'storage verified: slot base+0 matches readPage[0]'
    : 'storage mismatch: slot base+0 does not match readPage[0]'
}
