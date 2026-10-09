import {
  encodeFunctionData,
  keccak256,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type Log,
} from 'viem'
import { appChain } from './clients'
import {
  actionRpcHedgedRequest,
  actionRpcRequest,
  broadcastActionRawTransaction,
  probeActionRpcs,
  retryTransient,
  waitForActionReceipt,
} from './actionRpc'
import { getBlockSnapshot } from './blocks'
import { friendlyError } from './errors'
import { formatMaxCost, gasLimitFor, maxCostWei, type GasKind } from './gas'
import { getWalletSnapshot, refreshWalletBalance } from './wallet'
import {
  burnerAccount,
  cachedBurnerBalance,
  debitCachedBurnerBalance,
  loadBurner,
  notifyBurnerChanged,
} from '../live/burner'
import { sendWithBurnerNonce } from '../live/nonce'
import { playSound } from '../os/sound'
import { markTraceReceipt, recordTxTrace, type TxSigner } from './txTrace'
import { bumpRefresh } from './refreshTick'
import { recordPerf, startPerf } from './perf'

export interface ActionQuote {
  gasLimit: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  maxCost: string
  quotedAtBlock: bigint
}

export interface ActionResult {
  hash: Hex
  blockNumber: bigint
  /** ms from the RPC accepting the transaction to this app holding its receipt */
  receiptMs: number
  gasLimit: bigint
  maxFeePerGas: bigint
  maxCost: string
  receipt: {
    status: 'success' | 'reverted'
    logs: readonly Log[]
    gasUsed: bigint
    effectiveGasPrice: bigint
  }
}

interface ActionBase {
  kind: GasKind
  account: Address
  value?: bigint
  successSound?: 'success-light' | 'success-heavy'
  quote?: ActionQuote
  confirmHigherCost?: (oldQuote: ActionQuote, nextQuote: ActionQuote) => Promise<boolean>
  signer?: TxSigner
  action?: string
  regions?: readonly number[]
  onState?: (state: 'signing' | 'sent' | 'confirmed') => void
  /** Internal recovery attempts can suppress their own failure sound so one transient retry is not audible twice. */
  suppressFailureSound?: boolean
}

export interface ContractActionOptions extends ActionBase {
  type?: 'contract'
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  pixels?: number
}

export interface TransferActionOptions extends ActionBase {
  type: 'transfer'
  to: Address
  functionName: 'transfer'
}

export type ActionOptions = ContractActionOptions | TransferActionOptions

type FeeCache = {
  block: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}
let feeCache: FeeCache | undefined
let feePromise: Promise<FeeCache> | undefined

function isTransfer(opts: ActionOptions): opts is TransferActionOptions {
  return opts.type === 'transfer'
}

async function currentBlock() {
  const head = getBlockSnapshot().block
  if (head > 0n) return head
  return actionRpcRequest((client) => client.getBlockNumber({ cacheTime: 0 }))
}

async function feeQuote(block: bigint) {
  if (feeCache && block >= feeCache.block && block - feeCache.block <= 20n) return feeCache
  // Several programs can ask for a quote at the same time. Share one fee RPC instead of
  // stampeding the public endpoint with identical estimateFeesPerGas calls.
  if (feePromise) return feePromise

  feePromise = (async () => {
    const rawFees = await actionRpcHedgedRequest((client) => client.estimateFeesPerGas())
    const fees = rawFees as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }
    feeCache = {
      block,
      maxFeePerGas: fees.maxFeePerGas ?? fees.gasPrice ?? 0n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
    }
    return feeCache
  })().finally(() => {
    feePromise = undefined
  })

  return feePromise
}

/** Warm the shared fee cap during the boot/splash window so the first visible quote only waits on gas. */
export async function prewarmActionFees(probe = true) {
  if (probe) await probeActionRpcs().catch(() => undefined)
  const block = await currentBlock()
  await feeQuote(block)
}

/**
 * Keep an already-validated gas limit, but refresh the fee caps and freshness block.
 * Useful after a human wallet prompt: the calldata/gas estimate is still valid, while an
 * EIP-1559 fee cap quoted several seconds earlier may no longer be accepted by a fast chain.
 */
export async function refreshActionQuoteFees(quote: ActionQuote): Promise<ActionQuote> {
  const [block, rawFees] = await Promise.all([
    currentBlock(),
    actionRpcRequest((client) => client.estimateFeesPerGas()),
  ])
  const fees = rawFees as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }
  const next = {
    ...quote,
    maxFeePerGas: fees.maxFeePerGas ?? fees.gasPrice ?? quote.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? quote.maxPriorityFeePerGas,
    quotedAtBlock: block,
  }
  next.maxCost = formatMaxCost(next.gasLimit, next.maxFeePerGas)
  feeCache = {
    block,
    maxFeePerGas: next.maxFeePerGas,
    maxPriorityFeePerGas: next.maxPriorityFeePerGas,
  }
  return next
}

