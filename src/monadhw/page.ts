import {
  decodeErrorResult,
  encodeFunctionData,
  hexToBytes,
  bytesToHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { publicClient } from '../chain/clients'

export const PAGE_WORDS = 128
export const PAGE_BYTES = 4096
export const PAGE_PIXELS = 8192
export const PAGE_WIDTH = 128
export const PAGE_HEIGHT = 64

export type BenchPattern = 0 | 1 | 2
export const BENCH_PATTERNS: { id: BenchPattern; label: string }[] = [
  { id: 0, label: 'contiguous' },
  { id: 1, label: 'scattered' },
  { id: 2, label: 'mapping' },
]

export function wordsToBytes(words: readonly Hex[]) {
  const out = new Uint8Array(PAGE_BYTES)
  words.slice(0, PAGE_WORDS).forEach((word, index) => {
    out.set(hexToBytes(word).slice(0, 32), index * 32)
  })
  return out
}

export function bytesToWords(bytes: Uint8Array): Hex[] {
  const padded = new Uint8Array(PAGE_BYTES)
  padded.set(bytes.slice(0, PAGE_BYTES))
  return Array.from({ length: PAGE_WORDS }, (_, index) =>
    bytesToHex(padded.slice(index * 32, index * 32 + 32)),
  )
}

export function unpackPagePixels(bytes: Uint8Array) {
  const pixels = new Uint8Array(PAGE_PIXELS)
  for (let i = 0; i < Math.min(PAGE_BYTES, bytes.length); i++) {
    pixels[i * 2] = bytes[i] >> 4
    pixels[i * 2 + 1] = bytes[i] & 0x0f
  }
  return pixels
}

export function packPagePixels(pixels: Uint8Array) {
  const bytes = new Uint8Array(PAGE_BYTES)
  for (let i = 0; i < PAGE_BYTES; i++) {
    bytes[i] = ((pixels[i * 2] ?? 0) << 4) | (pixels[i * 2 + 1] ?? 0)
  }
  return bytes
}

export function changedWordRange(before: readonly Hex[], after: readonly Hex[]) {
  let first = -1
  let last = -1
  for (let i = 0; i < PAGE_WORDS; i++) {
    if ((before[i] ?? '0x') === (after[i] ?? '0x')) continue
    if (first < 0) first = i
    last = i
  }
  if (first < 0) return undefined
  return { offset: first, words: after.slice(first, last + 1) as Hex[] }
}

export function formatAscii(bytes: Uint8Array) {
  return Array.from(bytes, (value) => (value >= 32 && value <= 126 ? String.fromCharCode(value) : '.')).join('')
}

export function hexdumpRows(words: readonly Hex[]) {
  return words.slice(0, PAGE_WORDS).map((word, index) => {
    const bytes = hexToBytes(word)
    return {
      offset: index,
      hex: Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(' '),
      ascii: formatAscii(bytes),
    }
  })
}

export function extractRevertData(error: unknown): Hex | undefined {
  const seen = new Set<unknown>()
  const walk = (value: unknown): Hex | undefined => {
    if (value == null || seen.has(value)) return undefined
    if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) && value.length >= 10) return value as Hex
    if (typeof value !== 'object') return undefined
    seen.add(value)
    for (const key of ['data', 'cause', 'error', 'details']) {
      const next = walk((value as Record<string, unknown>)[key])
      if (next) return next
    }
    return undefined
  }
  return walk(error)
}

export function decodeBenchWriteResult(data: Hex, abi: Abi | readonly unknown[]) {
  try {
    const decoded = decodeErrorResult({ abi: abi as Abi, data })
    if (decoded.errorName !== 'BenchWriteResult') return undefined
    const args = decoded.args as readonly [bigint, bigint]
    return { gasUsed: BigInt(args[0]), overhead: BigInt(args[1]) }
  } catch {
    return undefined
  }
}

export async function measureBenchWrite(
  address: Address,
  abi: Abi | readonly unknown[],
  pattern: BenchPattern,
  n: number,
) {
  if (!publicClient) throw new Error('DEMO_MODE')
  const data = encodeFunctionData({
    abi: abi as Abi,
    functionName: 'benchWrite',
    args: [pattern, BigInt(n)],
  })
  try {
    await publicClient.call({ to: address, data })
  } catch (error) {
    const revertData = extractRevertData(error)
    const decoded = revertData ? decodeBenchWriteResult(revertData, abi) : undefined
    if (decoded) return decoded
    throw error
  }
  throw new Error('benchWrite unexpectedly returned without BenchWriteResult')
}
