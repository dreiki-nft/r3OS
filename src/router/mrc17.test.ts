import { describe, expect, it } from 'vitest'
import { toFunctionSelector } from 'viem'
import { ADAPTER_ERROR_TABLE, decodeAdapterError } from './mrc17'

describe('MRC-17 adapter-specific error decoding', () => {
  it('covers the pinned known selectors', () => {
    const feed = toFunctionSelector('FeedStalled()')
    expect(feed).toBe('0x9a0423af')
    expect(decodeAdapterError(feed)?.name).toBe('FeedStalled')
    expect(decodeAdapterError(toFunctionSelector('InvalidTokenPair()'))?.meaning).toContain('pair')
    expect(ADAPTER_ERROR_TABLE.size).toBeGreaterThanOrEqual(8)
  })

  it('keeps unknown and empty selectors neutral', () => {
    expect(decodeAdapterError('0x12345678')).toEqual({ selector: '0x12345678', adapterSpecific: false })
    expect(decodeAdapterError('0x00000000')).toBeUndefined()
  })
})
