/**
 * Ending a Live Mode session, shared by My Pass › Hardware Profiles and the disconnect guard: revoke the
 * burner (only while its session is active; that step is signed by the main wallet), sweep its leftover MON
 * back to the main wallet (signed by the burner itself), then forget the burner key in this browser.
 *
 * The key is removed only after the sweep went through. If anything fails the error is thrown and the key
 * stays, so the person can try again from this browser.
 */
import type { Address } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import { confirmHigherCost } from '../os/confirm'
import { deleteBurner } from './burner'
import { refreshLiveStatus, sweepAmount } from './liveStore'

export interface EndSessionOptions {
  /** The main wallet: it signs the revoke and receives the leftover MON. */
  account: Address
  /** The burner held by this browser. */
  burner: Address
  /** Whether its session is still active (an expired or revoked one needs no revoke). */
  active: boolean
  onProgress?: (text: string) => void
}

export interface SweepOptions {
  /** Receives the MON. */
  account: Address
  /** The burner held by this browser; it signs its own transfer, so the main wallet never prompts. */
  burner: Address
  /** Asked when gas went up since the quote; answering false skips the sweep (it can run again later). */
  confirmHigherCost: (oldQuote: ActionQuote, nextQuote: ActionQuote) => Promise<boolean>
}

/**
 * Sends everything in the burner back to the main wallet except what the transfer itself may cost.
 * Returns the amount sent (0 when the balance doesn't even cover the gas).
 */
export async function sweepBurner({ account, burner, confirmHigherCost }: SweepOptions) {
  if (!publicClient) throw new Error('DEMO_MODE')
  const balance = await publicClient.getBalance({ address: burner })
  if (balance === 0n) return 0n
  const quoteSweep = (value: bigint) =>
    quoteAction({
      type: 'transfer',
      kind: 'estimate',
      to: account,
      functionName: 'transfer',
      account,
      signer: 'burner',
      value,
      action: 'sweep burner',
    })

  // Probe with a non-zero transfer so executable/EIP-7702 recipients are priced as an
  // actual value transfer. Then quote the candidate sweep itself before signing. Never
  // assume a recipient is a legacy 21k EOA.
  const probeQuote = await quoteSweep(1n)
  let value = sweepAmount(balance, probeQuote.gasLimit, probeQuote.maxFeePerGas)
  if (value === 0n) return 0n
  let sweepQuote = await quoteSweep(value)
  let safeValue = sweepAmount(balance, sweepQuote.gasLimit, sweepQuote.maxFeePerGas)

  // If the recipient's gas requirement changes with msg.value, shrink to the newly safe
  // amount and quote that value once more. We never increase the candidate after quoting.
  if (safeValue < value && safeValue > 0n) {
    value = safeValue
    sweepQuote = await quoteSweep(value)
    safeValue = sweepAmount(balance, sweepQuote.gasLimit, sweepQuote.maxFeePerGas)
  }
  value = safeValue < value ? safeValue : value
  if (value === 0n) return 0n

  await sendAction({
    type: 'transfer',
    kind: 'estimate',
    to: account,
    functionName: 'transfer',
    account,
    signer: 'burner',
    value,
    quote: sweepQuote,
    confirmHigherCost,
    action: 'sweep burner',
  })
  return value
}

export async function endLiveSession({ account, burner, active, onProgress }: EndSessionOptions) {
  if (!config.paintAddress || !publicClient) throw new Error('DEMO_MODE')
  // An expired or already revoked session needs no revoke: just sweep the MON and forget the key.
  if (active) {
    onProgress?.('1 of 3 · revoking burner…')
    const revokeQuote = await quoteAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'revokeSession',
      args: [burner],
      account,
      action: 'end live session',
    })
    await sendAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'revokeSession',
      args: [burner],
      account,
      quote: revokeQuote,
      confirmHigherCost,
      action: 'end live session',
    })
  }

  onProgress?.('2 of 3 · sweeping leftover MON…')
  await sweepBurner({ account, burner, confirmHigherCost })

  onProgress?.('3 of 3 · removing local key…')
  deleteBurner(account)
  await refreshLiveStatus(account)
}
