import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { choosePassDisplay, resolveHolderIds } from './holders'

const owner = '0x00000000000000000000000000000000000000a1' as Address
const collection = '0x00000000000000000000000000000000000000b1' as Address

function client(enumerable = true) {
  const calls: string[] = []
  return {
    calls,
    async readContract(input: { functionName: string; args?: readonly unknown[] }) {
      calls.push(input.functionName)
      if (input.functionName === 'balanceOf') return 2n
      if (input.functionName === 'supportsInterface') return enumerable
      if (input.functionName === 'tokenOfOwnerByIndex') return BigInt(input.args?.[1] as bigint) + 1n
      if (input.functionName === 'tokensOfOwner') return [7n, 8n]
      if (input.functionName === 'ownerOf') {
        const id = input.args?.[0] as bigint
        return id === 2n || id === 99n ? '0x00000000000000000000000000000000000000ff' : owner
      }
      throw new Error('unexpected read')
    },
  } as never
}

describe('holders', () => {
  it('tries enumerable first and verifies ownerOf', async () => {
    const instance = client(true) as unknown as { calls: string[] }
    expect(await resolveHolderIds(instance as never, collection, owner)).toEqual([1n])
    expect(instance.calls.indexOf('tokenOfOwnerByIndex')).toBeGreaterThan(
      instance.calls.indexOf('supportsInterface'),
    )
  })

  it('falls back to tokensOfOwner', async () => {
    expect(await resolveHolderIds(client(false), collection, owner)).toEqual([7n, 8n])
  })

  it('unions manual ids with automatic ids, de-duplicates, then verifies', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    expect(await resolveHolderIds(client(true), collection, owner, [1n, 3n, 99n])).toEqual([1n, 3n])
  })

  it('chooses the lowest verified display and drops stale choices', () => {
    expect(choosePassDisplay([9n, 3n], '9')).toBe(9n)
    expect(choosePassDisplay([9n, 3n], '7')).toBe(3n)
    expect(choosePassDisplay([9n, 3n], 'none')).toBeNull()
  })
})
