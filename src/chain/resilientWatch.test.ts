import { afterEach, describe, expect, it, vi } from 'vitest'
import { resilientWatch } from './resilientWatch'

afterEach(() => {
  vi.useRealTimers()
})

describe('resilientWatch', () => {
  it('re-reads on an error and subscribes again after a pause', () => {
    vi.useFakeTimers()
    const errors: ((error: unknown) => void)[] = []
    const stops = [vi.fn(), vi.fn()]
    const start = vi.fn((onError: (error: unknown) => void) => {
      errors.push(onError)
      return stops[errors.length - 1]
    })
    const gap = vi.fn()
    const stop = resilientWatch(start, gap, 1_000)
    expect(start).toHaveBeenCalledTimes(1)
    errors[0](new Error('socket closed'))
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(gap).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_000)
    expect(start).toHaveBeenCalledTimes(2)
    expect(gap).toHaveBeenCalledTimes(2) // once more for what happened while it was down
    // A late error from the dropped watch changes nothing.
    errors[0](new Error('late'))
    expect(gap).toHaveBeenCalledTimes(2)
    stop()
    expect(stops[1]).toHaveBeenCalledTimes(1)
  })

  it('handles an error reported before start returns', () => {
    vi.useFakeTimers()
    const unwatch = vi.fn()
    const start = vi.fn((onError: (error: unknown) => void) => {
      onError(new Error('subscribe failed'))
      return unwatch
    })
    const stop = resilientWatch(start, undefined, 1_000)
    expect(unwatch).toHaveBeenCalledTimes(1)
    stop()
    vi.advanceTimersByTime(5_000)
    expect(start).toHaveBeenCalledTimes(1) // closed: no retry
  })
})
