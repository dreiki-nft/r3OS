import type { Transport } from 'viem'

type Counts = Record<string, number>

const counts: Counts = {}
const totals: Counts = {}
let timer: number | undefined

function clear(input: Counts) {
  for (const method of Object.keys(input)) delete input[method]
}

export function countRpc(method: string) {
  counts[method] = (counts[method] ?? 0) + 1
  totals[method] = (totals[method] ?? 0) + 1
}

export function rpcStatsSnapshot(): Counts {
  return { ...counts }
}

export function rpcStatsTotalSnapshot(): Counts {
  return { ...totals }
}

/** Explicit developer/test reset. The rolling logger only clears the short window, not since-boot totals. */
export function resetRpcStats() {
  clear(counts)
  clear(totals)
}

export function startRpcStatsLogger() {
  if (typeof window === 'undefined' || timer != null) return
  timer = window.setInterval(() => {
    const snapshot = rpcStatsSnapshot()
    if (import.meta.env.DEV && Object.keys(snapshot).length) console.debug('[r3os rpc / 10s]', snapshot)
    clear(counts)
  }, 10_000)
}

export function withRpcStats(transport: Transport): Transport {
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
