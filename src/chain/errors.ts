import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Abi, type Hex } from 'viem'
import {
  DF1_RENDERER_ABI,
  DIFF_RENDERER_ABI,
  R3OS_CD_BURNER_ABI,
  R3OS_FINALE_AUCTION_ABI,
  R3OS_PAINTER_PASS_ABI,
  R3OS_PAINT_ABI,
  R3OS_QUESTS_ABI,
  SEASON_TIMELAPSE_RENDERER_ABI,
} from '../lib/generated/abi'

const ALL = [
  R3OS_PAINT_ABI,
  R3OS_PAINTER_PASS_ABI,
  R3OS_CD_BURNER_ABI,
  R3OS_FINALE_AUCTION_ABI,
  R3OS_QUESTS_ABI,
  DIFF_RENDERER_ABI,
  SEASON_TIMELAPSE_RENDERER_ABI,
  DF1_RENDERER_ABI,
].flat() as Abi

export type FriendlyError = {
  name: string
  message: string
  details?: string
  refreshHolders?: boolean
  rejected?: boolean
}

// Wallets say "no" in different ways: EIP-1193 code 4001, viem's UserRejectedRequestError, ethers' ACTION_REJECTED,
// or only a message ("User denied message signature"). viem can also wrap the wallet's error several causes deep.
const REJECTED_TEXT = /user (rejected|denied|cancell?ed|disapproved)|rejected by (the )?user|request (was )?rejected/i

export function isUserRejected(error: unknown) {
  let current = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && typeof current === 'object' && depth < 8; depth++) {
    if (current.code === 4001 || current.code === 'ACTION_REJECTED') return true
    if (current.name === 'UserRejectedRequestError') return true
    if (typeof current.message === 'string' && REJECTED_TEXT.test(current.message)) return true
    current = current.cause as typeof current
  }
  return false
}

