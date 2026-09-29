import type { Address } from 'viem'
import { publicClient } from './clients'
import { config } from './config'

export class LogWindowTooLarge extends Error {
  fromBlock: bigint
  toBlock: bigint
  maxBlocks: bigint

  constructor(fromBlock: bigint, toBlock: bigint, maxBlocks: bigint) {
    super(`log window ${fromBlock}-${toBlock} exceeds ${maxBlocks} blocks`)
    this.name = 'LogWindowTooLarge'
    this.fromBlock = fromBlock
    this.toBlock = toBlock
    this.maxBlocks = maxBlocks
  }
}

export type LogProgress = (doneBlocks: bigint, totalBlocks: bigint) => void

export interface LogWindowOptions {
  address: Address | readonly Address[]
  event?: any
  events?: readonly any[]
  args?: Record<string, unknown>
  fromBlock: bigint
  toBlock: bigint | 'latest'
  maxBlocks?: number | bigint
  signal?: AbortSignal
  onProgress?: LogProgress
  client?: any
}

let effectiveRange = config.logsRange

function aborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new DOMException('aborted', 'AbortError')
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function errorCode(error: unknown) {
  const row = error as { code?: number; cause?: { code?: number } }
  return row.code ?? row.cause?.code
}

/** 429s and provider rate caps are retried by viem/fallback; they must never shrink the log range. */
export function isRateLimitError(error: unknown) {
  const row = error as { status?: number; cause?: { status?: number } }
  if (row?.status === 429 || row?.cause?.status === 429) return true
  const message = error instanceof Error ? error.message : String(error)
  return /\b429\b|rate.?limit|too many requests|requests per second|per second|throttl/i.test(message)
}

export function isRangeError(error: unknown) {
  if (isRateLimitError(error)) return false
  const code = errorCode(error)
  if (code === -32005 || code === -32602 || code === -32614 || code === -32615) return true
  const message = error instanceof Error ? error.message : String(error)
  return /range|too many|limit|exceed|10000/i.test(message)
}

function shrinkRange() {
  effectiveRange = effectiveRange > 100 ? 100 : Math.max(10, Math.floor(effectiveRange / 2))
}

export function chunkBlockRanges(fromBlock: bigint, toBlock: bigint, range = effectiveRange) {
  const rows: Array<{ fromBlock: bigint; toBlock: bigint }> = []
  if (toBlock < fromBlock) return rows
  const width = BigInt(Math.max(1, range))
  let cursor = fromBlock
  while (cursor <= toBlock) {
    const end = cursor + width - 1n > toBlock ? toBlock : cursor + width - 1n
    rows.push({ fromBlock: cursor, toBlock: end })
    cursor = end + 1n
  }
  return rows
}

async function resolveHead(client: any, toBlock: bigint | 'latest') {
  return toBlock === 'latest' ? ((await client.getBlockNumber({ cacheTime: 0 })) as bigint) : toBlock
}

function logRequest(options: LogWindowOptions, range: { fromBlock: bigint; toBlock: bigint }) {
  const base = {
    address: options.address,
    args: options.args,
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  }
  return options.events?.length
    ? { ...base, events: options.events }
    : options.event
      ? { ...base, event: options.event }
      : base
}

async function requestChunk(options: LogWindowOptions, range: { fromBlock: bigint; toBlock: bigint }) {
  const client = options.client ?? publicClient
  if (!client) throw new Error('DEMO_MODE')
  let retries = 0
  while (true) {
    aborted(options.signal)
    try {
      return (await client.getLogs(logRequest(options, range))) as any[]
    } catch (error) {
      aborted(options.signal)
      if (isRangeError(error) && effectiveRange > 10) {
        shrinkRange()
        throw Object.assign(new Error('RANGE_SHRUNK'), { rangeShrunk: true })
      }
      if (retries >= 3) throw error
      await wait(500 * 2 ** retries, options.signal)
      retries += 1
    }
  }
}

export async function getLogsWindow(options: LogWindowOptions) {
  const client = options.client ?? publicClient
  if (!client) throw new Error('DEMO_MODE')
  aborted(options.signal)
  const fromBlock = options.fromBlock < config.deployBlock ? config.deployBlock : options.fromBlock
  const toBlock = await resolveHead(client, options.toBlock)
  if (toBlock < fromBlock) return []
  const totalBlocks = toBlock - fromBlock + 1n
  const maxBlocks = BigInt(options.maxBlocks ?? 20 * config.logsRange)
  if (totalBlocks > maxBlocks) throw new LogWindowTooLarge(fromBlock, toBlock, maxBlocks)

  const found: any[] = []
  let cursor = fromBlock
  let done = 0n
  while (cursor <= toBlock) {
    aborted(options.signal)
    const end =
      cursor + BigInt(effectiveRange) - 1n > toBlock ? toBlock : cursor + BigInt(effectiveRange) - 1n
    try {
      found.push(...(await requestChunk(options, { fromBlock: cursor, toBlock: end })))
      const width = end - cursor + 1n
      done += width
      options.onProgress?.(done, totalBlocks)
      cursor = end + 1n
    } catch (error) {
      if ((error as { rangeShrunk?: boolean }).rangeShrunk) continue
      throw error
    }
  }
  return found
}

export interface ScanBackwardOptions extends Omit<LogWindowOptions, 'fromBlock' | 'toBlock' | 'maxBlocks'> {
  fromBlock?: bigint
  toBlock?: bigint | 'latest'
  maxBlocks: number | bigint
  until: (logsSoFar: any[]) => boolean
}

export async function scanBackward(options: ScanBackwardOptions) {
  const client = options.client ?? publicClient
  if (!client) throw new Error('DEMO_MODE')
  const head = await resolveHead(client, options.toBlock ?? 'latest')
  const floor =
    options.fromBlock == null
      ? config.deployBlock
      : options.fromBlock < config.deployBlock
        ? config.deployBlock
        : options.fromBlock
  const maxBlocks = BigInt(options.maxBlocks)
  const minByCap = head >= maxBlocks - 1n ? head - maxBlocks + 1n : 0n
  const minBlock = floor > minByCap ? floor : minByCap
  const found: any[] = []
  let cursor = head
  const total = head >= minBlock ? head - minBlock + 1n : 0n
  let done = 0n

  while (cursor >= minBlock && total > 0n) {
    aborted(options.signal)
    const width = BigInt(effectiveRange)
    const start = cursor >= width - 1n ? cursor - width + 1n : 0n
    const from = start < minBlock ? minBlock : start
    let rows: any[]
    try {
      rows = await requestChunk(
        { ...options, fromBlock: from, toBlock: cursor },
        { fromBlock: from, toBlock: cursor },
      )
    } catch (error) {
      if ((error as { rangeShrunk?: boolean }).rangeShrunk) continue
      throw error
    }
    found.unshift(...rows)
    done += cursor - from + 1n
    options.onProgress?.(done, total)
    if (options.until(found)) break
    if (from === 0n || from === minBlock) break
    cursor = from - 1n
  }
  return found
}

export function __resetLogRangeForTests(value = config.logsRange) {
  effectiveRange = value
}

export function __getLogRangeForTests() {
  return effectiveRange
}
