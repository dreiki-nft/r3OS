import { describe, expect, it } from 'vitest'
import { decodeLabsTokenUri } from './labsToken'

describe('labsToken', () => {
  it('decodes a base64 tokenURI into typed attributes', () => {
    const json = JSON.stringify({
      name: 'r3OS labs cd #7',
      image: 'data:image/svg+xml;base64,PHN2Zy8+',
      attributes: [
        { trait_type: 'Type', value: 'CD' },
        { trait_type: 'Tracks', value: 12 },
        { trait_type: 'Storm', value: false },
      ],
    })
    const uri = `data:application/json;base64,${btoa(json)}`
    expect(decodeLabsTokenUri(uri)).toEqual({
      name: 'r3OS labs cd #7',
      image: 'data:image/svg+xml;base64,PHN2Zy8+',
      attributes: { Type: 'CD', Tracks: 12, Storm: false },
    })
  })
})
