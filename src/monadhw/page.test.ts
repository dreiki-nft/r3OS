import { describe, expect, it } from 'vitest'
import { encodeErrorResult, type Hex } from 'viem'
import {
  bytesToWords,
  changedWordRange,
  decodeBenchWriteResult,
  hexdumpRows,
  packPagePixels,
  summarizePageTraffic,
  unpackPagePixels,
} from './page'

function zeroWords() {
  return Array.from({ length: 128 }, () => `0x${'00'.repeat(32)}` as Hex)
}

describe('PAGE.EXE helpers', () => {
  it('packs and unpacks the 128x64 high-nibble-first pixel image', () => {
    const pixels = new Uint8Array(128 * 64)
    pixels[0] = 0xa
    pixels[1] = 0x3
    pixels[127] = 0xf
    pixels[128] = 0x4
    const bytes = packPagePixels(pixels)
    expect(bytes[0]).toBe(0xa3)
    expect(unpackPagePixels(bytes)).toEqual(pixels)
  })

  it('finds the minimal covering changed word range', () => {
    const before = zeroWords()
    const bytes = new Uint8Array(4096)
    bytes[33] = 1
    bytes[127] = 2
    const after = bytesToWords(bytes)
    const range = changedWordRange(before, after)
    expect(range?.offset).toBe(1)
    expect(range?.words).toHaveLength(3)
  })

  it('formats 32-byte hexdump rows with ASCII', () => {
    const words = zeroWords()
    words[0] = `0x68656c6c6f${'00'.repeat(27)}` as Hex
    const rows = hexdumpRows(words)
    expect(rows[0].offset).toBe(0)
    expect(rows[0].ascii.startsWith('hello')).toBe(true)
  })

  it('decodes the BenchWriteResult custom error', () => {
    const abi = [
      {
        type: 'error',
        name: 'BenchWriteResult',
        inputs: [
          { name: 'gasUsed', type: 'uint256' },
          { name: 'overhead', type: 'uint256' },
        ],
      },
    ] as const
    const data = encodeErrorResult({ abi, errorName: 'BenchWriteResult', args: [1234n, 17n] })
    expect(decodeBenchWriteResult(data, abi)).toEqual({ gasUsed: 1234n, overhead: 17n })
  })
  it('summarizes private-page traffic by block without double-counting transaction gas', () => {
    const a = `0x${'11'.repeat(32)}` as Hex
    const b = `0x${'22'.repeat(32)}` as Hex
    const rows = summarizePageTraffic(
      [
        { block: 10n, txHash: a, page: 1n, words: 2 },
        { block: 10n, txHash: a, page: 1n, words: 3 },
        { block: 10n, txHash: b, page: 2n, words: 1 },
      ],
      [
        { transactionHash: a, gasUsed: 100n, status: 'success' },
        { transactionHash: b, gasUsed: 50n, status: 'reverted' },
      ],
    )
    expect(rows).toEqual([
      { block: 10n, writes: 3, distinctPages: 2, words: 6, gasUsed: 150n, status: 'mixed' },
    ])
  })
})
