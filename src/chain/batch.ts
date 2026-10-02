import {
  encodeFunctionData,
  type Abi,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type Log,
} from 'viem'
import { playSound } from '../os/sound'
import { appChain, publicClient } from './clients'
import { config } from './config'
import { friendlyError } from './errors'
import { bumpRefresh } from './refreshTick'
import { quoteAction, sendAction, type ActionQuote, type ContractActionOptions } from './tx'
import { markTraceReceipt, recordTxTrace } from './txTrace'
import { getWalletSnapshot, refreshWalletBalance } from './wallet'

/**
 * Several contract calls that belong to one task (approve + list, claim 3 quests). A wallet that supports
 * EIP-5792 atomic batches gets them as ONE `wallet_sendCalls` request: one confirm, all-or-nothing. Any other
 * wallet (or the Live mode burner) gets them one after another through `sendAction`.
 *
 * `quote` may be left out when a call can only be priced after an earlier one lands (list needs the approval
 * first). The sequential path then quotes it just before sending; a batching wallet estimates the whole batch
 * itself.
 */
export type BatchItem = Omit<ContractActionOptions, 'quote'> & { quote?: ActionQuote }

export interface SendActionsOptions {
  /** One name for the whole task, shown in X-ray and errors (e.g. "approve and list finale"). */
  action: string
  successSound?: 'success-light' | 'success-heavy'
  /** Called before each wallet prompt: `index` of `total`, or once with `batched: true`. */
  onStep?: (step: { index: number; total: number; batched: boolean }) => void
}

export interface SendActionsResult {
  batched: boolean
  hashes: Hex[]
  logs: Log[]
}

/** Wallet errors that mean "this wallet can't do atomic batches here", so we fall back instead of failing. */
const UNSUPPORTED_CODES = new Set([4200, -32601, -32602, 5700, 5710, 5750])

const supportCache = new WeakMap<object, Map<string, Promise<boolean>>>()

export function atomicBatchSupported(capabilities: unknown) {
  const atomic = (capabilities as { atomic?: { status?: unknown } } | undefined)?.atomic
  return atomic?.status === 'supported' || atomic?.status === 'ready'
}

function errorCode(error: unknown): number | undefined {
  let current = error as { code?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 6; depth++) {
    if (typeof current.code === 'number') return current.code
    current = current.cause as typeof current
  }
  return undefined
}

export function batchUnsupportedError(error: unknown) {
  const code = errorCode(error)
  if (code != null && UNSUPPORTED_CODES.has(code)) return true
  const message = error instanceof Error ? error.message : String(error)
  return /wallet_sendCalls.*(not supported|does not exist|unsupported)|method not found/i.test(message)
}

/** True when the connected wallet can send atomic call batches on this chain. Cached per wallet + account. */
export function walletCanBatch(account = getWalletSnapshot().account): Promise<boolean> {
  const { client, provider } = getWalletSnapshot()
  if (!client || !provider || !account || config.demo) return Promise.resolve(false)
  let byAccount = supportCache.get(provider)
  if (!byAccount) {
    byAccount = new Map()
    supportCache.set(provider, byAccount)
  }
  const key = `${config.chainId}:${account.toLowerCase()}`
  let cached = byAccount.get(key)
  if (!cached) {
    cached = client
      .getCapabilities({ account, chainId: config.chainId })
      .then(atomicBatchSupported)
      .catch(() => false)
    byAccount.set(key, cached)
  }
  return cached
}

function forgetBatchSupport(account: string) {
  const { provider } = getWalletSnapshot()
  if (provider)
    supportCache.get(provider)?.set(`${config.chainId}:${account.toLowerCase()}`, Promise.resolve(false))
}

function wrap(error: unknown, functionName?: string) {
  const friendly = friendlyError(error, functionName)
  return Object.assign(new Error(friendly.message), { friendly })
}

