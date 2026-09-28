import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { burnerStorageKey, loadBurner } from './burner'

const owner = '0x00000000000000000000000000000000000000A1' as Address

describe('burner storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('isolates keys by chain and owner', () => {
    expect(burnerStorageKey(owner, 143)).toBe('r3os.burner.143.0x00000000000000000000000000000000000000a1')
    expect(burnerStorageKey(owner, 143)).not.toBe(burnerStorageKey(owner, 10143))
    expect(burnerStorageKey(owner, 143)).not.toBe(
      burnerStorageKey('0x00000000000000000000000000000000000000B2', 143),
    )
  })

  it('treats blocked storage as no burner instead of throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadBurner(owner, 143)).toBeUndefined()
  })
})
