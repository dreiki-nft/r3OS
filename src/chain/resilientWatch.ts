/**
 * A websocket event watch that survives errors. viem only reports a failed or dropped subscription through
 * `onError`; without one the watch goes quiet and whatever it keeps fresh slowly goes stale. On an error this
 * drops the watch, calls `onGap` so the caller can re-read what it may have missed, and subscribes again after
 * `retryMs`, calling `onGap` once more when the new watch is in place.
 */
export function resilientWatch(
  start: (onError: (error: unknown) => void) => () => void,
  onGap?: () => void,
  retryMs = 5_000,
) {
  let stop: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let attempt = 0

  const begin = (resumed: boolean) => {
    if (closed) return
    const mine = ++attempt
    let failedEarly = false
    const onError = () => {
      if (closed || mine !== attempt) return
      attempt++
      if (stop) {
        stop()
        stop = undefined
      } else failedEarly = true
      onGap?.()
      timer = setTimeout(() => begin(true), retryMs)
    }
    const unwatch = start(onError)
    // The error arrived before `start` returned: this watch is already abandoned.
    if (failedEarly) unwatch()
    else {
      stop = unwatch
      if (resumed) onGap?.()
    }
  }

  begin(false)
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    stop?.()
    stop = undefined
  }
}
