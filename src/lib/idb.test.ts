import { beforeEach, describe, expect, it } from 'vitest'
import { __resetIdbForTests, idbGet, idbSet } from './idb'

describe('idb fallback', () => {
  beforeEach(__resetIdbForTests)

  it('uses the in-memory LRU when indexedDB is unavailable', async () => {
    expect(typeof indexedDB).toBe('undefined')
    await expect(idbSet('frameInfo', '143:1', { token: 1 })).resolves.toBeUndefined()
    await expect(idbGet<{ token: number }>('frameInfo', '143:1')).resolves.toEqual({ token: 1 })
  })
})
