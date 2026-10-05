import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import { config } from './config'
import { recordPerf } from './perf'
import { countRpc } from './rpcStats'

interface RpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: readonly unknown[]
}

interface RpcResponse {
  jsonrpc?: '2.0'
  id?: number
  result?: unknown
  error?: { code?: number; message?: string }
}

export interface BootPacketSnapshot {
  at: number
  elapsedMs: number
  memberCount: number
  httpRequests: number
  paintAddress?: Address
  chainId?: number
  blockNumber?: bigint
  clientVersion?: string
  paintCode?: Hex
  multicallCode?: Hex
  painterPass?: Address
  r3tards?: Address
  experimentCount?: number
  renderersFrozen?: boolean
  experimentsFrozen?: boolean
  complete: boolean
  source?: 'accelerator' | 'public'
  acceleratorAttempted?: boolean
}

const FUNCTION_KEYS = {
  painterPass: 'painterPass',
  r3tards: 'R3TARDS',
  experimentCount: 'experimentCount',
  renderersFrozen: 'renderersFrozen',
  experimentsFrozen: 'experimentsFrozen',
} as const

type FunctionKey = keyof typeof FUNCTION_KEYS

let snapshot: BootPacketSnapshot | undefined
let inflight: Promise<BootPacketSnapshot | undefined> | undefined

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function hexBigInt(value: unknown) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return undefined
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

function callData(functionName: string) {
  return encodeFunctionData({
    abi: R3OS_PAINT_ABI,
    functionName: functionName as never,
  })
}

function request(id: number, method: string, params: readonly unknown[] = []): RpcRequest {
  return { jsonrpc: '2.0', id, method, params }
}

export function buildBootPacketRequests(
  paintAddress = config.paintAddress,
  multicallAddress = config.multicall3Address,
): { key: string; request: RpcRequest }[] {
  let nextId = 1
  const rpc = (method: string, params: readonly unknown[] = []) => request(nextId++, method, params)
  const out = [
    { key: 'chainId', request: rpc('eth_chainId') },
    { key: 'blockNumber', request: rpc('eth_blockNumber') },
    { key: 'clientVersion', request: rpc('web3_clientVersion') },
  ]

  if (paintAddress) {
    out.push({ key: 'paintCode', request: rpc('eth_getCode', [paintAddress, 'latest']) })
  }
  if (multicallAddress) {
    out.push({ key: 'multicallCode', request: rpc('eth_getCode', [multicallAddress, 'latest']) })
  }
  if (paintAddress) {
    for (const [key, functionName] of Object.entries(FUNCTION_KEYS)) {
      out.push({
        key,
        request: rpc('eth_call', [{ to: paintAddress, data: callData(functionName) }, 'latest']),
      })
    }
  }

  return out
}

function decodeFunction(functionName: string, value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('0x')) return undefined
  try {
    return decodeFunctionResult({
      abi: R3OS_PAINT_ABI,
      functionName: functionName as never,
      data: value as Hex,
    })
  } catch {
    return undefined
  }
}

