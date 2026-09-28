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
