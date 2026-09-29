import type { Transport } from 'viem'

type Queued = {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

/**
 * Per-endpoint token bucket. The bucket lives in this closure, not in the transport factory:
 * viem's `fallback` re-instantiates each inner transport on every request, so state created
 * inside the factory would be reset per call and never limit anything.
 */
export function rateLimited(transport: Transport, rps: number): Transport {
  if (rps <= 0) return transport
  const queue: Queued[] = []
  const starts: number[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let draining = false

  const drain = () => {
    if (draining) return
    draining = true
    try {
      const now = Date.now()
      while (starts.length && now - starts[0] >= 1_000) starts.shift()
      while (queue.length && starts.length < rps) {
        const item = queue.shift()!
        starts.push(Date.now())
        void item
          .run()
          .then(item.resolve, item.reject)
          .finally(() => drain())
      }
      if (queue.length) {
        const wait = Math.max(1, 1_000 - (Date.now() - starts[0]))
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          drain()
        }, wait)
      }
    } finally {
      draining = false
    }
  }

  return (options) => {
    const inner = transport(options)
    return {
      ...inner,
      config: {
        ...inner.config,
        key: `${inner.config.key}-rate-${rps}`,
        name: `${inner.config.name} rate limited`,
      },
      async request(args) {
        return new Promise((resolve, reject) => {
          queue.push({ run: () => inner.request(args), resolve, reject })
          drain()
        }) as Promise<any>
      },
    }
  }
}
