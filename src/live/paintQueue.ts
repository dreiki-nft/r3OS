export interface StrokeQueue {
  schedule: () => void
  cancel: () => void
  flush: () => Promise<void>
}

export function createStrokeQueue(send: () => Promise<void>, delay = 120): StrokeQueue {
  let timer: ReturnType<typeof setTimeout> | undefined
  let sending = false
  let queued = false

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, delay)
  }

  const flush = async () => {
    if (sending) {
      queued = true
      return
    }
    sending = true
    try {
      await send()
    } finally {
      sending = false
      if (queued) {
        queued = false
        schedule()
      }
    }
  }

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    queued = false
  }

  return { schedule, cancel, flush }
}
