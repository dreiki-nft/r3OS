import { describe, expect, it } from 'vitest'
import { decodeLabsTokenUri } from './labsToken'

describe('labsToken', () => {
  it('decodes a base64 tokenURI into typed attributes', () => {
    const json = JSON.stringify({
      name: 'r3tards labs reel #7',
      image: 'data:image/svg+xml;base64,PHN2Zy8+',
      attributes: [
        { trait_type: 'Type', value: 'Reel' },
        { trait_type: 'Frames', value: 32 },
        { trait_type: 'Storm', value: false },
      ],
    })
    const uri = `data:application/json;base64,${btoa(json)}`
    expect(decodeLabsTokenUri(uri)).toEqual({
      name: 'r3tards labs reel #7',
      image: 'data:image/svg+xml;base64,PHN2Zy8+',
      attributes: { Type: 'Reel', Frames: 32, Storm: false },
    })
  })
})
