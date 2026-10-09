/**
 * Painter names. A shared space feels social when you can recognize people, so instead of 0x7099…79C8 r3OS
 * shows, for every wallet:
 *   1. its Nad Name Service primary name (`dreiki.nad`), read onchain on Monad mainnet, or
 *   2. a fixed nickname made from the address (`cyan crayon·79c8`), identical for every viewer.
 * No server, nothing stored: names are read from the NNS contract in batches and cached for this tab.
 */
import { useSyncExternalStore } from 'react'
import { parseAbi, type Address } from 'viem'
import { config } from './config'
import { readMany } from './readMany'

/** Nad Name Service on Monad mainnet (docs.nad.domains › Contract addresses). */
export const NNS_MAINNET = '0xCc7a1bfF8845573dbF0B3b96e25B9b549d4a2eC7' as Address
const NNS_ABI = parseAbi(['function getPrimaryNameForAddress(address addr) view returns (string)'])

const NAME_TTL_MS = 30 * 60_000
const MISS_TTL_MS = 5 * 60_000
const BATCH_WAIT_MS = 250
const BATCH_MAX = 100

const ADJECTIVES = [
  'cyan',
  'gold',
  'magenta',
  'olive',
  'pink',
  'purple',
  'orange',
  'green',
  'red',
  'brown',
  'white',
  'storm',
]
const NOUNS = [
  'brush',
  'pixel',
  'crayon',
  'easel',
  'doodle',
  'smudge',
  'palette',
  'stroke',
  'marker',
  'sketch',
  'spray',
  'canvas',
]

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function hash(text: string) {
  let value = 2166136261
  for (const char of text) {
    value ^= char.charCodeAt(0)
    value = Math.imul(value, 16777619) >>> 0
  }
  return value
}

/** The fixed fallback name: the same for every viewer, with the address tail so it can be checked. */
export function nicknameFor(address: string) {
  const lower = address.toLowerCase()
  const value = hash(lower)
  return `${ADJECTIVES[value % ADJECTIVES.length]} ${NOUNS[(value >>> 8) % NOUNS.length]}·${lower.slice(-4)}`
}

/**
 * Only plain names are shown (letters, digits, `-`, `_`, up to 24 characters). Anything else, including
 * look-alike Unicode, falls back to the nickname, so nobody can dress up as someone else on the big screen.
 */
export function cleanNadName(raw: unknown) {
  if (typeof raw !== 'string') return undefined
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/\.nad$/, '')
  return /^[a-z0-9_-]{1,24}$/.test(name) ? `${name}.nad` : undefined
}

type Entry = { name?: string; at: number }
const cache = new Map<string, Entry>()
const queued = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
let timer: ReturnType<typeof setTimeout> | undefined

function emit() {
  version += 1
  for (const listener of listeners) listener()
}

function lookupsEnabled() {
  return config.chainId === 143 && !config.demo
}

async function flush() {
  timer = undefined
  const batch = [...queued].slice(0, BATCH_MAX)
  for (const address of batch) queued.delete(address)
  if (queued.size) timer = setTimeout(() => void flush(), BATCH_WAIT_MS)
  if (!batch.length) return
  const now = Date.now()
  try {
    const rows = (await readMany(
      batch.map((address) => ({
        address: NNS_MAINNET,
        abi: NNS_ABI,
        functionName: 'getPrimaryNameForAddress',
        args: [address as Address],
      })),
      { allowFailure: true },
    )) as { status: string; result?: unknown }[]
    batch.forEach((address, index) => {
      const row = rows[index]
      cache.set(address, { name: row?.status === 'success' ? cleanNadName(row.result) : undefined, at: now })
    })
  } catch {
    for (const address of batch) cache.set(address, { at: now })
  }
  emit()
}

function request(address: string) {
  if (!lookupsEnabled()) return
  const entry = cache.get(address)
  if (entry && Date.now() - entry.at < (entry.name ? NAME_TTL_MS : MISS_TTL_MS)) return
  if (queued.has(address)) return
  queued.add(address)
  timer ??= setTimeout(() => void flush(), BATCH_WAIT_MS)
}

/** `dreiki.nad` when known, otherwise the address's fixed nickname. Starts a background lookup if needed. */
export function painterName(address?: string | null) {
  if (!address || !ADDRESS.test(address)) return address ?? '—'
  const lower = address.toLowerCase()
  request(lower)
  return cache.get(lower)?.name ?? nicknameFor(lower)
}

/** The wallet's `.nad` name; `null` once looked up and it has none; `undefined` while not known yet. */
export function nadNameOf(address?: string | null): string | null | undefined {
  if (!address || !ADDRESS.test(address)) return undefined
  const lower = address.toLowerCase()
  request(lower)
  const entry = cache.get(lower)
  return entry ? (entry.name ?? null) : undefined
}

/** Whether `.nad` names can be looked up here (Monad mainnet only). */
export function nadNamesAvailable() {
  return lookupsEnabled()
}

export function subscribePainterNames(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-render this component when any name arrives. Call once per component, then use painterName(). */
export function usePainterNames() {
  return useSyncExternalStore(
    subscribePainterNames,
    () => version,
    () => version,
  )
}

export function __resetPainterNamesForTests() {
  cache.clear()
  queued.clear()
  if (timer) clearTimeout(timer)
  timer = undefined
  version = 0
}

export function __setPainterNameForTests(address: string, name: string | undefined) {
  cache.set(address.toLowerCase(), { name, at: Date.now() })
  emit()
}
