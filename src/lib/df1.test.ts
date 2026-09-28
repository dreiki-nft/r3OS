import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, hexToBytes, keccak256, toHex } from 'viem'
import { applyDf1, seededRandom } from './df1'

function goldenRgb(): Uint8ClampedArray {
  const b = new Uint8ClampedArray(4096 * 3)
  for (let i = 0; i < b.length; i += 32) {
    const encoded = encodeAbiParameters([{ type: 'uint256' }], [BigInt(i)])
    const hash = hexToBytes(keccak256(encoded))
    b.set(hash.subarray(0, Math.min(32, b.length - i)), i)
  }
  for (let i = 0; i < 4096; i += 7) {
    b[i * 3] = 0
    b[i * 3 + 1] = 0
    b[i * 3 + 2] = 0
  }
  for (let i = 3; i < 4096; i += 11) {
    b[i * 3] = 0xff
    b[i * 3 + 1] = 0xff
    b[i * 3 + 2] = 0xff
  }
  return b
}

function applyRgb(source: Uint8ClampedArray, seed: number, amount: number) {
  const rgba = new Uint8ClampedArray(4096 * 4)
  for (let i = 0, j = 0; i < source.length; i += 3, j += 4) {
    rgba[j] = source[i]
    rgba[j + 1] = source[i + 1]
    rgba[j + 2] = source[i + 2]
    rgba[j + 3] = 255
  }
  const out = applyDf1(rgba, seed, amount)
  const rgb = new Uint8Array(source.length)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgb[i] = out[j]
    rgb[i + 1] = out[j + 1]
    rgb[i + 2] = out[j + 2]
  }
  return rgb
}

describe('DF1 v1', () => {
  it('has the frozen mulberry32 stream for seed 12345', () => {
    const rand = seededRandom(12345)
    expect([rand(), rand(), rand(), rand()]).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
    ])
  })

  it('matches the golden input hash', () => {
    expect(keccak256(toHex(new Uint8Array(goldenRgb())))).toBe(
      '0xd6ed268866a694810cc23ce886dd6f22265f99943464d56793a80a278dcd8129',
    )
  })

  for (const [seed, amount, expected] of [
    [333, 100, '0xd366009a040672f5b54682810d5f8e42e71c3f8a2064a250f68a34a7ebc3e514'],
    [0, 200, '0xbb5f205cde59b1f31c02e84445f65aa31346866714d62048d9b19897eda6afbb'],
    [0xdeadbeef, 37, '0x0f1a82c4fac0c0adfaf06569458438d59b582c3d22f11064649bd276248903d0'],
  ] as const) {
    it(`matches seed ${seed} amount ${amount}`, () => {
      expect(keccak256(toHex(applyRgb(goldenRgb(), seed, amount)))).toBe(expected)
    })
  }

  it('amount zero is unchanged', () => {
    const source = goldenRgb()
    expect(applyRgb(source, 123, 0)).toEqual(Uint8Array.from(source))
  })
})
