function decodeBase64Utf8(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Decode text-bearing data URIs without trusting or injecting their markup. */
export function decodeDataUri(uri: string) {
  const comma = uri.indexOf(',')
  if (!uri.startsWith('data:') || comma < 0) throw new Error('invalid data URI')
  const header = uri.slice(5, comma)
  const payload = uri.slice(comma + 1)
  if (header.toLowerCase().includes(';base64')) return decodeBase64Utf8(payload)
  return decodeURIComponent(payload)
}

export function decodeJsonDataUri<T = unknown>(uri: string): T {
  return JSON.parse(decodeDataUri(uri)) as T
}