function copy(name: string, args: readonly unknown[] = [], action?: string): FriendlyError {
  switch (name) {
    case 'InsufficientBudget':
      return {
        name,
        // The budget is in units, not pixels: repainting an already-painted (dry) pixel costs 2. Saying
        // "pixels" here made a 406 px stroke that cost 595 look like a miscount.
        message: `not enough budget: this stroke costs ${args[0]}, you have ${args[1]} left. painting over already-painted pixels costs 2 each. budget refills every hour.`,
      }
    case 'TileTooHot':
      return { name, message: `tile ${args[0]} is too hot from recent paint. let it cool or paint elsewhere.` }
    case 'RegionBusy':
      return { name, message: `region ${args[0]} hit its per-block paint limit. try again next block.` }
    case 'NoChange':
      return {
        name,
        message:
          action === 'setFace'
            ? 'the face is already that colour.'
            : 'nothing to paint: every pixel already matches.',
      }
    case 'CanvasUnchanged':
    case 'EmptyPatch':
      return { name, message: 'nothing to paint: every pixel already matches.' }
    case 'FramePaintRequired':
      return {
        name,
        message: 'paint something first. a frame needs at least one paint since your last frame.',
      }
    case 'CooldownActive':
      return { name, message: `cooldown: try again after block ${args[0]}.` }
    case 'NotOpenYet':
      return { name, message: "the canvas isn't open yet." }
    case 'SessionKeyPaintOnly':
      return { name, message: 'live mode can only paint. use your main wallet for this.' }
    case 'InvalidSessionKey':
      return { name, message: 'that burner key is invalid for this session.' }
    case 'SessionKeyHasOwnerHistory':
      return { name, message: 'that burner has painted as itself before. make a fresh burner.' }
    case 'SessionKeyHasPainterPass':
      return { name, message: 'that burner already has a Painter Pass. make a fresh burner.' }
    case 'SessionKeyInUse':
      return { name, message: 'that burner already belongs to another active session.' }
    case 'SessionDeadlineExpired':
      return { name, message: 'the signature expired. sign again.' }
    case 'SessionExpired':
      return { name, message: 'that session expiry block has already passed.' }
    case 'SessionIsRevoked':
      return { name, message: 'that live session was revoked.' }
    case 'SessionDurationTooLong':
      return { name, message: 'that session is longer than the contract allows.' }
    case 'InvalidSessionNonce':
      return { name, message: `the session nonce changed. expected ${args[0]}, got ${args[1]}. sign again.` }
    case 'InvalidSessionSignature':
      return { name, message: 'the session signature is invalid. sign again from the main wallet.' }
    case 'SessionUnitsExceeded':
      return { name, message: 'session allowance used up. start a new one.' }
    case 'NotR3tardOwner':
    case 'DuplicateR3tardId':
      return {
        name,
        message: `r3tard #${args[0]} isn't in this wallet any more. refreshing your holder list.`,
        refreshHolders: true,
      }
    case 'AlreadyClaimed':
      return { name, message: 'you already claimed a pass. one per address, forever.' }
    case 'NoPaintYet':
      return { name, message: 'paint at least one pixel first, then claim.' }
    case 'SessionKeyCannotClaim':
      return { name, message: "a live-mode key can't claim. switch to your main wallet." }
    case 'SessionKeyCannotBurnCD':
      return { name, message: "a live-mode key can't burn a CD. use your main wallet." }
    case 'InvalidTrackCount':
      return { name, message: 'a CD needs between 1 and 12 tracks.' }
    case 'DuplicateTrack':
      return { name, message: `track #${args[0]} is selected twice.` }
    case 'TokenZeroNotAllowed':
      return { name, message: 'the canvas token cannot be used as a CD track.' }
    case 'NotFrameOwner':
      return { name, message: `frame #${args[0]} is no longer in this wallet. refresh your tracks.` }
    case 'NotLabsOwner':
      return { name, message: `Labs token #${args[0]} is no longer in this wallet. refresh your tracks.` }
    case 'InvalidLabelLength':
      return { name, message: 'CD labels must be 1–24 characters.' }
    case 'InvalidLabelCharacter':
      return { name, message: `that CD label has an unsupported character at position ${Number(args[0] ?? 0) + 1}.` }
    case 'InvalidTrackKindsLength':
      return { name, message: 'the CD track list changed while quoting. rebuild the mix and try again.' }
    case 'InvalidTrackKind':
      return { name, message: 'that track type cannot be written to this CD.' }
    case 'NotBlockCameraToken':
      return { name, message: `Labs token #${args[0]} is not a Block Camera photo.` }
    case 'BlockCameraTrackReadFailed':
      return { name, message: `Block Camera photo #${args[0]} could not be read. refresh and try again.` }
    default:
      return {
        name,
        message: name,
        details: args.length
          ? JSON.stringify(args, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
          : undefined,
      }
  }
}

function decodeRaw(raw: Hex, action?: string) {
  try {
    const decoded = decodeErrorResult({ abi: ALL, data: raw })
    return copy(decoded.errorName, decoded.args ?? [], action)
  } catch {
    return { name: 'ContractRevert', message: 'contract reverted.', details: raw }
  }
}

export function friendlyError(error: unknown, action?: string): FriendlyError {
  const wrapped = error as { friendly?: FriendlyError }
  if (wrapped?.friendly) return wrapped.friendly

  // EIP-1193 -32002: the wallet already has a request waiting (a popup the user closed or never saw).
  const pending = error as { code?: number; cause?: { code?: number } } | undefined
  if ((pending?.code ?? pending?.cause?.code) === -32002) {
    return {
      name: 'WalletRequestPending',
      message: 'your wallet already has a request waiting. open the wallet extension, approve or reject it, then try again.',
    }
  }

  if (isUserRejected(error)) {
    return {
      name: 'UserRejected',
      message: 'you closed the wallet. nothing was sent.',
      rejected: true,
    }
  }

  if (error instanceof BaseError) {
    const revert = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      if (revert.data?.errorName) return copy(revert.data.errorName, revert.data.args ?? [], action)
      if (revert.raw) return decodeRaw(revert.raw, action)
    }
  }

  const candidate = error as { data?: Hex; cause?: { data?: Hex; raw?: Hex }; message?: string }
  const raw =
    (typeof candidate?.data === 'string' ? candidate.data : undefined) ??
    candidate?.cause?.raw ??
    (typeof candidate?.cause?.data === 'string' ? candidate.cause.data : undefined)
  if (raw?.startsWith('0x')) return decodeRaw(raw, action)

  const message = error instanceof Error ? error.message : String(error)
  if (message === 'BURNER_OUT_OF_MON') {
    return { name: 'BurnerOutOfMon', message: 'the burner is out of MON. top it up before sending.' }
  }
  if (message === 'NO_BURNER') {
    return { name: 'NoBurner', message: 'no burner key is stored for this wallet.' }
  }
  if (message === 'ACTION_RPC_UNAVAILABLE' || message === 'ACTION_RPC_BROADCAST_FAILED') {
    return {
      name: 'ActionRpcUnavailable',
      message: 'the action RPCs did not confirm acceptance. wait a moment or check the explorer before retrying.',
    }
  }
  if (message === 'ACTION_BALANCE_SYNC_TIMEOUT') {
    return {
      name: 'ActionBalanceSyncTimeout',
      message:
        'the funding receipt arrived, but the action RPCs have not caught up to the burner balance yet. wait a moment before retrying Live Mode.',
    }
  }
  if (message === 'ACTION_FUNDING_SETTLEMENT_TIMEOUT') {
    return {
      name: 'ActionFundingSettlementTimeout',
      message:
        'the burner funding receipt arrived, but the action RPCs are still catching up. r3OS stopped before starting the session; wait a moment and try Live Mode again.',
    }
  }
  if (message === 'ACTION_RECEIPT_TIMEOUT') {
    return {
      name: 'ActionReceiptTimeout',
      message:
        'the transaction was sent, but r3OS could not read its receipt yet. check the explorer before retrying.',
    }
  }
  // An internal code that reached the screen raw (ACTION_SOMETHING) still gets a readable sentence.
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(message)) {
    return {
      name: 'Unknown',
      message: `something went wrong (${message.toLowerCase().replace(/_/g, ' ')}). check the explorer before retrying.`,
    }
  }
  return { name: 'Unknown', message: sanitizedMessage(error), details: raw }
}

/**
 * Raw errors from viem embed the RPC URL ("URL: https://…/v2/KEY") and long request dumps. On screen we show
 * viem's short message, with any URL removed, so a screenshot of an error never leaks an endpoint.
 */
function sanitizedMessage(error: unknown) {
  const short = error instanceof BaseError ? error.shortMessage : undefined
  const text = short || (error instanceof Error ? error.message : String(error))
  return text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi, '[rpc]').slice(0, 300)
}

/**
 * What any window shows for an error: the readable explanation when r3OS knows the error (contract reverts,
 * internal codes like ACTION_RECEIPT_TIMEOUT, a closed wallet), otherwise viem's short message with every URL
 * removed. Programs used to show the raw text, so a code like ACTION_RECEIPT_TIMEOUT reached the screen as is.
 */
export function screenSafeMessage(error: unknown) {
  return friendlyError(error).message
}
