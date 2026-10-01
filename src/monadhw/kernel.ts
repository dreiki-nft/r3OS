import {
  decodeEventLog,
  formatEther,
  isAddress,
  type Abi,
  type Address,
  type Log,
  type TransactionReceipt,
} from 'viem'
import type { KernelScenario, KernelScenarioResult } from './processKey'
import { eventState, formatUsd, type SystemEventSnapshot } from '../chain/systemEvent'
import { KERNEL_OPERATOR_COPY, SUBSYSTEM_LABELS } from '../operator/copy'

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
  | { kind: 'event' }
  | { kind: 'operator'; address?: Address }
  | { kind: 'venues'; tokenIn?: string; tokenOut?: string }
  | { kind: 'route'; amount: string; tokenIn: string; tokenOut: string }
  | { kind: 'quote'; venue: string; amount: string; tokenIn: string; tokenOut: string }
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
  if (command === 'event')
    return parts.length === 1
      ? { kind: 'event' }
      : { kind: 'error', message: KERNEL_OPERATOR_COPY.eventUsage }
  if (command === 'operator') {
    if (parts.length > 2) return { kind: 'error', message: KERNEL_OPERATOR_COPY.operatorUsage }
    if (parts.length === 1) return { kind: 'operator' }
    return isAddress(parts[1])
      ? { kind: 'operator', address: parts[1] as Address }
      : { kind: 'error', message: KERNEL_OPERATOR_COPY.invalidAddress }
  }

  if (command === 'venues') {
    if (parts.length === 1) return { kind: 'venues' }
    if (parts.length === 3)
      return { kind: 'venues', tokenIn: parts[1].toUpperCase(), tokenOut: parts[2].toUpperCase() }
    return { kind: 'error', message: 'usage: venues [IN] [OUT]' }
  }
  if (command === 'route') {
    if (parts.length !== 4) return { kind: 'error', message: 'usage: route <amount> <IN> <OUT>' }
    return {
      kind: 'route',
      amount: parts[1],
      tokenIn: parts[2].toUpperCase(),
      tokenOut: parts[3].toUpperCase(),
    }
  }
  if (command === 'quote') {
    if (parts.length !== 5)
      return { kind: 'error', message: 'usage: quote <label|0xadapter> <amount> <IN> <OUT>' }
    return {
      kind: 'quote',
      venue: parts[1],
      amount: parts[2],
      tokenIn: parts[3].toUpperCase(),
      tokenOut: parts[4].toUpperCase(),
    }
  }
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

export interface KernelOperatorRecord {
  firstRecordBlock: bigint
  lastRecordBlock: bigint
  observedMask: bigint
  seasonsObserved: bigint
  firstObserved: bigint[]
}

export function normalizeKernelOperatorRecord(value: any): KernelOperatorRecord {
  const firstObservedRaw = value?.firstObserved ?? value?.[4] ?? []
  return {
    firstRecordBlock: BigInt(value?.firstRecordBlock ?? value?.[0] ?? 0),
    lastRecordBlock: BigInt(value?.lastRecordBlock ?? value?.[1] ?? 0),
    observedMask: BigInt(value?.observedMask ?? value?.[2] ?? 0),
    seasonsObserved: BigInt(value?.seasonsObserved ?? value?.[3] ?? 0),
    firstObserved: Array.from({ length: 16 }, (_, index) => BigInt(firstObservedRaw?.[index] ?? 0)),
  }
}

function formatMilliThreshold(value?: bigint) {
  if (value == null) return KERNEL_OPERATOR_COPY.unknown
  return `$${value / 1000n}.${(value % 1000n).toString().padStart(3, '0')}`
}

