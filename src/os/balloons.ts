import type { IconName } from './icons'
import type { SoundName } from './sound'

type Listener = () => void

export interface BalloonNotice {
  id: number | string
  title: string
  body: string
  icon?: IconName
  href?: string
  hrefLabel?: string
  sound?: SoundName
  /** Buttons under the text. Each one runs, then closes the balloon. */
  actions?: { label: string; run: () => void }[]
  /** Stay until closed instead of fading after 8 s (for a question). */
  sticky?: boolean
}

type BalloonInput = Omit<BalloonNotice, 'id'> & { id?: BalloonNotice['id'] }

let nextId = 1
let notices: BalloonNotice[] = []
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

export function getBalloons() {
  return notices
}

export function subscribeBalloons(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pushBalloon(notice: BalloonInput) {
  const id = notice.id ?? nextId++
  const next = { ...notice, id }
  notices = [...notices.filter((entry) => entry.id !== id).slice(-2), next]
  emit()
  return id
}

export function dismissBalloon(id: BalloonNotice['id']) {
  notices = notices.filter((notice) => notice.id !== id)
  emit()
}

export function clearBalloons() {
  notices = []
  emit()
}
