import type { Address, Hex } from 'viem'

// C-minor pentatonic across two octaves (Bb3 through G5).
export const BLOCK_NOTE_SCALE = [58, 60, 63, 65, 67, 70, 72, 75, 77, 79] as const
export type BlockWave = OscillatorType

function lastByte(hex?: string) {
  if (!hex || !/^0x[0-9a-f]+$/i.test(hex) || hex.length < 4) return 0
  return Number.parseInt(hex.slice(-2), 16)
}

function firstByte(hex?: string) {
  if (!hex || !/^0x[0-9a-f]+$/i.test(hex) || hex.length < 4) return 0
  return Number.parseInt(hex.slice(2, 4), 16)
}

export function blockNote(input: {
  hash?: Hex
  miner?: Address
  gasUsed?: bigint
  gasLimit?: bigint
}): { midi: number; wave: BlockWave; gain: number } {
  const midi = BLOCK_NOTE_SCALE[firstByte(input.hash) % BLOCK_NOTE_SCALE.length]
  const waves: BlockWave[] = ['square', 'triangle', 'sawtooth', 'sine']
  const wave = waves[lastByte(input.miner) % waves.length]
  let gain = 0.08
  if (input.gasUsed != null && input.gasLimit != null && input.gasLimit > 0n) {
    const scaled = Number((input.gasUsed * 10_000n) / input.gasLimit) / 10_000
    gain = 0.04 + 0.12 * Math.max(0, Math.min(1, scaled))
  }
  return { midi, wave, gain }
}