async function sendSequential(items: BatchItem[], opts: SendActionsOptions): Promise<SendActionsResult> {
  const hashes: Hex[] = []
  const logs: Log[] = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    opts.onStep?.({ index, total: items.length, batched: false })
    let quote = item.quote
    if (!quote) {
      try {
        quote = await quoteAction(item)
      } catch (error) {
        playSound('error')
        throw wrap(error, item.functionName)
      }
    }
    const last = index === items.length - 1
    const result = await sendAction({
      ...item,
      quote,
      successSound: last ? (opts.successSound ?? item.successSound) : 'success-light',
    })
    hashes.push(result.hash)
    logs.push(...result.receipt.logs)
  }
  return { batched: false, hashes, logs }
}

async function sendBatch(items: BatchItem[], opts: SendActionsOptions): Promise<SendActionsResult> {
  const wallet = getWalletSnapshot().client
  if (!publicClient || !wallet) throw new Error('DEMO_MODE')
  const client = publicClient
  const account = items[0].account
  opts.onStep?.({ index: 0, total: items.length, batched: true })
  const { id } = await wallet.sendCalls({
    account,
    chain: appChain,
    forceAtomic: true,
    calls: items.map((item) => ({
      to: item.address,
      data: encodeFunctionData({
        abi: item.abi as Abi,
        functionName: item.functionName as ContractFunctionName<Abi>,
        args: (item.args ?? []) as ContractFunctionArgs<Abi>,
      }),
      value: item.value,
    })),
  })
  playSound('confirm')
  const sentAt = typeof performance === 'undefined' ? Date.now() : performance.now()
  const status = await wallet.waitForCallsStatus({ id, pollingInterval: 500, timeout: 120_000 })
  const receipts = status.receipts ?? []
  const hashes = [...new Set(receipts.map((receipt) => receipt.transactionHash))]
  for (const hash of hashes) {
    const receipt = receipts.find((item) => item.transactionHash === hash)!
    const tx = await client.getTransaction({ hash }).catch(() => undefined)
    recordTxTrace({
      hash,
      action: opts.action,
      signer: 'wallet',
      regions: [],
      gasLimit: tx?.gas ?? receipt.gasUsed,
      maxFeePerGas: tx?.maxFeePerGas ?? tx?.gasPrice ?? 0n,
      t: { sent: sentAt },
    })
    markTraceReceipt(hash, {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: tx?.gasPrice ?? tx?.maxFeePerGas ?? 0n,
    })
  }
  await refreshWalletBalance()
  if (status.status !== 'success') {
    throw new Error('the batch reverted onchain, so none of its steps happened. it still cost gas.')
  }
  bumpRefresh()
  playSound(opts.successSound ?? items[items.length - 1].successSound ?? 'success-light')
  return { batched: true, hashes, logs: receipts.flatMap((receipt) => receipt.logs as Log[]) }
}

/**
 * Send a multi-step task with as few wallet prompts as the wallet allows. Burner (Live mode) calls never
 * batch: they don't prompt anyway.
 */
export async function sendActions(items: BatchItem[], opts: SendActionsOptions): Promise<SendActionsResult> {
  if (!items.length) return { batched: false, hashes: [], logs: [] }
  const signer = items[0].signer ?? 'wallet'
  const batch = items.length > 1 && signer === 'wallet' && (await walletCanBatch(items[0].account))
  if (!batch) return sendSequential(items, opts)
  try {
    return await sendBatch(items, opts)
  } catch (error) {
    if (batchUnsupportedError(error)) {
      // The wallet advertised batches but refused this one: remember that and do it step by step.
      forgetBatchSupport(items[0].account)
      return sendSequential(items, opts)
    }
    const wrapped = wrap(error, items[0].functionName)
    playSound(wrapped.friendly.rejected ? 'cancel' : 'error')
    throw wrapped
  }
}

/** "1 wallet prompt" / "2 wallet prompts": what the person should expect for `count` calls. */
export function promptCountLabel(count: number, batched: boolean) {
  const prompts = batched ? Math.min(1, count) : count
  return `${prompts} wallet prompt${prompts === 1 ? '' : 's'}`
}
