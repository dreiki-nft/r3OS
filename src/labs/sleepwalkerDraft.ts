import type { Hex } from 'viem'

export interface SleepwalkerDraft {
  runs: Hex
  pixels: number
  holderIds: bigint[]
  version: number
  onSubmitted?: () => void
}

type Listener = () => void
const listeners = new Set<Listener>()
let draft: SleepwalkerDraft | undefined
let submittedVersion = 0

function emit() {
  for (const listener of listeners) listener()
}

export function setSleepwalkerDraft(next: Omit<SleepwalkerDraft, 'version'>) {
  draft = { ...next, holderIds: [...next.holderIds], version: (draft?.version ?? 0) + 1 }
  emit()
  return draft
}

export function getSleepwalkerDraft() {
  return draft
}

export function subscribeSleepwalkerDraft(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function markSleepwalkerDraftSubmitted(version: number) {
  if (!draft || draft.version !== version) return
  submittedVersion = version
  draft.onSubmitted?.()
  emit()
}

export function sleepwalkerDraftSubmitted(version: number) {
  return submittedVersion >= version
}

export function clearSleepwalkerDraft() {
  draft = undefined
  emit()
}

export function __resetSleepwalkerDraftForTests() {
  draft = undefined
  submittedVersion = 0
  emit()
}
