import { describe, expect, it } from 'vitest'
import { paintedText } from './paintedText'

describe('paintedText', () => {
  it('shows the block, and the receipt time only when it was measured', () => {
    expect(paintedText({ block: 123n })).toBe('included in block #123')
    expect(paintedText({ block: 123n, receiptMs: 640 })).toBe('included in block #123 · receipt in 0.6 s')
    expect(paintedText({ block: 9n, receiptMs: Number.NaN })).toBe('included in block #9')
    expect(paintedText({ block: 9n, receiptMs: -5 })).toBe('included in block #9')
  })
})