export function formatEventLines(snapshot: SystemEventSnapshot) {
  const state = eventState(snapshot)
  const status =
    state === 'no-driver'
      ? KERNEL_OPERATOR_COPY.noDriverState
      : state === 'condition-met'
        ? KERNEL_OPERATOR_COPY.conditionMet
        : state === 'activated'
          ? KERNEL_OPERATOR_COPY.activated
          : KERNEL_OPERATOR_COPY.armed
  const decimals = snapshot.feedDecimals
  return [
    KERNEL_OPERATOR_COPY.eventTitle,
    `${KERNEL_OPERATOR_COPY.trigger}   ${snapshot.trigger ?? KERNEL_OPERATOR_COPY.unknown}`,
    `${KERNEL_OPERATOR_COPY.status}    ${status}`,
    `${KERNEL_OPERATOR_COPY.threshold} ${formatMilliThreshold(snapshot.thresholdMilliUsd)}`,
    `${KERNEL_OPERATOR_COPY.feed}      ${snapshot.feedDescription ?? KERNEL_OPERATOR_COPY.unknown} · ${snapshot.feed ?? KERNEL_OPERATOR_COPY.unknown}`,
    `${KERNEL_OPERATOR_COPY.answer}    ${decimals == null ? KERNEL_OPERATOR_COPY.unknown : formatUsd(snapshot.condition.answer, decimals)}`,
    `${KERNEL_OPERATOR_COPY.updated}   ${snapshot.condition.updatedAt.toString()}`,
    `${KERNEL_OPERATOR_COPY.activation} ${snapshot.activatedBlock > 0n ? `${KERNEL_OPERATOR_COPY.block} ${snapshot.activatedBlock} · ${decimals == null ? snapshot.activationAnswer.toString() : formatUsd(snapshot.activationAnswer, decimals)}` : KERNEL_OPERATOR_COPY.none}`,
  ]
}

export function operatorObservedLines(record: KernelOperatorRecord) {
  const lines = [
    KERNEL_OPERATOR_COPY.operatorTitle,
    `${KERNEL_OPERATOR_COPY.first}   ${record.firstRecordBlock.toString()}`,
    `${KERNEL_OPERATOR_COPY.last}    ${record.lastRecordBlock.toString()}`,
  ]
  const observed = SUBSYSTEM_LABELS.flatMap((label, index) => {
    if ((record.observedMask & (1n << BigInt(index))) === 0n) return []
    const block = record.firstObserved[index] ?? 0n
    return [`${KERNEL_OPERATOR_COPY.observed} ${label} · ${KERNEL_OPERATOR_COPY.first} ${block.toString()}`]
  })
  lines.push(
    ...(observed.length ? observed : [`${KERNEL_OPERATOR_COPY.observed} ${KERNEL_OPERATOR_COPY.none}`]),
  )
  const seasons: string[] = []
  for (let season = 0; season < 256; season++) {
    if ((record.seasonsObserved & (1n << BigInt(season))) !== 0n)
      seasons.push(`${KERNEL_OPERATOR_COPY.seasonPrefix}${season}`)
  }
  lines.push(`${KERNEL_OPERATOR_COPY.seasons} ${seasons.join(', ') || KERNEL_OPERATOR_COPY.none}`)
  return lines
}

export function formatOperatorStorageLines(
  baseSlot: bigint,
  entries: readonly { word: number; value?: string }[],
) {
  return entries.map(({ word, value }) => {
    const hex = (value ?? '0x').replace(/^0x/, '').padStart(64, '0').slice(-64)
    return `W${word.toString().padStart(2, '0')} 0x${(baseSlot + BigInt(word)).toString(16).padStart(64, '0')} ${hex}`
  })
}

export function operatorHeaderWord(record: KernelOperatorRecord) {
  if (record.firstRecordBlock === 0n && record.lastRecordBlock === 0n && record.observedMask === 0n) {
    return `0x${'0'.repeat(64)}`
  }
  const magic = 0x4f505231n << 224n
  const first = (record.firstRecordBlock & ((1n << 48n) - 1n)) << 176n
  const last = (record.lastRecordBlock & ((1n << 48n) - 1n)) << 128n
  const mask = (record.observedMask & 0xffffn) << 112n
  return `0x${(magic | first | last | mask).toString(16).padStart(64, '0')}`
}

export function operatorStorageVerificationLine(record: KernelOperatorRecord, storageWord0?: string) {
  const normalize = (value?: string) => (value ?? '0x0').toLowerCase().replace(/^0x0*/, '0x')
  return normalize(operatorHeaderWord(record)) === normalize(storageWord0)
    ? KERNEL_OPERATOR_COPY.storageVerified
    : KERNEL_OPERATOR_COPY.storageMismatch
}
