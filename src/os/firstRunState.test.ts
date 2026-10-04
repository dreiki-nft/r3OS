import { describe, expect, it } from 'vitest'
import {
  FIRST_RUN_CHOICES,
  FIRST_RUN_KEY,
  isFirstRunOpen,
  rememberFirstRun,
  setFirstRunOpen,
  shouldShowFirstRun,
  subscribeFirstRun,
} from './firstRunState'
import { programById } from './programs'

function memory() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('first-run welcome', () => {
  it('shows once on the bare desktop, never on a deep link', () => {
    const storage = memory()
    expect(shouldShowFirstRun(storage, '')).toBe(true)
    expect(shouldShowFirstRun(storage, '#/')).toBe(true)
    expect(shouldShowFirstRun(storage, '#/paint')).toBe(false)
    expect(shouldShowFirstRun(storage, '#/frames?frame=3')).toBe(false)
  })

  it('stays dismissed after "don’t show again", and comes back if unticked', () => {
    const storage = memory()
    rememberFirstRun(storage, false)
    expect(shouldShowFirstRun(storage, '')).toBe(true)
    rememberFirstRun(storage, true)
    expect(storage.map.get(FIRST_RUN_KEY)).toBe('1')
    expect(shouldShowFirstRun(storage, '')).toBe(false)
  })

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(shouldShowFirstRun(blocked, '')).toBe(true)
    expect(() => rememberFirstRun(blocked, true)).not.toThrow()
    expect(shouldShowFirstRun(undefined, '')).toBe(true)
  })

  it('routes its three buttons to useful, wallet-optional first actions', () => {
    expect(FIRST_RUN_CHOICES.map((choice) => choice.id)).toEqual(['paint', 'monad-hw', 'help'])
    for (const choice of FIRST_RUN_CHOICES) expect(programById(choice.id), choice.id).toBeTruthy()
    expect(FIRST_RUN_CHOICES.map((choice) => choice.label)).toEqual([
      'Paint together',
      'See Monad live',
      '60-second tour',
    ])
  })

  it('tells listeners when it opens and closes', () => {
    let calls = 0
    const stop = subscribeFirstRun(() => calls++)
    setFirstRunOpen(true)
    setFirstRunOpen(true)
    expect(isFirstRunOpen()).toBe(true)
    setFirstRunOpen(false)
    stop()
    expect(calls).toBe(2)
  })
})
