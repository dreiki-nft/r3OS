import { describe, expect, it } from 'vitest'
import type { Address, Hex } from 'viem'
import {
  cardPageBaseSlot,
  isOfficialCard,
  cardPropertySources,
  changedCardWordRange,
  decodeAscii,
  decodeHeader,
  encodeAscii,
  nonStandardReserved,
  rememberedCardKey,
  packCardIcon,
  regionOf,
  resolveCardDiscovery,
  unpackCardIcon,
  usedBytes,
} from './monadCard'

const zero = `0x${'00'.repeat(32)}` as Hex
const alice = '0x00000000000000000000000000000000000000a1' as Address
const bob = '0x00000000000000000000000000000000000000b0' as Address

function words() {
  return Array.from({ length: 128 }, () => zero)
}

describe('Monad Card helpers', () => {
  it('recognizes only the official chain-143 card and namespaces remembered ids per wallet', () => {
    expect(isOfficialCard(143, '0x0000CA12D5c07085022eBC74867157449919Fd67')).toBe(true)
    expect(isOfficialCard(10143, '0x0000CA12D5c07085022eBC74867157449919Fd67')).toBe(false)
    expect(rememberedCardKey(143, alice)).toBe('r3os.card.143.0x00000000000000000000000000000000000000a1')
  })
  it('mirrors the Solidity hashed aligned page vectors', () => {
    expect(cardPageBaseSlot(0n)).toBe(0x6b71bb6efd9166d086e2ca2bb60c6830c27c98151766b97a776bdbac76135600n)
    expect(cardPageBaseSlot(1n)).toBe(0xb0317dfa75a5e4e238d0a2a8be689883bacc57aead5fdcefa5541ce837dac400n)
    expect(cardPageBaseSlot((1n << 256n) - 1n)).toBe(
      0x96ca4398d5a8b526ff513d703c459a23941c8412ec7729e0fcdf36f8f48c2c00n,
    )
    expect(cardPageBaseSlot(143n) & 127n).toBe(0n)
  })

  it('decodes the driver-owned header', () => {
    const value = (0x43415244n << 224n) | (1n << 216n) | (17n << 176n) | (1234n << 128n) | (5678n << 80n)
    expect(decodeHeader(`0x${value.toString(16).padStart(64, '0')}` as Hex)).toEqual({
      formatted: true,
      magic: 'CARD',
      version: 1,
      writes: 17,
      firstWriteBlock: 1234n,
      lastWriteBlock: 5678n,
    })
    expect(decodeHeader(zero).formatted).toBe(false)
  })

  it('encodes printable ASCII and renders non-printables as middle dots', () => {
    const encoded = encodeAscii('HELLO', 32, 1)
    expect(decodeAscii(encoded, 32)).toBe('HELLO')
    const dirty = `0x410142${'00'.repeat(29)}` as Hex
    expect(decodeAscii([dirty], 32)).toBe('A·B')
    expect(() => encodeAscii('bad\ntext', 32, 1)).toThrow(/ASCII/)
  })

  it('packs the 32x32 icon high-nibble first', () => {
    const pixels = new Uint8Array(1024)
    pixels[0] = 0xa
    pixels[1] = 0x3
    pixels[1022] = 0xf
    pixels[1023] = 0x4
    const packed = packCardIcon(pixels)
    expect(packed[0].slice(2, 4)).toBe('a3')
    expect(packed[15].slice(-2)).toBe('f4')
    expect(unpackCardIcon(packed)).toEqual(pixels)
  })

  it('derives used bytes, regions and non-standard reserve words', () => {
    const page = words()
    page[0] = `0x${'00'.repeat(31)}01` as Hex
    page[24] = `0x${'00'.repeat(31)}02` as Hex
    expect(usedBytes(page)).toBe(64)
    expect(regionOf(0)).toBe('HEADER')
    expect(regionOf(0x20)).toBe('LABEL')
    expect(regionOf(0x40)).toBe('ICON')
    expect(regionOf(0x240)).toBe('MESSAGE')
    expect(regionOf(0x2c0)).toBe('FLAGS')
    expect(regionOf(0x300)).toBe('CARD BUS')
    expect(regionOf(0x400)).toBe('USER')
    expect(nonStandardReserved(page)).toEqual([24])
  })

  it('finds a minimal changed range but never includes header word zero', () => {
    const before = words()
    const after = words()
    after[0] = `0x${'11'.repeat(32)}` as Hex
    after[2] = `0x${'22'.repeat(32)}` as Hex
    after[5] = `0x${'55'.repeat(32)}` as Hex
    const range = changedCardWordRange(before, after)
    expect(range?.offset).toBe(2)
    expect(range?.words).toHaveLength(4)
  })

  it('resolves index, then remembered id, then honest balance-only states', () => {
    expect(
      resolveCardDiscovery({
        indexedFound: true,
        indexedId: 9n,
        indexedOwner: alice,
        rememberedId: 8n,
        rememberedOwner: alice,
        wallet: alice,
        balance: 1n,
      }),
    ).toMatchObject({ status: 'present', cardId: 9n, source: 'index' })
    expect(
      resolveCardDiscovery({
        indexedFound: true,
        indexedId: 9n,
        indexedOwner: bob,
        rememberedId: 8n,
        rememberedOwner: alice,
        wallet: alice,
        balance: 1n,
      }),
    ).toMatchObject({ status: 'present', cardId: 8n, source: 'remembered' })
    expect(
      resolveCardDiscovery({
        indexedFound: false,
        wallet: alice,
        balance: 1n,
      }),
    ).toMatchObject({ status: 'unknown-id' })
    expect(
      resolveCardDiscovery({
        indexedFound: false,
        wallet: alice,
        balance: 0n,
      }),
    ).toMatchObject({ status: 'empty' })
  })
  it('derives truthful Device Manager card sources for official and mock contracts', () => {
    expect(cardPropertySources({ official: true })).toMatchObject({
      manufacturer: 'spec',
      soulbound: 'spec',
    })
    expect(
      cardPropertySources({ official: true, erc5192: true, locked: true, codeBytes: 123, driverVersion: 1n }),
    ).toEqual({ manufacturer: 'spec', soulbound: 'onchain', code: 'measured', driver: 'onchain' })
    expect(cardPropertySources({ official: false, erc5192: false, codeBytes: 99 })).toMatchObject({
      manufacturer: 'unknown',
      soulbound: 'unknown',
      code: 'measured',
    })
  })
})