function senderFor(opts: ActionOptions) {
  if ((opts.signer ?? 'wallet') === 'wallet') return opts.account
  const burner = loadBurner(opts.account)
  if (!burner) throw new Error('NO_BURNER')
  return burner.address
}

function contractBase(opts: ContractActionOptions, sender: Address) {
  return {
    address: opts.address,
    abi: opts.abi,
    functionName: opts.functionName as ContractFunctionName<Abi>,
    args: (opts.args ?? []) as ContractFunctionArgs<Abi>,
    account: sender,
    value: opts.value,
  }
}

export async function quoteAction(opts: ActionOptions): Promise<ActionQuote> {
  const stopQuote = startPerf('quote', actionName(opts))
  const sender = senderFor(opts)

  // Start every independent quote read immediately. The action client deliberately avoids
  // the background batch/queue, so wall time is roughly one RPC round-trip.
  const blockPromise = currentBlock()
  let gasLimitPromise: Promise<bigint>

  if (isTransfer(opts)) {
    // A native MON transfer is not necessarily a 21k EOA transfer anymore. EIP-7702 and
    // contract-wallet recipients can execute code on receipt, so estimate against the actual
    // sender / recipient / value and keep the normal safety margin.
    gasLimitPromise = retryTransient(() =>
      actionRpcHedgedRequest((client) =>
        client.estimateGas({
          account: sender,
          to: opts.to,
          value: opts.value ?? 0n,
        }),
      ),
    ).then((estimate) => (estimate === 21_000n ? estimate : gasLimitFor(opts.kind, estimate)))
  } else {
    const base = contractBase(opts, sender)
    // estimateContractGas already executes the transaction and surfaces reverts. Running a
    // simulateContract first performed the same expensive work twice on every quote.
    // A busy public RPC (a paint party on one wifi) can fail a quote transiently; retry those, never reverts.
    gasLimitPromise = retryTransient(() =>
      actionRpcHedgedRequest((client) => client.estimateContractGas(base)),
    ).then((estimate) => gasLimitFor(opts.kind, estimate, opts.pixels))
  }

  const feePromiseForQuote = blockPromise.then((block) => feeQuote(block))
  const [gasLimit, block, fees] = await Promise.all([gasLimitPromise, blockPromise, feePromiseForQuote])

  const quote = {
    gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxCost: formatMaxCost(gasLimit, fees.maxFeePerGas),
    quotedAtBlock: block,
  }
  stopQuote()
  return quote
}

async function usableQuote(opts: ActionOptions) {
  if (!opts.quote) throw new Error('QUOTE_REQUIRED')
  const block = await currentBlock()
  if (block <= opts.quote.quotedAtBlock + 20n) return opts.quote
  const next = await quoteAction(opts)
  if (
    maxCostWei(next.gasLimit, next.maxFeePerGas) > maxCostWei(opts.quote.gasLimit, opts.quote.maxFeePerGas)
  ) {
    const accepted = await opts.confirmHigherCost?.(opts.quote, next)
    if (!accepted) throw Object.assign(new Error('gas quote changed'), { code: 4001 })
  }
  return next
}

function actionName(opts: ActionOptions) {
  return opts.action ?? (isTransfer(opts) ? 'send MON' : opts.functionName)
}

async function sendWithWallet(opts: ActionOptions, quote: ActionQuote, sender: Address) {
  const wallet = getWalletSnapshot().client
  if (!wallet) throw new Error('DEMO_MODE')

  // quoteAction already validated the action with gas estimation, and usableQuote refreshes
  // quotes older than 20 blocks. Do not execute the contract a second time
  // between the user's click and eth_sendTransaction: that extra RPC was directly delaying the
  // wallet popup. The wallet still gets the exact calldata and the exact gas/fee caps we showed.
  const data = isTransfer(opts)
    ? undefined
    : encodeFunctionData({
        abi: opts.abi,
        functionName: opts.functionName as ContractFunctionName<Abi>,
        args: (opts.args ?? []) as ContractFunctionArgs<Abi>,
      })
  const requestedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
  const hash = await wallet.sendTransaction({
    account: sender,
    chain: appChain,
    to: isTransfer(opts) ? opts.to : opts.address,
    data,
    value: opts.value ?? 0n,
    gas: quote.gasLimit,
    maxFeePerGas: quote.maxFeePerGas,
    maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
  })
  return { hash, requestedAt }
}

