import type { Address } from 'viem'
import { deploymentScope } from '../chain/config'

/**
 * Which disc sits in drive D:. It is a per-browser convenience (like a remembered card number):
 * localStorage per chain + wallet, wrapped in try/catch. The drive re-checks onchain ownership
 * when it opens and ejects a disc that has left the wallet.
 */
/** Win98-style volume label: upper case, printable ASCII, at most 16 characters. */
export function volumeLabel(label: string) {
  const clean = label
    .toUpperCase()
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
  return (clean || 'CD-R').slice(0, 16)
}

export interface InsertedDisc {
  tokenId: string
  label: string
}

type Listener = () => void
const listeners = new Set<Listener>()
let version = 0
/** Session fallback when localStorage is unavailable. */
const memory = new Map<string, InsertedDisc>()

function key(account: Address) {
  return `r3os:cdrom:${deploymentScope()}:${account.toLowerCase()}`
}

function emit() {
  version += 1
  for (const listener of listeners) listener()
}

export function subscribeCdrom(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCdromVersion() {
  return version
}

export function insertedDisc(account?: Address): InsertedDisc | undefined {
  if (!account) return undefined
  try {
    const raw = localStorage.getItem(key(account))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<InsertedDisc>
    if (typeof parsed.tokenId !== 'string' || !/^\d+$/.test(parsed.tokenId)) return undefined
    return { tokenId: parsed.tokenId, label: typeof parsed.label === 'string' ? parsed.label : '' }
  } catch {
    return undefined
  }
}

export function insertDisc(account: Address, disc: InsertedDisc) {
  try {
    localStorage.setItem(key(account), JSON.stringify(disc))
  } catch {
    // storage blocked: the drive still works for this session through the event below
  }
  memory.set(account.toLowerCase(), disc)
  emit()
}

export function ejectDisc(account: Address) {
  try {
    localStorage.removeItem(key(account))
  } catch {
    // ignore
  }
  memory.delete(account.toLowerCase())
  emit()
}

export function currentDisc(account?: Address) {
  if (!account) return undefined
  return insertedDisc(account) ?? memory.get(account.toLowerCase())
}

// ---------------------------------------------------------------------------
// Imaging viewer target (the track the user double-clicked in D:)
// ---------------------------------------------------------------------------

export interface ImagingTarget {
  cdId: string
  track: number
}

let imagingTarget: ImagingTarget | undefined

export function setImagingTarget(target: ImagingTarget) {
  imagingTarget = target
  emit()
}

export function getImagingTarget() {
  return imagingTarget
}
