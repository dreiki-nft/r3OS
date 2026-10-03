import { describe, expect, it } from 'vitest'
import { BLOCK_NOTE_SCALE, blockNote } from './blockNote'

const HASH = (`0x${'40'.padEnd(64, '0')}`) as `0x${string}`

describe('block note', () => {
  it('is deterministic and stays on the small scale', () => {
    const input = {
      hash: HASH,
      miner: '0x0000000000000000000000000000000000000002' as const,
      gasUsed: 50n,
      gasLimit: 100n,
    }
    expect(blockNote(input)).toEqual(blockNote(input))
    expect(BLOCK_NOTE_SCALE).toContain(blockNote(input).midi as (typeof BLOCK_NOTE_SCALE)[number])
    expect(BLOCK_NOTE_SCALE.every((midi) => [0, 3, 5, 7, 10].includes(midi % 12))).toBe(true)
  })

  it('uses the producer byte for the waveform', () => {
    expect(blockNote({ miner: '0x0000000000000000000000000000000000000000' }).wave).toBe('square')
    expect(blockNote({ miner: '0x0000000000000000000000000000000000000001' }).wave).toBe('triangle')
    expect(blockNote({ miner: '0x0000000000000000000000000000000000000002' }).wave).toBe('sawtooth')
    expect(blockNote({ miner: '0x0000000000000000000000000000000000000003' }).wave).toBe('sine')
  })

  it('bounds gain by block fullness and has an honest missing-gas fallback', () => {
    expect(blockNote({ gasUsed: 0n, gasLimit: 100n }).gain).toBeCloseTo(0.04)
    expect(blockNote({ gasUsed: 100n, gasLimit: 100n }).gain).toBeCloseTo(0.16)
    expect(blockNote({ gasUsed: 1_000n, gasLimit: 100n }).gain).toBeCloseTo(0.16)
    expect(blockNote({}).gain).toBeCloseTo(0.08)
  })
})
