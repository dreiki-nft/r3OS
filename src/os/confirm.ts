/**
 * In-OS confirmation dialogs. `osConfirm` returns a promise that settles when the person answers the
 * r3tardOS message box rendered by <ConfirmHost />. It replaces `window.confirm`, which is off-brand,
 * blocks the page and is suppressed by some embedded wallet browsers.
 */

type Listener = () => void

export interface ConfirmRequest {
  id: number
  title: string
  message: string
  details?: string
  kind: 'info' | 'warning'
  okLabel: string
  cancelLabel: string
}

export type ConfirmInput = Partial<Omit<ConfirmRequest, 'id' | 'message'>> & { message: string }

let nextId = 1
let queue: Array<ConfirmRequest & { resolve: (value: boolean) => void }> = []
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeConfirm(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The request currently on screen; later requests wait their turn. */
export function getConfirm(): ConfirmRequest | undefined {
  return queue[0]
}

export function osConfirm(input: ConfirmInput): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        id: nextId++,
        title: input.title ?? 'r3tardOS',
        message: input.message,
        details: input.details,
        kind: input.kind ?? 'warning',
        okLabel: input.okLabel ?? 'OK',
        cancelLabel: input.cancelLabel ?? 'Cancel',
        resolve,
      },
    ]
    emit()
  })
}

/** Settles a request once; a second answer for the same id (OK followed by close) is ignored. */
export function answerConfirm(id: number, value: boolean) {
  const request = queue.find((entry) => entry.id === id)
  if (!request) return
  queue = queue.filter((entry) => entry.id !== id)
  request.resolve(value)
  emit()
}

/** The tx pipeline's `confirmHigherCost` hook: asks before sending at a higher quoted cost. */
export function confirmHigherCost(oldQuote: { maxCost: string }, nextQuote: { maxCost: string }) {
  return osConfirm({
    title: 'Gas went up',
    message: `The network fee moved since the quote.\n\nwas ${oldQuote.maxCost}\nnow ${nextQuote.maxCost}\n\nContinue at the new cost?`,
    okLabel: 'Continue',
  })
}

export function resetConfirmForTest() {
  for (const entry of queue) entry.resolve(false)
  queue = []
  nextId = 1
}
