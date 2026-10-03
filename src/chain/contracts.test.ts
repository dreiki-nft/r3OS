import { afterEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
let fail = false

vi.mock('./clients', () => ({
  publicClient: {
    async readContract({ functionName, args }: { functionName: string; args?: unknown[] }) {
      calls.push(functionName)
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (fail) throw new Error('offline')
      if (functionName === 'experimentCount') return 3n
      if (functionName === 'renderersFrozen') return false
      if (functionName === 'experimentsFrozen') return true
      if (functionName === 'experimentInfo')
        return {
          experiment: `0x000000000000000000000000000000000000000${Number(args![0]) + 1}`,
          name: ['quests', 'cd-burner', 'flipbook'][Number(args![0])],
          retired: false,
        }
      return '0x0000000000000000000000000000000000000009'
    },
  },
}))
vi.mock('./config', () => ({
  config: { paintAddress: '0x00000000000000000000000000000000000000aa', labs: {} },
}))

afterEach(() => {
  calls.length = 0
  fail = false
  vi.resetModules()
})

describe('discoverContracts', () => {
  it('shares one registry read between concurrent callers and caches it', async () => {
    const { discoverContracts } = await import('./contracts')
    const results = await Promise.all(Array.from({ length: 6 }, () => discoverContracts()))
    expect(new Set(results).size).toBe(1)
    expect(calls.filter((name) => name === 'experimentInfo')).toHaveLength(3)
    await discoverContracts()
    expect(calls.filter((name) => name === 'experimentInfo')).toHaveLength(3)
    expect(results[0].labs.quests).toBe('0x0000000000000000000000000000000000000001')
    expect(results[0].experimentCount).toBe(3)
    expect((await import('./contracts')).getCachedContracts()).toBe(results[0])
  })

  it('shares the short-lived core status read', async () => {
    const { readCoreStatus, getCachedCoreStatus } = await import('./contracts')
    const values = await Promise.all([readCoreStatus(), readCoreStatus(), readCoreStatus()])
    expect(values).toEqual([
      { renderersFrozen: false, experimentsFrozen: true },
      { renderersFrozen: false, experimentsFrozen: true },
      { renderersFrozen: false, experimentsFrozen: true },
    ])
    expect(calls.filter((name) => name === 'renderersFrozen')).toHaveLength(1)
    expect(calls.filter((name) => name === 'experimentsFrozen')).toHaveLength(1)
    expect(getCachedCoreStatus()).toEqual({ renderersFrozen: false, experimentsFrozen: true })
  })

  it('does not cache a failed read, and force re-reads', async () => {
    const { discoverContracts } = await import('./contracts')
    fail = true
    await expect(discoverContracts()).rejects.toThrow('offline')
    fail = false
    await discoverContracts()
    await discoverContracts(true)
    expect(calls.filter((name) => name === 'experimentCount')).toHaveLength(3)
  })
})