export function decodeBootPacket(
  entries: readonly { key: string; request: RpcRequest }[],
  responses: readonly RpcResponse[],
  meta: { elapsedMs: number; httpRequests: number; paintAddress?: Address } = {
    elapsedMs: 0,
    httpRequests: 0,
  },
): BootPacketSnapshot {
  const byId = new Map(responses.map((response) => [response.id, response]))
  const value = (key: string) => {
    const entry = entries.find((candidate) => candidate.key === key)
    return entry ? byId.get(entry.request.id)?.result : undefined
  }

  const chain = hexBigInt(value('chainId'))
  const block = hexBigInt(value('blockNumber'))
  const count = decodeFunction(FUNCTION_KEYS.experimentCount, value('experimentCount'))
  const pass = decodeFunction(FUNCTION_KEYS.painterPass, value('painterPass'))
  const r3tards = decodeFunction(FUNCTION_KEYS.r3tards, value('r3tards'))
  const renderersFrozen = decodeFunction(FUNCTION_KEYS.renderersFrozen, value('renderersFrozen'))
  const experimentsFrozen = decodeFunction(FUNCTION_KEYS.experimentsFrozen, value('experimentsFrozen'))
  const paintCode = value('paintCode')
  const multicallCode = value('multicallCode')
  const clientVersion = value('clientVersion')

  const decoded: BootPacketSnapshot = {
    at: Date.now(),
    elapsedMs: meta.elapsedMs,
    memberCount: entries.length,
    httpRequests: meta.httpRequests,
    paintAddress: meta.paintAddress,
    chainId: chain == null ? undefined : Number(chain),
    blockNumber: block,
    clientVersion: typeof clientVersion === 'string' ? clientVersion : undefined,
    paintCode: typeof paintCode === 'string' ? (paintCode as Hex) : undefined,
    multicallCode: typeof multicallCode === 'string' ? (multicallCode as Hex) : undefined,
    painterPass: typeof pass === 'string' ? (pass as Address) : undefined,
    r3tards: typeof r3tards === 'string' ? (r3tards as Address) : undefined,
    experimentCount: typeof count === 'bigint' ? Number(count) : undefined,
    renderersFrozen: typeof renderersFrozen === 'boolean' ? renderersFrozen : undefined,
    experimentsFrozen: typeof experimentsFrozen === 'boolean' ? experimentsFrozen : undefined,
    complete: false,
  }

  decoded.complete =
    decoded.chainId != null &&
    decoded.blockNumber != null &&
    Boolean(decoded.clientVersion) &&
    (!meta.paintAddress ||
      (decoded.paintCode != null &&
        decoded.paintCode !== '0x' &&
        decoded.painterPass != null &&
        decoded.r3tards != null &&
        decoded.experimentCount != null &&
        decoded.renderersFrozen != null &&
        decoded.experimentsFrozen != null))

  return decoded
}

async function postBatch(url: string, batch: readonly RpcRequest[], timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (const member of batch) countRpc(member.method)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`BOOT_PACKET_HTTP_${response.status}`)
    const body = (await response.json()) as unknown
    if (!Array.isArray(body)) throw new Error('BOOT_PACKET_BATCH_UNSUPPORTED')
    return body as RpcResponse[]
  } finally {
    clearTimeout(timer)
  }
}

async function sendChunk(
  url: string,
  batch: readonly RpcRequest[],
  timeoutMs: number,
  allowSplit: boolean,
): Promise<{ responses: RpcResponse[]; httpRequests: number }> {
  try {
    return { responses: await postBatch(url, batch, timeoutMs), httpRequests: 1 }
  } catch (error) {
    if (!allowSplit || batch.length <= 1) throw error
    const middle = Math.ceil(batch.length / 2)
    const [left, right] = await Promise.all([
      sendChunk(url, batch.slice(0, middle), timeoutMs, allowSplit),
      sendChunk(url, batch.slice(middle), timeoutMs, allowSplit),
    ])
    return {
      responses: [...left.responses, ...right.responses],
      httpRequests: 1 + left.httpRequests + right.httpRequests,
    }
  }
}

export async function fetchBootPacketUsing(
  url: string,
  options: {
    paintAddress?: Address
    multicallAddress?: Address
    batchSize?: number
    timeoutMs?: number
    allowBatchSplit?: boolean
  } = {},
) {
  const entries = buildBootPacketRequests(options.paintAddress, options.multicallAddress)
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 10))
  const timeoutMs = Math.max(200, Math.floor(options.timeoutMs ?? 900))
  const allowBatchSplit = options.allowBatchSplit ?? true
  const chunks: typeof entries[] = []
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    chunks.push(entries.slice(offset, offset + batchSize))
  }

  const started = now()
  const parts = await Promise.all(
    chunks.map(async (chunk) => ({
      chunk,
      result: await sendChunk(
        url,
        chunk.map((entry) => entry.request),
        timeoutMs,
        allowBatchSplit,
      ),
    })),
  )
  const elapsedMs = now() - started
  return decodeBootPacket(
    entries,
    parts.flatMap((part) => part.result.responses),
    {
      elapsedMs,
      httpRequests: parts.reduce((sum, part) => sum + part.result.httpRequests, 0),
      paintAddress: options.paintAddress,
    },
  )
}


