import { describe, expect, it } from 'vitest'
import { decodeDataUri, decodeJsonDataUri } from './dataUri'

function base64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

describe('data URI decoding', () => {
  it('decodes base64 JSON with non-ASCII text', () => {
    const json = JSON.stringify({ name: 'r3tard ♥' })
    expect(decodeJsonDataUri<{ name: string }>(`data:application/json;base64,${base64Utf8(json)}`).name).toBe(
      'r3tard ♥',
    )
  })

  it('decodes utf8 and plain URI-encoded forms', () => {
    const payload = encodeURIComponent('{"name":"cyan ♥"}')
    expect(decodeDataUri(`data:application/json;utf8,${payload}`)).toBe('{"name":"cyan ♥"}')
    expect(decodeJsonDataUri<{ name: string }>(`data:application/json,${payload}`).name).toBe('cyan ♥')
  })
})
