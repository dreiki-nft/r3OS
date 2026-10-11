import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
  type Abi,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { friendlyError, isUserRejected } from './errors'

const frameAbi = parseAbi(['error FramePaintRequired()', 'function mintFrame()'])
const faceAbi = parseAbi(['error NoChange()', 'function setFace(uint8,uint256[])'])

function executionError(abi: Abi, functionName: string, data: Hex, args: readonly unknown[] = []) {
  return new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi, data, functionName }), {
    abi,
    functionName,
    args,
  })
}

describe('friendly errors', () => {
  it('recognises wallet rejection', () => {
    expect(isUserRejected({ code: 4001 })).toBe(true)
    expect(friendlyError({ code: 4001 }).message).toContain('nothing was sent')
  })

  it('walks a real viem FramePaintRequired error', () => {
    const data = encodeErrorResult({ abi: frameAbi, errorName: 'FramePaintRequired' })
    expect(friendlyError(executionError(frameAbi, 'mintFrame', data), 'mintFrame').message).toContain(
      'paint something first',
    )
  })

  it('keeps tile and region refusal copy factual', () => {
    const abi = parseAbi([
      'error TileTooHot(uint256 tile)',
      'error RegionBusy(uint256 region)',
      'function paint()',
    ])
    const hot = encodeErrorResult({ abi, errorName: 'TileTooHot', args: [37n] })
    const busy = encodeErrorResult({ abi, errorName: 'RegionBusy', args: [3n] })
    expect(friendlyError(executionError(abi, 'paint', hot), 'paint').message).toContain('tile 37')
    expect(friendlyError(executionError(abi, 'paint', busy), 'paint').message).toBe(
      'region 3 hit its per-block paint limit. try again next block.',
    )
  })

  it('gives setFace-specific NoChange copy', () => {
    const data = encodeErrorResult({ abi: faceAbi, errorName: 'NoChange' })
    const error = executionError(faceAbi, 'setFace', data, [1, []])
    expect(friendlyError(error, 'setFace').message).toBe('the face is already that colour.')
  })

  it('decodes CD Burner custom errors even when the call ABI only contains the function', () => {
    const errors = parseAbi([
      'error NotFrameOwner(uint256 frameId,address owner)',
      'error NotLabsOwner(uint256 tokenId,address owner)',
    ])
    const callAbi = parseAbi(['function burnCD(uint256[] frameIds,string label)'])
    const owner = '0x0000000000000000000000000000000000000001' as const
    const frame = encodeErrorResult({ abi: errors, errorName: 'NotFrameOwner', args: [18n, owner] })
    const photo = encodeErrorResult({ abi: errors, errorName: 'NotLabsOwner', args: [7n, owner] })
    expect(friendlyError(executionError(callAbi, 'burnCD', frame), 'burnCD').message).toContain('frame #18')
    expect(friendlyError(executionError(callAbi, 'burnCD', photo), 'burnCD').message).toContain('Labs token #7')
  })

  it('keeps an unknown raw selector in details', () => {
    const raw = '0xdeadbeef' as const
    const error = executionError(frameAbi, 'mintFrame', raw)
    expect(friendlyError(error).details).toBe(raw)
  })
})

describe('screenSafeMessage', () => {
  it('never shows an RPC URL', async () => {
    const { screenSafeMessage } = await import('./errors')
    const error = new Error(
      'HTTP request failed.\n\nURL: https://rpc.example.com/v2/SECRETKEY\nRequest body: {}',
    )
    expect(screenSafeMessage(error)).not.toContain('SECRETKEY')
    expect(screenSafeMessage(error)).toContain('[rpc]')
    expect(screenSafeMessage('wss://x.example/ws?key=abc down')).toBe('[rpc] down')
  })
})

describe('readable errors everywhere', () => {
  it('turns internal codes into sentences in every window, not just Paint', async () => {
    const { screenSafeMessage } = await import('./errors')
    expect(screenSafeMessage(new Error('ACTION_RECEIPT_TIMEOUT'))).toContain('could not read its receipt')
    expect(screenSafeMessage(new Error('SOME_NEW_CODE'))).toBe(
      'something went wrong (some new code). check the explorer before retrying.',
    )
    expect(screenSafeMessage(new Error('plain words stay'))).toBe('plain words stay')
  })

  it('explains that the budget is in units, not pixels', async () => {
    const { friendlyError } = await import('./errors')
    const { encodeErrorResult } = await import('viem')
    const { R3OS_PAINT_ABI } = await import('../lib/generated/abi')
    const data = encodeErrorResult({ abi: R3OS_PAINT_ABI, errorName: 'InsufficientBudget', args: [595n, 591n] })
    const message = friendlyError({ data }).message
    expect(message).toContain('this stroke costs 595, you have 591 left')
    expect(message).toContain('already-painted pixels costs 2 each')
    expect(message).not.toContain('not enough pixels')
  })
})

describe('wallet with a request already waiting', () => {
  it('says to open the wallet instead of showing the raw -32002 text', async () => {
    const { friendlyError } = await import('./errors')
    const message = friendlyError({ code: -32002, message: "Request of type 'wallet_requestPermissions' already pending" }).message
    expect(message).toContain('open the wallet extension')
  })
})
