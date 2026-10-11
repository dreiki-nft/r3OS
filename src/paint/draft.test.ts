import { describe, expect, it } from 'vitest'
import { applyDraft, decodeDraft, draftPixels, encodeDraft } from './draft'

describe('unsent drawing kept across reloads', () => {
  it('stores only changed pixels and restores them exactly', () => {
    const background = new Uint8Array(65_536)
    const working = background.slice()
    working[0] = 3
    working[300] = 15
    working[65_535] = 7
    const pixels = draftPixels(background, working)
    expect(pixels).toEqual([
      [0, 3],
      [300, 15],
      [65_535, 7],
    ])
    expect(decodeDraft(encodeDraft(pixels))).toEqual(pixels)
    expect(applyDraft(background, new Uint8Array(65_536), decodeDraft(encodeDraft(pixels)))).toEqual(working)
  })

  it('never paints over protected outline pixels and handles a full-canvas drawing', () => {
    const background = new Uint8Array(65_536)
    const outline = new Uint8Array(65_536)
    outline[300] = 1
    const restored = applyDraft(background, outline, [
      [300, 9],
      [301, 9],
    ])
    expect(restored[300]).toBe(0)
    expect(restored[301]).toBe(9)
    const everything = new Uint8Array(65_536).fill(5)
    const big = draftPixels(background, everything)
    expect(decodeDraft(encodeDraft(big))).toHaveLength(65_536)
  })
})
