import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanNadName,
  nadNameOf,
  nicknameFor,
  painterName,
  __resetPainterNamesForTests,
  __setPainterNameForTests,
} from './names'

const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('painter names', () => {
  afterEach(() => __resetPainterNamesForTests())

  it('gives every wallet the same readable nickname on every screen', () => {
    expect(nicknameFor(A)).toBe(nicknameFor(A.toLowerCase()))
    expect(nicknameFor(A)).toMatch(/^[a-z]+ [a-z]+·79c8$/)
    expect(nicknameFor('0x0000000000000000000000000000000000000001')).not.toBe(nicknameFor(A))
  })

  it('shows plain .nad names and refuses look-alikes', () => {
    expect(cleanNadName('dreiki')).toBe('dreiki.nad')
    expect(cleanNadName('Dreiki.nad')).toBe('dreiki.nad')
    expect(cleanNadName('')).toBeUndefined()
    expect(cleanNadName('drеiki')).toBeUndefined() // Cyrillic е
    expect(cleanNadName('a'.repeat(25))).toBeUndefined()
    expect(cleanNadName('<b>hi</b>')).toBeUndefined()
    expect(cleanNadName(42)).toBeUndefined()
  })

  it('prefers a known .nad name, falls back to the nickname, and leaves non-addresses alone', () => {
    expect(painterName(A)).toBe(nicknameFor(A))
    __setPainterNameForTests(A, 'dreiki.nad')
    expect(painterName(A)).toBe('dreiki.nad')
    expect(painterName(undefined)).toBe('—')
    expect(painterName('not-an-address')).toBe('not-an-address')
    expect(nadNameOf(A)).toBe('dreiki.nad')
    __setPainterNameForTests(A, undefined)
    expect(nadNameOf(A)).toBeNull()
    expect(nadNameOf('0x0000000000000000000000000000000000000009')).toBeUndefined()
  })
})