async function sendWithBurner(opts: ActionOptions, quote: ActionQuote, sender: Address) {
  const account = burnerAccount(opts.account)
  if (!account) throw new Error('NO_BURNER')
  // Live Mode keeps an up-to-date burner balance in the live store. Reuse it on the
  // hot path instead of inserting a getBalance RTT before every stroke. If this is the
  // first burner action in a cold tab we still do the exact check once.
  const cachedBalance = cachedBurnerBalance(opts.account)
  const balance =
    cachedBalance ?? (await actionRpcRequest((client) => client.getBalance({ address: sender })))
  if (!burnerCanAfford(balance, quote, opts.value)) throw new Error('BURNER_OUT_OF_MON')

  return sendWithBurnerNonce(sender, async (nonce) => {
    const data = isTransfer(opts)
      ? undefined
      : encodeFunctionData({
          abi: opts.abi,
          functionName: opts.functionName as ContractFunctionName<Abi>,
          args: (opts.args ?? []) as ContractFunctionArgs<Abi>,
        })
    const signStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
    // Sign directly with the Local Account. WalletClient.signTransaction may consult its transport
    // while asserting/preparing chain context, which turned the supposedly local "sign" stage into
    // 0.2-5 s RPC jitter in real Live Mode traces. Every required field is already known here, so this
    // is pure secp256k1 signing with no network dependency.
    const serialized = await account.signTransaction({
      chainId: appChain.id,
      to: isTransfer(opts) ? opts.to : opts.address,
      data,
      value: opts.value ?? 0n,
      gas: quote.gasLimit,
      maxFeePerGas: quote.maxFeePerGas,
      maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
      nonce,
      type: 'eip1559',
    })
    const signedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    recordPerf('burner-sign', actionName(opts), signedAt - signStarted)
    const expectedHash = keccak256(serialized)
    const broadcastStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
    const accepted = await broadcastActionRawTransaction(serialized, expectedHash)
    const broadcastAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    recordPerf('burner-broadcast', actionName(opts), broadcastAt - broadcastStarted)
    return { hash: accepted.hash, signedAt }
  })
}

export function burnerCanAfford(balance: bigint, quote: ActionQuote, value = 0n) {
  return balance >= quote.gasLimit * quote.maxFeePerGas + value
}

export async function sendAction(opts: ActionOptions): Promise<ActionResult> {
  try {
    const stopTotal = startPerf('tx-total', `${actionName(opts)} · ${opts.signer ?? 'wallet'}`)
    const quote = await usableQuote(opts)
    const signer = opts.signer ?? 'wallet'
    const sender = senderFor(opts)
    let hash: Hex
    let signedAt: number | undefined
    opts.onState?.('signing')
    const submitStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
    if (signer === 'burner') {
      const sent = await sendWithBurner(opts, quote, sender)
      hash = sent.hash
      signedAt = sent.signedAt
    } else {
      const sent = await sendWithWallet(opts, quote, sender)
      hash = sent.hash
      recordPerf('tx-prewallet', actionName(opts), sent.requestedAt - submitStarted)
      const walletReturnedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
      recordPerf('tx-wallet', actionName(opts), walletReturnedAt - sent.requestedAt)
    }
    opts.onState?.('sent')
    const sentAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    recordPerf('tx-submit', `${actionName(opts)} · ${signer}`, sentAt - submitStarted)
    recordTxTrace({
      hash,
      action: actionName(opts),
      signer,
      regions: [...(opts.regions ?? [])],
      gasLimit: quote.gasLimit,
      maxFeePerGas: quote.maxFeePerGas,
      t: { signed: signedAt, sent: sentAt },
    })
    playSound('confirm')
    const receipt = await waitForActionReceipt(hash)
    const receiptAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    recordPerf('tx-receipt', actionName(opts), receiptAt - sentAt)
    markTraceReceipt(hash, {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      status: receipt.status,
    })
    if (signer === 'wallet') {
      // The receipt is already final from the user's point of view. Do not hold the UI open
      // for a secondary balance read; refresh it in the background.
      void refreshWalletBalance()
    } else {
      const valueSpent = receipt.status === 'success' ? (opts.value ?? 0n) : 0n
      // Monad charges the transaction gas LIMIT, not receipt.gasUsed. Keep the local burner balance
      // conservative and chain-accurate so a long Live session does not drift into a surprise rejection.
      debitCachedBurnerBalance(
        opts.account,
        maxCostWei(quote.gasLimit, receipt.effectiveGasPrice) + valueSpent,
      )
      notifyBurnerChanged(opts.account)
    }
    if (receipt.status === 'reverted') {
      throw new Error(`the transaction reverted onchain and still cost up to ${quote.maxCost}`)
    }
    opts.onState?.('confirmed')
    bumpRefresh()
    playSound(opts.successSound ?? 'success-light')
    stopTotal()
    return {
      hash,
      blockNumber: receipt.blockNumber,
      receiptMs: receiptAt - sentAt,
      gasLimit: quote.gasLimit,
      maxFeePerGas: quote.maxFeePerGas,
      maxCost: quote.maxCost,
      receipt: {
        status: receipt.status,
        logs: receipt.logs,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
      },
    }
  } catch (error) {
    const friendly = friendlyError(error, isTransfer(opts) ? 'transfer' : opts.functionName)
    if (!opts.suppressFailureSound) playSound(friendly.rejected ? 'cancel' : 'error')
    throw Object.assign(new Error(friendly.message), { friendly })
  }
}

export function __resetFeeCacheForTests() {
  feeCache = undefined
  feePromise = undefined
}
