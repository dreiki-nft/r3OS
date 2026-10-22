import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBalloons, getBalloons } from './balloons'
import {
  STORM_ALERT_BLOCKS,
  alertDue,
  checkStormAlert,
  getStormAlert,
  resetStormAlertForTests,
  toggleStormAlert,
} from './stormAlert'

const STORM = 116_000_000n

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async () => FakeNotification.permission)
  static shown: { title: string; options?: NotificationOptions }[] = []
  onclick: (() => void) | null = null
  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.shown.push({ title, options })
  }
  close() {}
}

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

describe('storm bell', () => {
  let storage: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    clearBalloons()
    resetStormAlertForTests(false)
    storage = memoryStorage()
    FakeNotification.permission = 'default'
    FakeNotification.shown = []
    FakeNotification.requestPermission.mockClear()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { focus() {}, location: { hash: '' } })
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    vi.stubGlobal('Notification', FakeNotification)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rings once per storm, from 333 blocks before it until it starts', () => {
    expect(alertDue(STORM - STORM_ALERT_BLOCKS - 1n, undefined)).toBeUndefined()
    expect(alertDue(STORM - STORM_ALERT_BLOCKS, undefined)).toBe(STORM)
    expect(alertDue(STORM - 5n, undefined)).toBe(STORM) // a tab that woke up late still rings
    expect(alertDue(STORM - 5n, STORM)).toBeUndefined() // already rang for this storm
    expect(alertDue(STORM, undefined)).toBeUndefined() // the storm itself is on: the tray already says so
    expect(alertDue(0n, undefined)).toBeUndefined() // no block yet
  })

  it('turning it on asks for notifications once and is remembered', async () => {
    FakeNotification.requestPermission.mockImplementationOnce(async () => {
      FakeNotification.permission = 'granted'
      return 'granted'
    })
    expect(await toggleStormAlert()).toBe('on')
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
    expect(getStormAlert()).toBe(true)
    expect(storage.data.get('r3os.stormAlert')).toBe('1')
    expect(await toggleStormAlert()).toBe('off')
    expect(storage.data.get('r3os.stormAlert')).toBe('0')
  })

  it('still works inside r3OS when notifications are blocked or missing', async () => {
    FakeNotification.permission = 'denied'
    expect(await toggleStormAlert()).toBe('in-app')
    expect(getStormAlert()).toBe(true)
    checkStormAlert(STORM - 333n, 302)
    expect(getBalloons().map((b) => b.title)).toEqual(['⚡ DF1 storm in 333 blocks'])
    expect(FakeNotification.shown).toHaveLength(0)

    resetStormAlertForTests(false)
    vi.stubGlobal('Notification', undefined)
    expect(await toggleStormAlert()).toBe('in-app')
  })

  it('in the background: a balloon plus one browser notification per storm, tagged so tabs share it', () => {
    resetStormAlertForTests(true)
    FakeNotification.permission = 'granted'
    for (let b = STORM - 340n; b < STORM + 10n; b++) checkStormAlert(b, 302)
    expect(getBalloons().filter((b) => b.id === 'storm-alert')).toHaveLength(1)
    expect(getBalloons()[0].body).toContain('about 101 seconds')
    expect(FakeNotification.shown).toHaveLength(1)
    expect(FakeNotification.shown[0].title).toBe('⚡ DF1 storm in 333 blocks')
    expect(FakeNotification.shown[0].options?.tag).toBe(`r3os-storm-${STORM}`)
  })

  it('with r3OS in front, only the balloon: no system notification on top of it', () => {
    resetStormAlertForTests(true)
    FakeNotification.permission = 'granted'
    vi.stubGlobal('document', { visibilityState: 'visible' })
    checkStormAlert(STORM - 300n, 302)
    expect(getBalloons()).toHaveLength(1)
    expect(FakeNotification.shown).toHaveLength(0)
  })

  it('off means silent', () => {
    checkStormAlert(STORM - 333n, 302)
    expect(getBalloons()).toHaveLength(0)
  })
})
