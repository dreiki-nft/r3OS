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
import { publicClient, appChain } from './clients'
import { getBlockSnapshot } from './blocks'
import { friendlyError } from './errors'
import { formatMaxCost, gasLimitFor, maxCostWei, type GasKind } from './gas'
import { getWalletSnapshot, refreshWalletBalance } from './wallet'
import { notifyBurnerChanged, burnerAccount, burnerWallet, loadBurner } from '../live/burner'
import { sendWithBurnerNonce } from '../live/nonce'
import { playSound } from '../os/sound'
import { markTraceReceipt, recordTxTrace, type TxSigner } from './txTrace'

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

function isTransfer(opts: ActionOptions): opts is TransferActionOptions {
  return opts.type === 'transfer'
}

async function currentBlock() {
  const head = getBlockSnapshot().block
  if (head > 0n || !publicClient) return head
  return publicClient.getBlockNumber({ cacheTime: 0 })
}

async function feeQuote(block: bigint) {
  if (feeCache && block >= feeCache.block && block - feeCache.block <= 10n) return feeCache
  if (!publicClient) throw new Error('DEMO_MODE')
  const rawFees = await publicClient.estimateFeesPerGas()
  const fees = rawFees as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }
  feeCache = {
    block,
    maxFeePerGas: fees.maxFeePerGas ?? fees.gasPrice ?? 0n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
  }
  return feeCache
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
  if (!publicClient) throw new Error('DEMO_MODE')
  const sender = senderFor(opts)
  let gasLimit: bigint
  if (isTransfer(opts)) {
    gasLimit = 21_000n
  } else {
    const base = contractBase(opts, sender)
    await publicClient.simulateContract(base)
    if (opts.kind === 'flipbookPaint' || opts.kind === 'forkPaint' || opts.kind === 'sleepwalkerStep') {
      gasLimit = gasLimitFor(opts.kind, 0n, opts.pixels)
    } else {
      const estimate = await publicClient.estimateContractGas(base)
      gasLimit = gasLimitFor(opts.kind, estimate, opts.pixels)
    }
  }
  const block = await currentBlock()
  const fees = await feeQuote(block)
  return {
    gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxCost: formatMaxCost(gasLimit, fees.maxFeePerGas),
    quotedAtBlock: block,
  }
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
  if (!publicClient) throw new Error('DEMO_MODE')
  const client = publicClient
  const wallet = getWalletSnapshot().client
  if (!wallet) throw new Error('DEMO_MODE')
  if (isTransfer(opts)) {
    return wallet.sendTransaction({
      account: sender,
      chain: appChain,
      to: opts.to,
      value: opts.value ?? 0n,
      gas: quote.gasLimit,
      maxFeePerGas: quote.maxFeePerGas,
      maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
    })
  }
  const { request } = await client.simulateContract(contractBase(opts, sender))
  return wallet.writeContract({
    ...request,
    gas: quote.gasLimit,
    maxFeePerGas: quote.maxFeePerGas,
    maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
  } as Parameters<typeof wallet.writeContract>[0])
}

async function sendWithBurner(opts: ActionOptions, quote: ActionQuote, sender: Address) {
  if (!publicClient) throw new Error('DEMO_MODE')
  const client = publicClient
  const wallet = burnerWallet(opts.account)
  const account = burnerAccount(opts.account)
  if (!wallet || !account) throw new Error('NO_BURNER')
  const balance = await client.getBalance({ address: sender })
  if (!burnerCanAfford(balance, quote, opts.value)) throw new Error('BURNER_OUT_OF_MON')

  return sendWithBurnerNonce(sender, async (nonce) => {
    const data = isTransfer(opts)
      ? undefined
      : encodeFunctionData({
          abi: opts.abi,
          functionName: opts.functionName as ContractFunctionName<Abi>,
          args: (opts.args ?? []) as ContractFunctionArgs<Abi>,
        })
    const signedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    const serialized = await wallet.signTransaction({
      account,
      chain: appChain,
      to: isTransfer(opts) ? opts.to : opts.address,
      data,
      value: opts.value,
      gas: quote.gasLimit,
      maxFeePerGas: quote.maxFeePerGas,
      maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
      nonce,
      type: 'eip1559',
    })
    const expectedHash = keccak256(serialized)
    const hash = await client.sendRawTransaction({ serializedTransaction: serialized })
    if (hash !== expectedHash) throw new Error('RAW_TX_HASH_MISMATCH')
    return { hash, signedAt }
  })
}

export function burnerCanAfford(balance: bigint, quote: ActionQuote, value = 0n) {
  return balance >= quote.gasLimit * quote.maxFeePerGas + value
}

export async function sendAction(opts: ActionOptions): Promise<ActionResult> {
  if (!publicClient) throw new Error('DEMO_MODE')
  const client = publicClient
  try {
    const quote = await usableQuote(opts)
    const signer = opts.signer ?? 'wallet'
    const sender = senderFor(opts)
    let hash: Hex
    let signedAt: number | undefined
    opts.onState?.('signing')
    if (signer === 'burner') {
      const sent = await sendWithBurner(opts, quote, sender)
      hash = sent.hash
      signedAt = sent.signedAt
    } else {
      hash = await sendWithWallet(opts, quote, sender)
    }
    opts.onState?.('sent')
    const sentAt = typeof performance === 'undefined' ? Date.now() : performance.now()
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
    const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 250 })
    markTraceReceipt(hash, {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
    })
    if (signer === 'wallet') await refreshWalletBalance()
    else notifyBurnerChanged(opts.account)
    if (receipt.status === 'reverted') {
      throw new Error(`the transaction reverted onchain and still cost up to ${quote.maxCost}`)
    }
    opts.onState?.('confirmed')
    playSound(opts.successSound ?? 'success-light')
    return {
      hash,
      blockNumber: receipt.blockNumber,
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
    playSound(friendly.rejected ? 'cancel' : 'error')
    throw Object.assign(new Error(friendly.message), { friendly })
  }
}

export function __resetFeeCacheForTests() {
  feeCache = undefined
}
