import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStrokeQueue } from './paintQueue'

describe('live paint queue', () => {
  afterEach(() => vi.useRealTimers())

  it('coalesces strokes inside the live-mode debounce into one send', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValue(undefined)
    const queue = createStrokeQueue(send, 120)
    queue.schedule()
    await vi.advanceTimersByTimeAsync(80)
    queue.schedule()
    await vi.advanceTimersByTimeAsync(119)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('never overlaps sends and queues one follow-up', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const send = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValueOnce(undefined)
    const queue = createStrokeQueue(send, 120)
    queue.schedule()
    await vi.advanceTimersByTimeAsync(120)
    queue.schedule()
    await vi.advanceTimersByTimeAsync(120)
    expect(send).toHaveBeenCalledTimes(1)
    release()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(120)
    expect(send).toHaveBeenCalledTimes(2)
  })
})
