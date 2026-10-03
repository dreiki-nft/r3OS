import type { ImageResource } from './imageResources'

type Listener = () => void
export interface FloppyRequest {
  id: number
  resource: ImageResource
}

let request: FloppyRequest | undefined
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

export function requestFloppy(resource: ImageResource) {
  request = { id: nextId++, resource }
  emit()
}

export function getFloppyRequest() {
  return request
}

export function subscribeFloppy(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function closeFloppy(id?: number) {
  if (!request || (id != null && request.id !== id)) return
  request = undefined
  emit()
}
