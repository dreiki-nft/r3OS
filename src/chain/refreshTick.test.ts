import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __processRefreshBlockForTests,
  __refreshTickStateForTests,
  __resetRefreshTickForTests,
  __visibleRefreshForTests,
  bumpRefresh,
} from './refreshTick'

afterEach(() => {
  __resetRefreshTickForTests()
  vi.restoreAllMocks()
})

describe('refresh ticks', () => {
  it('ticks when the block bucket changes', () => {
    const state = __refreshTickStateForTests(10)
    state.lastBucket = 0n
    expect(__processRefreshBlockForTests(10, 9n)).toBe(false)
    expect(state.value).toBe(0)
    expect(__processRefreshBlockForTests(10, 10n)).toBe(true)
    expect(state.value).toBe(1)
    expect(__processRefreshBlockForTests(10, 19n)).toBe(false)
    expect(__processRefreshBlockForTests(10, 20n)).toBe(true)
    expect(state.value).toBe(2)
  })

  it('does not tick while hidden', () => {
    const state = __refreshTickStateForTests(10)
    state.lastBucket = 0n
    expect(__processRefreshBlockForTests(10, 20n, true)).toBe(false)
    expect(state.value).toBe(0)
    expect(state.lastBucket).toBe(0n)
  })

  it('ticks immediately when becoming visible, even in the same bucket', () => {
    const state = __refreshTickStateForTests(10)
    state.lastBucket = 2n
    __visibleRefreshForTests(10, 20n)
    expect(state.value).toBe(1)
    expect(state.lastBucket).toBe(2n)
  })

  it('ticks immediately after bumpRefresh', () => {
    const a = __refreshTickStateForTests(10)
    const b = __refreshTickStateForTests(20)
    bumpRefresh()
    expect(a.value).toBe(1)
    expect(b.value).toBe(1)
  })
})
