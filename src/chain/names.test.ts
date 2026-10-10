import { afterEach, describe, expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({ next: undefined as (() => Promise<unknown>) | undefined }))
vi.mock('./config', async (load) => {
  const actual = await load<typeof import('./config')>()
  return { ...actual, config: { ...actual.config, chainId: 143, demo: false } }
})
vi.mock('./readMany', () => ({ readMany: () => reads.next!() }))

import {
  cleanNadName,
  nadNameOf,
  nadNameStatus,
  nicknameFor,
  painterName,
  refreshPainterName,
  __flushPainterNamesForTests,
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
    expect(cleanNadName('a'.repeat(32))).toBe(`${'a'.repeat(32)}.nad`)
    expect(cleanNadName('a'.repeat(33))).toBeUndefined()
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

  it('never mistakes a failed RPC call for "this wallet has no name"', async () => {
    reads.next = () => Promise.reject(new Error('fetch failed'))
    expect(nadNameStatus(A)).toBe('loading')
    await __flushPainterNamesForTests()
    expect(nadNameStatus(A)).toBe('loading')
    expect(nadNameOf(A)).toBeUndefined()
  })

  it('tells "no primary name" apart from "a name r3OS will not show"', async () => {
    const B = '0x0000000000000000000000000000000000000002'
    const C = '0x0000000000000000000000000000000000000003'
    reads.next = () =>
      Promise.resolve([
        { status: 'success', result: '' },
        { status: 'failure', error: new Error('reverted') },
        { status: 'success', result: '🐸frog' },
      ])
    nadNameStatus(A)
    nadNameStatus(B)
    nadNameStatus(C)
    await __flushPainterNamesForTests()
    expect(nadNameStatus(A)).toBe('none')
    expect(nadNameStatus(B)).toBe('none')
    expect(nadNameStatus(C)).toBe('hidden')
    expect(painterName(C)).toBe(nicknameFor(C))
  })

  it('looks a wallet up again on "check again", right after it sets a primary name', async () => {
    reads.next = () => Promise.resolve([{ status: 'success', result: '' }])
    nadNameStatus(A)
    await __flushPainterNamesForTests()
    expect(nadNameStatus(A)).toBe('none')
    reads.next = () => Promise.resolve([{ status: 'success', result: 'dreiki' }])
    refreshPainterName(A)
    expect(nadNameStatus(A)).toBe('loading')
    await __flushPainterNamesForTests()
    expect(nadNameStatus(A)).toBe('name')
    expect(painterName(A)).toBe('dreiki.nad')
  })
})
