import { formatEther, type Address, type Hex } from 'viem'
import { getBlockSnapshot } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { friendlyError } from '../chain/errors'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, switchToMonad, walletOnCorrectChain } from '../chain/wallet'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { encodeChangedRuns } from '../lib/patch'
import { getCanvasSnapshot } from '../paint/canvasStore'
import { confirmHigherCost } from '../os/confirm'
import { burnerStatus, createBurner, loadBurner, setCachedBurnerBalance } from './burner'
import { resetBurnerNonce } from './nonce'
import {
  burnerFundTooLarge,
  buildStartSessionTypedData,
  confirmLiveSessionStarted,
  fundingSuggestion,
  MAX_BURNER_FUND,
  refreshLiveStatus,
  type StartSessionMessage,
} from './liveStore'

/** Quick start uses the longest session the core allows and the default allowance. */
export const QUICK_SESSION_BLOCKS = 24_000n
export const QUICK_ALLOWANCE = 5_000n
/** Used only if a sample paint can't be simulated (e.g. the wallet's hourly budget is spent right now). */
export const FALLBACK_PAINT_GAS = 400_000n
/** Reused burners skip a top-up once they can safely start a session and cover a couple of typical paints. */
export const REUSE_MIN_PAINTS = 2n
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

/**
 * What to send the burner. A fresh key is funded toward the normal 20-paint target, but that target is
 * capped by MAX_BURNER_FUND. Reused burners avoid another wallet prompt once they already have enough
 * max-fee headroom for startSession plus a couple of typical paints.
 */
export function quickFunding(balance: bigint, paintGas: bigint, startGas: bigint, maxFeePerGas: bigint) {
  const reuseFloorRaw = (REUSE_MIN_PAINTS * paintGas + startGas) * maxFeePerGas
  const reuseFloor = reuseFloorRaw > MAX_BURNER_FUND ? MAX_BURNER_FUND : reuseFloorRaw
  if (balance >= reuseFloor) return 0n

  const target = fundingSuggestion(paintGas, startGas, maxFeePerGas)
  // fundingSuggestion already rounds the desired total and enforces the browser-key cap. Top up to that
  // total exactly; rounding the delta again could accidentally push currentBalance + value over the cap.
  return target > balance ? target - balance : 0n
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

  const existingBurner = loadBurner(owner)
  const burner = existingBurner ?? createBurner(owner)
  // Hide the burner's first pending-nonce RPC behind the wallet-sign/funding steps.
  // That keeps the first no-popup stroke from paying a cold nonce round trip.
  const nonceWarm = resetBurnerNonce(burner.address).catch(() => undefined)
  if (loadBurner(owner)?.address.toLowerCase() !== burner.address.toLowerCase()) {
    throw new Error('this browser blocked burner storage. allow site data for r3tardOS and try again.')
  }

  // Start every independent preflight immediately. A brand-new burner cannot already have a
  // session or balance, so skip two unnecessary RPCs on the common first-use path.
  const statusPromise = existingBurner ? burnerStatus(owner) : Promise.resolve(undefined)
  const paintGasPromise = samplePaintGas(owner)
  const noncePromise = client.readContract({
    address: paint,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'sessionNonces',
    args: [owner],
  }) as Promise<bigint>

  const status = await statusPromise
  if (status?.session.active && status.session.owner.toLowerCase() === owner.toLowerCase()) {
    await refreshLiveStatus(owner)
    report({ phase: 'done', prompts: 0 })
    return
  }
  const balanceBefore = status?.balance ?? 0n

  // Prompt 1: the session signature. Use the websocket-backed block clock when available instead
  // of spending another HTTP round trip just to choose an expiry 24,000 blocks in the future.
  report({ phase: 'sign' })
  const nonce = await noncePromise
  const observedHead = getBlockSnapshot().block
  const head = observedHead > 0n ? observedHead : await client.getBlockNumber({ cacheTime: 0 })
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
  let paintGas: bigint
  try {
    ;[startQuote, paintGas] = await Promise.all([quoteAction(startBase), paintGasPromise])
  } catch (error) {
    fail(error)
  }

  // The browser key must be able to register the session and still afford at least one representative
  // paint at the quoted max fee without breaking the 1 MON safety ceiling. A 20-paint convenience target
  // may be much larger than that during fee spikes, so it is capped rather than treated as an error.
  const minimumUsableBalance = (paintGas + startQuote.gasLimit) * startQuote.maxFeePerGas
  if (minimumUsableBalance > MAX_BURNER_FUND) {
    throw new Error(
      `current gas is too expensive to start Live Mode safely within the ${formatEther(MAX_BURNER_FUND)} MON burner cap. nothing was sent; try again when gas settles.`,
    )
  }

  // Prompt 2: gas money for the burner, unless it already has enough left from an earlier session.
  const value = quickFunding(balanceBefore, paintGas, startQuote.gasLimit, startQuote.maxFeePerGas)
  if (value > 0n && burnerFundTooLarge(value, balanceBefore)) {
    throw new Error(
      `the burner top-up would exceed the ${formatEther(MAX_BURNER_FUND)} MON browser-key cap. nothing was sent.`,
    )
  }
  let sendStartQuote = startQuote
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
    const fundingResult = await sendAction({ ...transfer, quote: fundQuote, confirmHigherCost })
    // The transfer receipt proves the burner received this exact value. Seed the cache immediately instead
    // of reading through another RPC endpoint, which can briefly lag the receipt and report the old balance.
    setCachedBurnerBalance(owner, balanceBefore + value)
    // The startSession call was already simulated before the wallet funding prompt. Treat the just-confirmed
    // funding block as its freshness point so usableQuote does not immediately re-estimate against an RPC that
    // may still report the burner's pre-funding balance.
    sendStartQuote = { ...startQuote, quotedAtBlock: fundingResult.blockNumber }
  } else {
    report({ prompts: 1 })
  }

  // No prompt: the burner sends startSession itself. The pending nonce should already be warm.
  await nonceWarm
  report({ phase: 'start' })
  await sendAction({ ...startBase, quote: sendStartQuote, confirmHigherCost })
  // The successful receipt is canonical proof that the session exists. Do not turn that success into an
  // error just because a follow-up public RPC is a block behind. Drain any queued refreshes, then commit the
  // known session locally; later events/reads will reconcile it normally.
  await refreshLiveStatus(owner).catch(() => undefined)
  confirmLiveSessionStarted(owner, message)
  report({ phase: 'done' })
}
