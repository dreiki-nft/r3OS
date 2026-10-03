import type { Hex, TransactionReceipt } from 'viem'
import { actionEndpointClients } from './clients'

export interface ActionRpcClient {
  getBlockNumber(args?: { cacheTime?: number }): Promise<bigint>
  estimateFeesPerGas(): Promise<unknown>
  estimateContractGas(args: unknown): Promise<bigint>
  simulateContract(args: unknown): Promise<unknown>
  getBalance(args: { address: Hex }): Promise<bigint>
  getTransactionCount(args: { address: Hex; blockTag: 'pending' }): Promise<number>
  getTransactionReceipt(args: { hash: Hex }): Promise<TransactionReceipt>
  sendRawTransaction(args: { serializedTransaction: Hex }): Promise<Hex>
}

export interface ActionRpcEndpointState {
  index: number
  samples: number
  successes: number
  failures: number
  consecutiveFailures: number
  lastMs?: number
  ewmaMs?: number
  lastSuccessAt?: number
  lastFailureAt?: number
  cooldownUntil?: number
}

export interface ActionRpcSnapshot {
  version: number
  endpoints: readonly ActionRpcEndpointState[]
}

type Listener = () => void

const DEFAULT_RECEIPT_TIMEOUT_MS = 15_000
const RECEIPT_POLL_MS = 120
const RECEIPT_HEDGE_AFTER_MS = 900
const EWMA_ALPHA = 0.35

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function textOf(error: unknown) {
  return error instanceof Error ? `${error.name} ${error.message}` : String(error)
}

export function isRpcInfrastructureError(error: unknown) {
  const text = textOf(error).toLowerCase()
  return (
    /failed to fetch|networkerror|network request|timeout|timed out|http request failed|socket|econn|connection reset|connection refused/.test(
      text,
    ) ||
    /temporarily unavailable|service unavailable|bad gateway|gateway timeout|\b429\b|rate.?limit|too many requests|\b502\b|\b503\b|\b504\b/.test(
      text,
    )
  )
}

export function isAlreadyKnownRawTx(error: unknown) {
  return /already known|known transaction|already imported|already exists|tx already exists/i.test(textOf(error))
}

function isReceiptPending(error: unknown) {
  return /transactionreceipt.*notfound|transaction receipt.*not found|receipt.*could not be found|receipt.*not found/i.test(
    textOf(error),
  )
}

function publicState(state: ActionRpcEndpointState): ActionRpcEndpointState {
  return { ...state }
}