export async function fetchPreferredBootPacketUsing(options: {
  publicUrl: string
  acceleratorUrl?: string
  expectedChainId: number
  paintAddress?: Address
  multicallAddress?: Address
  batchSize?: number
  publicTimeoutMs?: number
  acceleratorTimeoutMs?: number
}) {
  const started = now()
  const common = {
    paintAddress: options.paintAddress,
    multicallAddress: options.multicallAddress,
  }
  const acceleratorEnabled = Boolean(options.acceleratorUrl) && options.expectedChainId === 143
  let acceleratorAttempted = false

  if (acceleratorEnabled) {
    acceleratorAttempted = true
    try {
      // The Worker intentionally accepts one exact ten-member Boot Packet, independent of
      // whatever smaller batch size a public provider may require.
      const accelerated = await fetchBootPacketUsing(options.acceleratorUrl!, {
        ...common,
        batchSize: 10,
        timeoutMs: options.acceleratorTimeoutMs ?? 650,
        // The Worker exposes one exact Boot Packet operation. Any Worker/upstream failure
        // should fall through to direct public RPC immediately, not recursively retry the
        // same edge endpoint as smaller batches (especially on 429/rate-limit responses).
        allowBatchSplit: false,
      })
      if (accelerated.chainId !== options.expectedChainId) throw new Error('BOOT_PACKET_CHAIN_MISMATCH')
      if (!accelerated.complete) throw new Error('BOOT_PACKET_INCOMPLETE')
      return {
        ...accelerated,
        elapsedMs: now() - started,
        source: 'accelerator' as const,
        acceleratorAttempted,
      }
    } catch {
      // Optional only. Public direct RPC remains the fallback and canonical browser path.
    }
  }

  const direct = await fetchBootPacketUsing(options.publicUrl, {
    ...common,
    batchSize: options.batchSize,
    timeoutMs: options.publicTimeoutMs ?? 900,
  })
  if (direct.chainId !== options.expectedChainId) throw new Error('BOOT_PACKET_CHAIN_MISMATCH')
  return {
    ...direct,
    elapsedMs: now() - started,
    source: 'public' as const,
    acceleratorAttempted,
  }
}

/**
 * Mainnet startup packet: one bounded burst of independent JSON-RPC reads on the primary browser-safe lane.
 * Failure is intentionally non-fatal; the existing fallback/publicClient paths remain authoritative.
 */
export function prefetchBootPacket(force = false): Promise<BootPacketSnapshot | undefined> {
  if (snapshot && !force) return Promise.resolve(snapshot)
  if (inflight && !force) return inflight
  if (config.demo || !config.rpcUrl || config.rpcBatchSize <= 0) return Promise.resolve(undefined)

  const pending = fetchPreferredBootPacketUsing({
    publicUrl: config.rpcUrl,
    acceleratorUrl: config.fastlaneAcceleratorUrl || undefined,
    expectedChainId: config.chainId,
    paintAddress: config.paintAddress,
    multicallAddress: config.multicall3Address,
    batchSize: config.rpcBatchSize,
    acceleratorTimeoutMs: config.fastlaneAcceleratorTimeoutMs,
  })
    .then((value) => {
      snapshot = value
      recordPerf('boot-prefetch', 'boot-packet', value.elapsedMs)
      return value
    })
    .catch(() => undefined)
    .finally(() => {
      if (inflight === pending) inflight = undefined
    })
  inflight = pending
  return pending
}

export function getBootPacketSnapshot() {
  return snapshot
}

export function __setBootPacketForTests(value?: BootPacketSnapshot) {
  snapshot = value
  inflight = undefined
}
