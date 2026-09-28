import type { Transport } from 'viem'

type Counts = Record<string, number>

const counts: Counts = {}
let timer: number | undefined

export function countRpc(method: string) {
  if (!import.meta.env.DEV) return
  counts[method] = (counts[method] ?? 0) + 1
}

export function rpcStatsSnapshot(): Counts {
  return { ...counts }
}

export function resetRpcStats() {
  for (const method of Object.keys(counts)) delete counts[method]
}

export function startRpcStatsLogger() {
  if (!import.meta.env.DEV || typeof window === 'undefined' || timer != null) return
  timer = window.setInterval(() => {
    const snapshot = rpcStatsSnapshot()
    if (Object.keys(snapshot).length) console.debug('[r3os rpc / 10s]', snapshot)
    resetRpcStats()
  }, 10_000)
}

export function withRpcStats(transport: Transport): Transport {
  if (!import.meta.env.DEV) return transport
  return ((options) => {
    const inner = transport(options)
    return {
      ...inner,
      async request(args) {
        countRpc(args.method)
        return inner.request(args)
      },
    }
  }) as Transport
}
