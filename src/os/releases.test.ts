import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeInstallAnnouncement,
  fetchReleaseConfig,
  programVisibleAt,
  resetReleaseTestState,
  type ReleaseConfig,
  type StorageLike,
} from './releases'

const config: ReleaseConfig = {
  programs: {
    auction: '2026-11-08T18:00:00Z',
    quests: '2026-11-15T18:00:00Z',
  },
}

function fakeStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}

describe('release schedule', () => {
  beforeEach(() => resetReleaseTestState())

  it('maps listed future/past, unlisted and reveal-all visibility', () => {
    const before = Date.parse('2026-11-01T00:00:00Z')
    const afterAuction = Date.parse('2026-11-10T00:00:00Z')
    expect(programVisibleAt(config, 'auction', before)).toBe(false)
    expect(programVisibleAt(config, 'auction', afterAuction)).toBe(true)
    expect(programVisibleAt(config, 'paint', before)).toBe(true)
    expect(programVisibleAt(config, 'quests', before, true)).toBe(true)
  })

  it('fails closed when the schedule fetch fails', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    await expect(fetchReleaseConfig(fetcher)).rejects.toThrow('offline')
    expect(programVisibleAt(config, 'auction', Date.parse('2027-01-01T00:00:00Z'), false, 'failed')).toBe(false)
  })

  it('announces an installed program only once', () => {
    const storage = fakeStorage()
    expect(consumeInstallAnnouncement('auction', storage)).toBe(true)
    expect(consumeInstallAnnouncement('auction', storage)).toBe(false)
  })
})
