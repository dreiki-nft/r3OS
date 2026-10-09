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
          name: ['quests', 'cd-burner', 'recycle-bin'][Number(args![0])],
          retired: false,
        }
      return '0x0000000000000000000000000000000000000009'
    },
  },
}))
vi.mock('./config', () => ({
  config: { chainId: 143, paintAddress: '0x00000000000000000000000000000000000000aa', labs: {} },
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
    // The first dynamic import transforms the whole chain module graph; cold runs on Windows can pass 5 s.
  }, 30_000)

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

  it('consumes the Boot Packet registry/status seed instead of repeating those startup calls', async () => {
    const boot = await import('./bootPacket')
    boot.__setBootPacketForTests({
      at: Date.now(),
      elapsedMs: 175,
      memberCount: 10,
      httpRequests: 1,
      paintAddress: '0x00000000000000000000000000000000000000aa',
      chainId: 143,
      blockNumber: 123n,
      clientVersion: 'Monad/test',
      paintCode: '0x6001',
      painterPass: '0x0000000000000000000000000000000000000009',
      r3tards: '0x0000000000000000000000000000000000000008',
      experimentCount: 2,
      renderersFrozen: false,
      experimentsFrozen: true,
      complete: true,
    })
    const { discoverContracts, readCoreStatus } = await import('./contracts')
    const value = await discoverContracts()
    const status = await readCoreStatus()
    expect(value.experimentCount).toBe(2)
    expect(status).toEqual({ renderersFrozen: false, experimentsFrozen: true })
    expect(calls).not.toContain('painterPass')
    expect(calls).not.toContain('R3TARDS')
    expect(calls).not.toContain('experimentCount')
    expect(calls).not.toContain('renderersFrozen')
    expect(calls).not.toContain('experimentsFrozen')
    expect(calls.filter((name) => name === 'experimentInfo')).toHaveLength(2)
  })

  it('ignores a stale Boot Packet instead of pinning old mutable registry state', async () => {
    const boot = await import('./bootPacket')
    boot.__setBootPacketForTests({
      at: Date.now() - 60_000,
      elapsedMs: 175,
      memberCount: 10,
      httpRequests: 1,
      paintAddress: '0x00000000000000000000000000000000000000aa',
      chainId: 143,
      blockNumber: 123n,
      clientVersion: 'Monad/test',
      paintCode: '0x6001',
      painterPass: '0x0000000000000000000000000000000000000009',
      r3tards: '0x0000000000000000000000000000000000000008',
      experimentCount: 2,
      renderersFrozen: false,
      experimentsFrozen: true,
      complete: true,
    })
    const { discoverContracts } = await import('./contracts')
    const value = await discoverContracts()
    expect(value.experimentCount).toBe(3)
    expect(calls).toContain('experimentCount')
    expect(calls.filter((name) => name === 'experimentInfo')).toHaveLength(3)
  })
})
