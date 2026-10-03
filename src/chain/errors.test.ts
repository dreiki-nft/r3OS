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