export function createActionRpcPool(clients: readonly ActionRpcClient[]) {
  let version = 0
  const states: ActionRpcEndpointState[] = clients.map((_, index) => ({
    index,
    samples: 0,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
  }))
  let snapshot: ActionRpcSnapshot = { version, endpoints: states.map(publicState) }
  const listeners = new Set<Listener>()

  const emit = () => {
    snapshot = { version: ++version, endpoints: states.map(publicState) }
    for (const listener of listeners) listener()
  }

  const mark = (index: number, ms: number, ok: boolean) => {
    const state = states[index]
    if (!state) return
    state.samples += 1
    state.lastMs = ms
    if (ok) {
      state.successes += 1
      state.consecutiveFailures = 0
      state.lastSuccessAt = Date.now()
      state.cooldownUntil = undefined
      state.ewmaMs = state.ewmaMs == null ? ms : state.ewmaMs * (1 - EWMA_ALPHA) + ms * EWMA_ALPHA
    } else {
      state.failures += 1
      state.consecutiveFailures += 1
      state.lastFailureAt = Date.now()
      if (state.consecutiveFailures >= 2) {
        const backoff = Math.min(15_000, 2_500 * 2 ** Math.min(2, state.consecutiveFailures - 2))
        state.cooldownUntil = Date.now() + backoff
      }
    }
    emit()
  }

  const score = (state: ActionRpcEndpointState) => {
    const cooldown = state.cooldownUntil && state.cooldownUntil > Date.now() ? 100_000 : 0
    const latency = state.ewmaMs ?? 450 + state.index * 10
    return cooldown + latency + state.consecutiveFailures * 2_000
  }

  const ranked = () => states.map((state) => state.index).sort((a, b) => score(states[a]) - score(states[b]))

  const measured = async <T>(index: number, work: (client: ActionRpcClient) => Promise<T>) => {
    const started = now()
    try {
      const result = await work(clients[index])
      mark(index, now() - started, true)
      return result
    } catch (error) {
      const elapsed = now() - started
      if (isRpcInfrastructureError(error)) mark(index, elapsed, false)
      else mark(index, elapsed, true)
      throw error
    }
  }

  const request = async <T>(work: (client: ActionRpcClient) => Promise<T>): Promise<T> => {
    if (!clients.length) throw new Error('DEMO_MODE')
    let lastError: unknown
    for (const index of ranked()) {
      try {
        return await measured(index, work)
      } catch (error) {
        lastError = error
        if (!isRpcInfrastructureError(error)) throw error
      }
    }
    throw Object.assign(new Error('ACTION_RPC_UNAVAILABLE'), { cause: lastError })
  }

  const probe = async () => {
    if (!clients.length) return snapshot
    await Promise.allSettled(
      clients.map((_, index) => measured(index, (client) => client.getBlockNumber({ cacheTime: 0 }))),
    )
    return snapshot
  }

  const waitForBalance = async (address: Hex, minimum: bigint, timeoutMs = 5_000) => {
    if (!clients.length) throw new Error('DEMO_MODE')
    const started = now()
    let lastBalance = 0n
    while (now() - started < timeoutMs) {
      try {
        lastBalance = await request((client) => client.getBalance({ address }))
        if (lastBalance >= minimum) return lastBalance
      } catch (error) {
        // request() already fails over infrastructure errors. A balance readiness barrier should not
        // turn one malformed/stale provider response into a false Live-start failure; keep polling until
        // timeout so a healthy endpoint can become authoritative.
        if (!isRpcInfrastructureError(error)) {
          await sleep(120)
          continue
        }
      }
      await sleep(120)
    }
    throw Object.assign(new Error('ACTION_BALANCE_SYNC_TIMEOUT'), {
      balance: lastBalance,
      minimum,
    })
  }

  const waitForFundingSettlement = async (
    address: Hex,
    minimum: bigint,
    fundingBlock: bigint,
    options: { timeoutMs?: number; settleBlocks?: bigint; pollMs?: number; quorum?: number } = {},
  ) => {
    if (!clients.length) throw new Error('DEMO_MODE')
    const timeoutMs = options.timeoutMs ?? 8_000
    const settleBlocks = options.settleBlocks ?? 3n
    const pollMs = options.pollMs ?? 150
    const quorum = Math.max(1, Math.min(options.quorum ?? Math.min(2, clients.length), clients.length))
    const targetBlock = fundingBlock + settleBlocks
    const started = now()
    let bestReady = 0
    let highestBlock = 0n

    while (now() - started < timeoutMs) {
      const checks = await Promise.all(
        clients.map(async (_, index) => {
          try {
            const [block, balance] = await measured(index, async (client) =>
              Promise.all([client.getBlockNumber({ cacheTime: 0 }), client.getBalance({ address })]),
            )
            if (block > highestBlock) highestBlock = block
            return block >= targetBlock && balance >= minimum
          } catch {
            return false
          }
        }),
      )
      const ready = checks.filter(Boolean).length
      bestReady = Math.max(bestReady, ready)
      const preferred = ranked()[0]
      // The next quote uses request(), which starts with the currently top-ranked endpoint. Do not release
      // the barrier just because two slower peers are caught up while the endpoint quoteAction will actually
      // choose is still stale. Require the preferred endpoint plus the quorum to be ready.
      if (ready >= quorum && checks[preferred]) {
        return { targetBlock, quorum, ready, preferred }
      }
      await sleep(pollMs)
    }

    throw Object.assign(new Error('ACTION_FUNDING_SETTLEMENT_TIMEOUT'), {
      minimum,
      fundingBlock,
      targetBlock,
      highestBlock,
      ready: bestReady,
      quorum,
    })
  }

  const broadcast = async (serializedTransaction: Hex, expectedHash: Hex) => {
    if (!clients.length) throw new Error('DEMO_MODE')
    const attempts = clients.map((_, index) =>
      measured(index, async (client) => {
        try {
          const hash = await client.sendRawTransaction({ serializedTransaction })
          if (hash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('RAW_TX_HASH_MISMATCH')
          return { hash, endpointIndex: index }
        } catch (error) {
          if (isAlreadyKnownRawTx(error)) return { hash: expectedHash, endpointIndex: index }
          throw error
        }
      }),
    )
    try {
      return await Promise.any(attempts)
    } catch (error) {
      const aggregate = error as AggregateError
      const semanticError = aggregate.errors?.find((candidate) => !isRpcInfrastructureError(candidate))
      // Preserve chain-level errors such as "nonce too low" so the nonce manager can resync once and retry.
      if (semanticError) throw semanticError
      throw Object.assign(new Error('ACTION_RPC_BROADCAST_FAILED'), { cause: aggregate.errors?.[0] ?? error })
    }
  }

  const waitForReceipt = async (hash: Hex, timeoutMs = DEFAULT_RECEIPT_TIMEOUT_MS) => {
    if (!clients.length) throw new Error('DEMO_MODE')
    const started = now()
    while (now() - started < timeoutMs) {
      const order = ranked()
      const elapsed = now() - started
      const indices = elapsed >= RECEIPT_HEDGE_AFTER_MS && order.length > 1 ? order.slice(0, 2) : order.slice(0, 1)
      const checks = await Promise.all(
        indices.map(async (index) => {
          const checkedAt = now()
          try {
            const receipt = await clients[index].getTransactionReceipt({ hash })
            mark(index, now() - checkedAt, true)
            return receipt
          } catch (error) {
            const ms = now() - checkedAt
            if (isReceiptPending(error)) {
              mark(index, ms, true)
              return undefined
            }
            if (isRpcInfrastructureError(error)) {
              mark(index, ms, false)
              return undefined
            }
            mark(index, ms, true)
            throw error
          }
        }),
      )
      const receipt = checks.find((value): value is TransactionReceipt => value != null)
      if (receipt) return receipt
      await sleep(RECEIPT_POLL_MS)
    }
    throw new Error('ACTION_RECEIPT_TIMEOUT')
  }

  return {
    request,
    probe,
    waitForBalance,
    waitForFundingSettlement,
    broadcast,
    waitForReceipt,
    ranked,
    getSnapshot: () => snapshot,
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset() {
      for (const state of states) {
        state.samples = 0
        state.successes = 0
        state.failures = 0
        state.consecutiveFailures = 0
        state.lastMs = undefined
        state.ewmaMs = undefined
        state.lastSuccessAt = undefined
        state.lastFailureAt = undefined
        state.cooldownUntil = undefined
      }
      emit()
    },
  }
}

const pool = createActionRpcPool(actionEndpointClients as unknown as ActionRpcClient[])

export const actionRpcRequest = pool.request
export const probeActionRpcs = pool.probe
export const waitForActionBalance = pool.waitForBalance
export const waitForActionFundingSettlement = pool.waitForFundingSettlement
export const broadcastActionRawTransaction = pool.broadcast
export const waitForActionReceipt = pool.waitForReceipt
export const getActionRpcSnapshot = pool.getSnapshot
export const subscribeActionRpc = pool.subscribe

export function actionRpcEndpointLabel(index: number) {
  return `RPC #${index + 1}`
}

export function formatActionRpcReport(input: ActionRpcSnapshot = pool.getSnapshot()) {
  const lines = ['ACTION RPC', `endpoints: ${input.endpoints.length}`]
  if (!input.endpoints.length) return [...lines, 'no HTTP action endpoints configured'].join('\n')
  for (const endpoint of input.endpoints) {
    const cooling = endpoint.cooldownUntil != null && endpoint.cooldownUntil > Date.now()
    const state = cooling
      ? 'cooldown'
      : endpoint.samples === 0
        ? 'unmeasured'
        : endpoint.consecutiveFailures
          ? 'degraded'
          : 'healthy'
    const latency = endpoint.ewmaMs == null ? '—' : `${endpoint.ewmaMs.toFixed(0)}ms ewma`
    lines.push(
      `${actionRpcEndpointLabel(endpoint.index)}: ${state} · ${latency} · ok ${endpoint.successes} · fail ${endpoint.failures}`,
    )
  }
  return lines.join('\n')
}

export function __resetActionRpcForTests() {
  pool.reset()
}
