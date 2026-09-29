type Listener = () => void

export interface ReleaseConfig {
  programs: Record<string, string>
}

export type ReleaseStatus = 'loading' | 'ready' | 'failed'

export interface ReleaseSnapshot {
  status: ReleaseStatus
  config: ReleaseConfig
  now: number
  revealAll: boolean
  version: number
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const EMPTY_CONFIG: ReleaseConfig = { programs: {} }
const listeners = new Set<Listener>()
const announced = new Set<string>()
const opened = new Set<string>()

function envTrue(name: string) {
  return (
    String((import.meta.env as Record<string, unknown>)[name] ?? '')
      .trim()
      .toLowerCase() === 'true'
  )
}

const revealAllByEnv = Boolean(import.meta.env.DEV) || envTrue('VITE_REVEAL_ALL')
let state: ReleaseSnapshot = {
  status: 'loading',
  config: EMPTY_CONFIG,
  now: Date.now(),
  revealAll: revealAllByEnv,
  version: 0,
}
let initPromise: Promise<void> | undefined
let minuteTimer: number | undefined

function emit(next?: Partial<ReleaseSnapshot>) {
  state = {
    ...state,
    ...next,
    version: state.version + 1,
  }
  for (const listener of listeners) listener()
}

export function getReleaseSnapshot() {
  return state
}

export function subscribeReleases(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function normalizeReleaseConfig(value: unknown): ReleaseConfig {
  if (!value || typeof value !== 'object') throw new Error('invalid release schedule')
  const raw = (value as { programs?: unknown }).programs
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid release schedule')
  const programs: Record<string, string> = {}
  for (const [id, date] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof date === 'string' && id.trim()) programs[id.trim()] = date.trim()
  }
  return { programs }
}

export function programVisibleAt(
  config: ReleaseConfig,
  id: string,
  now: number,
  revealAll = false,
  status: ReleaseStatus = 'ready',
) {
  if (revealAll) return true
  if (status !== 'ready') return false
  const date = config.programs[id]
  if (date == null) return true
  const revealAt = Date.parse(date)
  return Number.isFinite(revealAt) && now >= revealAt
}

export function isProgramAvailable(id: string, snapshot = state) {
  return programVisibleAt(snapshot.config, id, snapshot.now, snapshot.revealAll, snapshot.status)
}

export function isScheduledProgram(id: string, snapshot = state) {
  return snapshot.status === 'ready' && Object.prototype.hasOwnProperty.call(snapshot.config.programs, id)
}

export function availableScheduledPrograms(snapshot = state) {
  if (snapshot.status !== 'ready') return []
  return Object.keys(snapshot.config.programs).filter((id) => isProgramAvailable(id, snapshot))
}

export async function fetchReleaseConfig(fetcher: typeof fetch = fetch) {
  const response = await fetcher('/releases.json', { cache: 'no-store' })
  if (!response.ok) throw new Error(`release schedule HTTP ${response.status}`)
  return normalizeReleaseConfig(await response.json())
}

export function initReleases(fetcher: typeof fetch = fetch) {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const config = await fetchReleaseConfig(fetcher)
      emit({ status: 'ready', config, now: Date.now() })
    } catch (error) {
      console.error('release schedule unavailable; hiding programs until the schedule can be read', error)
      emit({ status: 'failed', config: EMPTY_CONFIG, now: Date.now() })
    }
    if (typeof window !== 'undefined' && minuteTimer == null) {
      minuteTimer = window.setInterval(() => emit({ now: Date.now() }), 60_000)
    }
  })()
  return initPromise
}

function storageOrUndefined(storage?: StorageLike) {
  if (storage) return storage
  if (typeof localStorage === 'undefined') return undefined
  return localStorage
}

export function consumeInstallAnnouncement(id: string, storage?: StorageLike) {
  if (announced.has(id)) return false
  const key = `r3os.installed.${id}`
  const target = storageOrUndefined(storage)
  try {
    if (target?.getItem(key) === '1') {
      announced.add(id)
      return false
    }
    target?.setItem(key, '1')
  } catch {
    // Storage can be blocked; the in-memory set still prevents repeats this session.
  }
  announced.add(id)
  return true
}

export function markProgramOpened(id: string, storage?: StorageLike) {
  opened.add(id)
  try {
    storageOrUndefined(storage)?.setItem(`r3os.opened.${id}`, '1')
  } catch {
    // Storage can be blocked.
  }
}

export function hasProgramBeenOpened(id: string, storage?: StorageLike) {
  if (opened.has(id)) return true
  try {
    if (storageOrUndefined(storage)?.getItem(`r3os.opened.${id}`) === '1') {
      opened.add(id)
      return true
    }
  } catch {
    // Storage can be blocked.
  }
  return false
}

export function programNeedsSparkle(id: string, snapshot = state, storage?: StorageLike) {
  return (
    !snapshot.revealAll &&
    isScheduledProgram(id, snapshot) &&
    isProgramAvailable(id, snapshot) &&
    !hasProgramBeenOpened(id, storage)
  )
}

export function resetReleaseTestState() {
  announced.clear()
  opened.clear()
}
