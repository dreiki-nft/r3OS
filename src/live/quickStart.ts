import { formatEther, type Address, type Hex } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { friendlyError } from '../chain/errors'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, switchToMonad, walletOnCorrectChain } from '../chain/wallet'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { encodeChangedRuns } from '../lib/patch'
import { getCanvasSnapshot } from '../paint/canvasStore'
import { confirmHigherCost } from '../os/confirm'
import { burnerStatus, createBurner, loadBurner } from './burner'
import {
  burnerFundTooLarge,
  buildStartSessionTypedData,
  fundingSuggestion,
  FUNDING_TARGET_PAINTS,
  refreshLiveStatus,
  type StartSessionMessage,
} from './liveStore'

/** Quick start uses the longest session the core allows and the default allowance. */
export const QUICK_SESSION_BLOCKS = 24_000n
export const QUICK_ALLOWANCE = 5_000n
/** Used only if a sample paint can't be simulated (e.g. the wallet's hourly budget is spent right now). */
export const FALLBACK_PAINT_GAS = 400_000n
/** Skip the funding prompt when the burner already holds gas for this many paints plus startSession. */
export const REUSE_MIN_PAINTS = FUNDING_TARGET_PAINTS
const SIGNATURE_TTL_SECONDS = 15 * 60

export type QuickPhase = 'prepare' | 'sign' | 'fund' | 'start' | 'done'

export interface QuickProgress {
  phase: QuickPhase
  /** Wallet prompts this run needs: 2 normally, 1 when the burner already has enough MON. */
  prompts: number
  /** MON sent to the burner (formatted), once known. */
  funding?: string
}

/** A 64-pixel sample stroke, only for pricing a typical live paint. Never sent. */
export function samplePaint64() {
  const canvas = getCanvasSnapshot()
  const working = canvas.background.slice()
  let changed = 0
  for (let index = 0; index < working.length && changed < 64; index += 257) {
    if (canvas.outline[index]) continue
    working[index] = canvas.background[index] === 1 ? 2 : 1
    changed++
  }
  for (let index = 0; index < working.length && changed < 64; index++) {
    if (canvas.outline[index] || working[index] !== canvas.background[index]) continue
    working[index] = canvas.background[index] === 1 ? 2 : 1
    changed++
  }
  return encodeChangedRuns(canvas.background, working)
}

/** What to send the burner: about 20 paints of gas, or nothing when it already has enough. */
export function quickFunding(balance: bigint, paintGas: bigint, startGas: bigint, maxFeePerGas: bigint) {
  const floor = (REUSE_MIN_PAINTS * paintGas + startGas) * maxFeePerGas
  if (balance >= floor) return 0n
  const target = fundingSuggestion(paintGas, startGas, maxFeePerGas)
  const missing = target > balance ? target - balance : 0n
  const tenth = 100_000_000_000_000_000n
  return ((missing + tenth - 1n) / tenth) * tenth
}

async function samplePaintGas(owner: Address) {
  if (!config.paintAddress) return FALLBACK_PAINT_GAS
  const sample = samplePaint64()
  if (sample.pixelWrites !== 64) return FALLBACK_PAINT_GAS
  try {
    const quote = await quoteAction({
      kind: 'corePaint',
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'paint',
      args: [sample.hex, []],
      account: owner,
      pixels: 64,
      signer: 'wallet',
      action: 'sample 64 px paint',
    })
    return quote.gasLimit
  } catch {
    return FALLBACK_PAINT_GAS
  }
}

function fail(error: unknown, action = 'startSession'): never {
  const friendly = friendlyError(error, action)
  throw Object.assign(new Error(friendly.message), { friendly })
}

/**
 * Live mode in one click: make (or reuse) the burner, sign the session (prompt 1), send the burner gas money
 * (prompt 2, skipped when it already has enough), then the burner registers itself. Same contract calls and
 * limits as the wizard, with the defaults filled in.
 */
export async function startLiveQuick(owner: Address, onProgress: (progress: QuickProgress) => void) {
  const wallet = getWalletSnapshot().client
  if (!publicClient || !config.paintAddress || !wallet) throw new Error('connect a wallet first')
  const client = publicClient
  const paint = config.paintAddress
  let progress: QuickProgress = { phase: 'prepare', prompts: 2 }
  const report = (patch: Partial<QuickProgress>) => {
    progress = { ...progress, ...patch }
    onProgress(progress)
  }
  report({})

  if (!walletOnCorrectChain()) await switchToMonad()

  const burner = createBurner(owner)
  if (loadBurner(owner)?.address.toLowerCase() !== burner.address.toLowerCase()) {
    throw new Error('this browser blocked burner storage. allow site data for r3tardOS and try again.')
  }

  const status = await burnerStatus(owner)
  if (status?.session.active && status.session.owner.toLowerCase() === owner.toLowerCase()) {
    await refreshLiveStatus(owner)
    report({ phase: 'done', prompts: 0 })
    return
  }
  const balanceBefore = status?.balance ?? (await client.getBalance({ address: burner.address }))
  const paintGas = await samplePaintGas(owner)

  // Prompt 1: the session signature.
  report({ phase: 'sign' })
  const [nonce, head] = await Promise.all([
    client.readContract({
      address: paint,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'sessionNonces',
      args: [owner],
    }),
    client.getBlockNumber({ cacheTime: 0 }),
  ])
  const message: StartSessionMessage = {
    owner,
    sessionKey: burner.address,
    expiryBlock: head + QUICK_SESSION_BLOCKS,
    maxUnits: QUICK_ALLOWANCE,
    nonce: nonce as bigint,
    deadline: BigInt(Math.floor(Date.now() / 1_000) + SIGNATURE_TTL_SECONDS),
  }
  let signature: Hex
  try {
    signature = (await wallet.signTypedData({
      account: owner,
      ...buildStartSessionTypedData(message),
    })) as Hex
  } catch (error) {
    fail(error)
  }

  const startArgs = [
    owner,
    burner.address,
    message.expiryBlock,
    message.maxUnits,
    message.nonce,
    message.deadline,
    signature,
  ] as const
  const startBase = {
    kind: 'estimate' as const,
    address: paint,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'startSession',
    args: startArgs,
    account: owner,
    signer: 'burner' as const,
    action: 'start live session',
  }
  let startQuote: ActionQuote
  try {
    startQuote = await quoteAction(startBase)
  } catch (error) {
    fail(error)
  }

  // Prompt 2: gas money for the burner, unless it already has enough left from an earlier session.
  const value = quickFunding(balanceBefore, paintGas, startQuote.gasLimit, startQuote.maxFeePerGas)
  if (burnerFundTooLarge(value, balanceBefore)) {
    throw new Error(
      `the gas quote asks for ${formatEther(value)} MON for the burner, which looks wrong. nothing was sent; try again later.`,
    )
  }
  if (value > 0n) {
    report({ phase: 'fund', funding: formatEther(value) })
    const transfer = {
      type: 'transfer' as const,
      kind: 'estimate' as const,
      to: burner.address,
      functionName: 'transfer' as const,
      account: owner,
      value,
      action: 'fund burner',
    }
    const fundQuote = await quoteAction(transfer).catch((error: unknown) => fail(error, 'transfer'))
    await sendAction({ ...transfer, quote: fundQuote, confirmHigherCost })
  } else {
    report({ prompts: 1 })
  }

  // No prompt: the burner sends startSession itself.
  report({ phase: 'start' })
  await sendAction({ ...startBase, quote: startQuote, confirmHigherCost })
  await refreshLiveStatus(owner)
  report({ phase: 'done' })
}
