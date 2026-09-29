export type R3StoreName = 'frameInfo' | 'frameImage' | 'owners' | 'logCache'

type LruEntry = {
  key: string
  value: unknown
}

const DB_NAME = 'r3tards-paint'
const DB_VERSION = 2
const STORES: R3StoreName[] = ['frameInfo', 'frameImage', 'owners', 'logCache']
const FALLBACK_LIMIT = 300
const memory = new Map<string, LruEntry>()
let dbPromise: Promise<IDBDatabase> | undefined
let blocked = false

function memoryKey(store: R3StoreName, key: IDBValidKey) {
  return `${store}:${String(key)}`
}

function memoryGet<T>(store: R3StoreName, key: IDBValidKey): T | undefined {
  const compound = memoryKey(store, key)
  const entry = memory.get(compound)
  if (!entry) return undefined
  memory.delete(compound)
  memory.set(compound, entry)
  return entry.value as T
}

function memorySet(store: R3StoreName, key: IDBValidKey, value: unknown) {
  const compound = memoryKey(store, key)
  memory.delete(compound)
  memory.set(compound, { key: compound, value })
  while (memory.size > FALLBACK_LIMIT) {
    const oldest = memory.keys().next().value as string | undefined
    if (oldest == null) break
    memory.delete(oldest)
  }
}

function openDatabase() {
  if (blocked || typeof indexedDB === 'undefined') return Promise.reject(new Error('indexeddb unavailable'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('indexeddb open failed'))
      request.onblocked = () => reject(new Error('indexeddb blocked'))
    } catch (error) {
      reject(error)
    }
  }).catch((error) => {
    blocked = true
    dbPromise = undefined
    throw error
  })
  return dbPromise
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'))
  })
}

export async function idbGet<T>(store: R3StoreName, key: IDBValidKey): Promise<T | undefined> {
  const fallback = memoryGet<T>(store, key)
  if (fallback !== undefined) return fallback
  try {
    const db = await openDatabase()
    const value = await requestValue(db.transaction(store, 'readonly').objectStore(store).get(key))
    if (value !== undefined) memorySet(store, key, value)
    return value as T | undefined
  } catch {
    return memoryGet<T>(store, key)
  }
}

export async function idbSet<T>(store: R3StoreName, key: IDBValidKey, value: T): Promise<void> {
  memorySet(store, key, value)
  try {
    const db = await openDatabase()
    const transaction = db.transaction(store, 'readwrite')
    transaction.objectStore(store).put(value, key)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb write failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb write aborted'))
    })
  } catch {
    // The in-memory LRU is the supported fallback.
  }
}

export async function idbDelete(store: R3StoreName, key: IDBValidKey): Promise<void> {
  memory.delete(memoryKey(store, key))
  try {
    const db = await openDatabase()
    const transaction = db.transaction(store, 'readwrite')
    transaction.objectStore(store).delete(key)
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
  } catch {
    // Storage can be unavailable without breaking the app.
  }
}

export function __resetIdbForTests() {
  memory.clear()
  blocked = false
  dbPromise = undefined
}
