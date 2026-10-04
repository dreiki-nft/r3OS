import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  bytesToHex,
  encodeAbiParameters,
  hexToBytes,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem'
import { publicClient } from './clients'
import { config } from './config'
import { readMany } from './readMany'
import { useRefreshTick } from './refreshTick'
import { getWalletSnapshot, subscribeWallet } from './wallet'
import { R3OS_CARD_MEMORY_ABI } from '../lib/generated/abi'
import { labAddress, sameAddress } from '../labs/labCommon'
import type { HardwareSource } from './monadHardware'

export const OFFICIAL_MONAD_CARD = '0x0000CA12D5c07085022eBC74867157449919Fd67' as Address
export const CARD_PAGE_WORDS = 128
export const CARD_PAGE_BYTES = 4096
export const CARD_FORMAT_VERSION = 1

export const MONAD_CARD_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function locked(uint256 tokenId) view returns (bool)',
  'function claim() returns (uint256)',
])

export type MonadCardStatus = 'no-wallet' | 'no-driver' | 'empty' | 'unknown-id' | 'present'

export interface CardInfo {
  owner: Address
  exists: boolean
  pageBaseSlot: bigint
  pageIndex: bigint
  formatted: boolean
  version: number
  writes: number
  firstWriteBlock: bigint
  lastWriteBlock: bigint
}

export interface MonadCardSnapshot {
  loading: boolean
  status: MonadCardStatus
  driverAddress?: Address
  cardAddress?: Address
  balance: bigint
  cardId?: bigint
  cardInfo?: CardInfo
  name?: string
  symbol?: string
  codeBytes?: number
  driverVersion?: bigint
  erc5192?: boolean
  locked?: boolean
  source: {
    contract: HardwareSource
    code: HardwareSource
    driver: HardwareSource
    soulbound: HardwareSource
    manufacturer: HardwareSource
  }
}

const EMPTY: MonadCardSnapshot = {
  loading: true,
  status: 'no-wallet',
  balance: 0n,
  source: {
    contract: 'unknown',
    code: 'unknown',
    driver: 'unknown',
    soulbound: 'unknown',
    manufacturer: 'unknown',
  },
}

const PAGE_MASK = ((1n << 256n) - 1n) ^ 127n
const PAGE_PARAMS = parseAbiParameters('string,uint256')
// Historical protocol salt. This derives the Monad Card MIP-8 page and must not
// change when the product brand changes.
const CARD_NAMESPACE = 'r3tards.card.drv.v1'
const ERC5192 = '0xb45a3c0e' as Hex

let manualVersion = 0
const manualListeners = new Set<() => void>()

let driverStaticCache = new Map<Address, Promise<{ cardAddress?: Address; driverVersion?: bigint }>>()

async function readDriverStatic(driverAddress: Address) {
  let cached = driverStaticCache.get(driverAddress)
  if (!cached) {
    cached = readMany(
      [
        { address: driverAddress, abi: R3OS_CARD_MEMORY_ABI, functionName: 'MONAD_CARD' },
        { address: driverAddress, abi: R3OS_CARD_MEMORY_ABI, functionName: 'FORMAT_VERSION' },
      ],
      { allowFailure: true },
    )
      .then((rows) => {
        const cardRow = rows[0] as any
        const versionRow = rows[1] as any
        return {
          cardAddress:
            cardRow?.status === 'success' && isAddress(String(cardRow.result))
              ? (cardRow.result as Address)
              : undefined,
          driverVersion: versionRow?.status === 'success' ? BigInt(versionRow.result) : undefined,
        }
      })
      .catch(() => {
        driverStaticCache.delete(driverAddress)
        return {}
      })
    driverStaticCache.set(driverAddress, cached)
  }
  return cached
}

export function notifyMonadCardChanged() {
  manualVersion += 1
  for (const listener of manualListeners) listener()
}

function subscribeManual(listener: () => void) {
  manualListeners.add(listener)
  return () => manualListeners.delete(listener)
}

function manualSnapshot() {
  return manualVersion
}

export function isOfficialCard(chainId: number, address?: Address) {
  return chainId === 143 && sameAddress(address, OFFICIAL_MONAD_CARD)
}

export function cardPropertySources(input: {
  official: boolean
  erc5192?: boolean
  locked?: boolean
  codeBytes?: number
  driverVersion?: bigint
}) {
  return {
    manufacturer: input.official ? ('spec' as const) : ('unknown' as const),
    soulbound:
      input.erc5192 === true && input.locked != null
        ? ('onchain' as const)
        : input.official
          ? ('spec' as const)
          : ('unknown' as const),
    code: input.codeBytes == null ? ('unknown' as const) : ('measured' as const),
    driver: input.driverVersion == null ? ('unknown' as const) : ('onchain' as const),
  }
}

export function cardPageBaseSlot(cardId: bigint) {
  const digest = BigInt(keccak256(encodeAbiParameters(PAGE_PARAMS, [CARD_NAMESPACE, cardId])))
  return digest & PAGE_MASK
}

export interface DecodedCardHeader {
  formatted: boolean
  magic: string
  version: number
  writes: number
  firstWriteBlock: bigint
  lastWriteBlock: bigint
}

export function decodeHeader(word: Hex): DecodedCardHeader {
  const value = BigInt(word)
  if (value === 0n) {
    return { formatted: false, magic: '', version: 0, writes: 0, firstWriteBlock: 0n, lastWriteBlock: 0n }
  }
  const magicNumber = Number((value >> 224n) & 0xffffffffn)
  const magic = String.fromCharCode(
    (magicNumber >>> 24) & 0xff,
    (magicNumber >>> 16) & 0xff,
    (magicNumber >>> 8) & 0xff,
    magicNumber & 0xff,
  )
  return {
    formatted: magicNumber === 0x43415244,
    magic,
    version: Number((value >> 216n) & 0xffn),
    writes: Number((value >> 176n) & 0xffffffffn),
    firstWriteBlock: (value >> 128n) & ((1n << 48n) - 1n),
    lastWriteBlock: (value >> 80n) & ((1n << 48n) - 1n),
  }
}

export function encodeAscii(text: string, maxBytes: number, wordCount: number) {
  const bytes = new Uint8Array(wordCount * 32)
  const chars = [...text]
  if (chars.length > maxBytes) throw new Error(`text is limited to ${maxBytes} ASCII characters`)
  chars.forEach((char, index) => {
    const code = char.charCodeAt(0)
    if (code < 0x20 || code > 0x7e) throw new Error('printable ASCII only')
    bytes[index] = code
  })
  return Array.from({ length: wordCount }, (_, index) =>
    bytesToHex(bytes.slice(index * 32, index * 32 + 32)),
  ) as Hex[]
}

export function decodeAscii(words: readonly Hex[], maxBytes: number) {
  const bytes = new Uint8Array(words.length * 32)
  words.forEach((word, index) => bytes.set(hexToBytes(word), index * 32))
  const out: string[] = []
  for (const value of bytes.slice(0, maxBytes)) {
    if (value === 0) break
    out.push(value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '·')
  }
  return out.join('')
}

export function packCardIcon(pixels: Uint8Array) {
  if (pixels.length !== 1024) throw new Error('card icon must be 32×32')
  const bytes = new Uint8Array(512)
  for (let i = 0; i < bytes.length; i++) bytes[i] = ((pixels[i * 2] & 15) << 4) | (pixels[i * 2 + 1] & 15)
  return Array.from({ length: 16 }, (_, index) =>
    bytesToHex(bytes.slice(index * 32, index * 32 + 32)),
  ) as Hex[]
}

export function unpackCardIcon(words: readonly Hex[]) {
  const bytes = new Uint8Array(512)
  words.slice(0, 16).forEach((word, index) => bytes.set(hexToBytes(word), index * 32))
  const pixels = new Uint8Array(1024)
  for (let i = 0; i < bytes.length; i++) {
    pixels[i * 2] = bytes[i] >> 4
    pixels[i * 2 + 1] = bytes[i] & 15
  }
  return pixels
}

export function usedBytes(words: readonly Hex[]) {
  return words.slice(0, CARD_PAGE_WORDS).filter((word) => BigInt(word) !== 0n).length * 32
}

export type CardRegion = 'HEADER' | 'LABEL' | 'ICON' | 'MESSAGE' | 'FLAGS' | 'RESERVED' | 'CARD BUS' | 'USER'

export function regionOf(byteOffset: number): CardRegion {
  if (byteOffset < 0x20) return 'HEADER'
  if (byteOffset < 0x40) return 'LABEL'
  if (byteOffset < 0x240) return 'ICON'
  if (byteOffset < 0x2c0) return 'MESSAGE'
  if (byteOffset < 0x2e0) return 'FLAGS'
  if (byteOffset < 0x300) return 'RESERVED'
  if (byteOffset < 0x380) return 'CARD BUS'
  if (byteOffset < 0x400) return 'RESERVED'
  return 'USER'
}

export function nonStandardReserved(words: readonly Hex[]) {
  const indexes: number[] = []
  for (const index of [23, 24, 25, 26, 27, 28, 29, 30, 31]) {
    if (BigInt(words[index] ?? '0x0') !== 0n) indexes.push(index)
  }
  return indexes
}

export function changedCardWordRange(before: readonly Hex[], after: readonly Hex[]) {
  let first = -1
  let last = -1
  for (let index = 1; index < CARD_PAGE_WORDS; index++) {
    if ((before[index] ?? '0x') === (after[index] ?? '0x')) continue
    if (first < 0) first = index
    last = index
  }
  if (first < 0) return undefined
  return { offset: first, words: after.slice(first, last + 1) as Hex[] }
}

export function rememberedCardKey(chainId: number, owner: Address) {
  return `r3os.card.${chainId}.${owner.toLowerCase()}`
}

export function rememberCardId(chainId: number, owner: Address, cardId: bigint) {
  try {
    localStorage.setItem(rememberedCardKey(chainId, owner), cardId.toString())
  } catch {
    // Convenience only. Discovery still works through cardOf or manual entry.
  }
  notifyMonadCardChanged()
}

export function loadRememberedCardId(chainId: number, owner: Address) {
  try {
    const raw = localStorage.getItem(rememberedCardKey(chainId, owner))
    return raw == null ? undefined : BigInt(raw)
  } catch {
    return undefined
  }
}

export function resolveCardDiscovery(input: {
  indexedFound: boolean
  indexedId?: bigint
  indexedOwner?: Address
  rememberedId?: bigint
  rememberedOwner?: Address
  wallet: Address
  balance: bigint
}) {
  if (input.indexedFound && input.indexedId != null && sameAddress(input.indexedOwner, input.wallet)) {
    return { status: 'present' as const, cardId: input.indexedId, source: 'index' as const }
  }
  if (input.rememberedId != null && sameAddress(input.rememberedOwner, input.wallet)) {
    return { status: 'present' as const, cardId: input.rememberedId, source: 'remembered' as const }
  }
  return input.balance > 0n
    ? { status: 'unknown-id' as const, source: 'balance' as const }
    : { status: 'empty' as const, source: 'balance' as const }
}

function normalizeCardInfo(value: any): CardInfo {
  const row = value as any
  return {
    owner: (row.owner ?? row[0]) as Address,
    exists: Boolean(row.exists ?? row[1]),
    pageBaseSlot: BigInt(row.pageBaseSlot ?? row[2]),
    pageIndex: BigInt(row.pageIndex ?? row[3]),
    formatted: Boolean(row.formatted ?? row[4]),
    version: Number(row.version ?? row[5]),
    writes: Number(row.writes ?? row[6]),
    firstWriteBlock: BigInt(row.firstWriteBlock ?? row[7]),
    lastWriteBlock: BigInt(row.lastWriteBlock ?? row[8]),
  }
}

async function safeOwnerOf(cardAddress: Address, cardId: bigint) {
  if (!publicClient) return undefined
  try {
    const owner = (await publicClient.readContract({
      address: cardAddress,
      abi: MONAD_CARD_ABI,
      functionName: 'ownerOf',
      args: [cardId],
    })) as Address
    return isAddress(owner) && owner !== '0x0000000000000000000000000000000000000000' ? owner : undefined
  } catch {
    return undefined
  }
}

const metadataCache = new Map<string, Promise<Awaited<ReturnType<typeof probeCardMetadataUncached>>>>()

/** name/symbol/ERC-5192/code/locked are static for a soulbound card: read once per (card contract, id). */
function probeCardMetadata(cardAddress: Address, cardId?: bigint) {
  const key = `${config.chainId}:${cardAddress.toLowerCase()}:${cardId?.toString() ?? ''}`
  let cached = metadataCache.get(key)
  if (!cached) {
    cached = probeCardMetadataUncached(cardAddress, cardId).catch((error) => {
      metadataCache.delete(key)
      throw error
    })
    metadataCache.set(key, cached)
  }
  return cached
}

async function probeCardMetadataUncached(cardAddress: Address, cardId?: bigint) {
  if (!publicClient) return {}
  const calls = [
    { address: cardAddress, abi: MONAD_CARD_ABI, functionName: 'name' },
    { address: cardAddress, abi: MONAD_CARD_ABI, functionName: 'symbol' },
    { address: cardAddress, abi: MONAD_CARD_ABI, functionName: 'supportsInterface', args: [ERC5192] },
  ]
  const rows = await readMany(calls, { allowFailure: true }).catch(() => [])
  const name = (rows[0] as any)?.status === 'success' ? String((rows[0] as any).result) : undefined
  const symbol = (rows[1] as any)?.status === 'success' ? String((rows[1] as any).result) : undefined
  const erc5192 = (rows[2] as any)?.status === 'success' ? Boolean((rows[2] as any).result) : undefined
  let locked: boolean | undefined
  if (erc5192 && cardId != null) {
    const lockRows = await readMany(
      [{ address: cardAddress, abi: MONAD_CARD_ABI, functionName: 'locked', args: [cardId] }],
      { allowFailure: true },
    ).catch(() => [])
    const row = lockRows[0] as any
    if (row?.status === 'success') locked = Boolean(row.result)
  }
  const code = await publicClient.getCode({ address: cardAddress }).catch(() => undefined)
  const codeBytes = code && code !== '0x' ? (code.length - 2) / 2 : code === '0x' ? 0 : undefined
  return { name, symbol, erc5192, locked, codeBytes }
}

export async function readMonadCard(account?: Address): Promise<MonadCardSnapshot> {
  if (!account) return { ...EMPTY, loading: false, status: 'no-wallet' }
  if (!publicClient) return { ...EMPTY, loading: false, status: 'no-driver' }

  let driverAddress: Address | undefined
  try {
    driverAddress = await labAddress('card-drv')
  } catch {
    driverAddress = undefined
  }

  let cardAddress: Address | undefined
  let driverVersion: bigint | undefined
  let indexedFound = false
  let indexedId: bigint | undefined
  if (driverAddress) {
    const staticDriver = await readDriverStatic(driverAddress)
    cardAddress = staticDriver.cardAddress
    driverVersion = staticDriver.driverVersion
    const rows = await readMany(
      [{ address: driverAddress, abi: R3OS_CARD_MEMORY_ABI, functionName: 'cardOf', args: [account] }],
      { allowFailure: true },
    ).catch(() => [])
    const indexRow = rows[0] as any
    if (indexRow?.status === 'success') {
      const value = indexRow.result as readonly [boolean, bigint]
      indexedFound = Boolean(value[0])
      indexedId = BigInt(value[1])
    }
  } else if (config.chainId === 143) {
    cardAddress = OFFICIAL_MONAD_CARD
  }

  if (!cardAddress) {
    return {
      ...EMPTY,
      loading: false,
      status: 'no-driver',
      driverAddress,
      source: { ...EMPTY.source, driver: driverAddress ? 'onchain' : 'absent' },
    }
  }

  const balanceRows = await readMany(
    [{ address: cardAddress, abi: MONAD_CARD_ABI, functionName: 'balanceOf', args: [account] }],
    { allowFailure: true },
  ).catch(() => [])
  const balanceRow = balanceRows[0] as any
  // A failed read is "unknown", never "no card": keep the previous snapshot instead.
  if (balanceRow?.status !== 'success') throw new Error('MONAD_CARD_BALANCE_UNAVAILABLE')
  const balance = BigInt(balanceRow.result)

  const indexedOwner =
    indexedFound && indexedId != null ? await safeOwnerOf(cardAddress, indexedId) : undefined
  const rememberedId = loadRememberedCardId(config.chainId, account)
  const rememberedOwner = rememberedId != null ? await safeOwnerOf(cardAddress, rememberedId) : undefined
  const discovery = resolveCardDiscovery({
    indexedFound,
    indexedId,
    indexedOwner,
    rememberedId,
    rememberedOwner,
    wallet: account,
    balance,
  })

  const cardId = discovery.status === 'present' ? discovery.cardId : undefined
  let cardInfo: CardInfo | undefined
  if (driverAddress && cardId != null) {
    const rows = await readMany(
      [{ address: driverAddress, abi: R3OS_CARD_MEMORY_ABI, functionName: 'cardInfo', args: [cardId] }],
      { allowFailure: true },
    ).catch(() => [])
    const row = rows[0] as any
    if (row?.status === 'success') cardInfo = normalizeCardInfo(row.result)
  }

  const meta = await probeCardMetadata(cardAddress, cardId)
  const official = isOfficialCard(config.chainId, cardAddress)
  const soulboundSource: HardwareSource =
    meta.erc5192 === true && meta.locked != null ? 'onchain' : official ? 'spec' : 'unknown'

  return {
    loading: false,
    status: driverAddress ? discovery.status : 'no-driver',
    driverAddress,
    cardAddress,
    balance,
    cardId,
    cardInfo,
    name: meta.name,
    symbol: meta.symbol,
    codeBytes: meta.codeBytes,
    driverVersion,
    erc5192: meta.erc5192,
    locked: meta.locked,
    source: {
      contract: driverAddress ? 'onchain' : official ? 'spec' : 'unknown',
      code: meta.codeBytes == null ? 'unknown' : 'measured',
      driver: driverAddress && driverVersion != null ? 'onchain' : driverAddress ? 'unknown' : 'absent',
      soulbound: soulboundSource,
      manufacturer: official ? 'spec' : 'unknown',
    },
  }
}

let sharedRead: { key: string; promise: Promise<MonadCardSnapshot> } | undefined
let lastSnapshot: { account?: Address; value: MonadCardSnapshot } | undefined

/** HardwareBus, Monad Hardware, CARDMEM, PAGE.EXE and Block Camera all share one read per refresh. */
function readMonadCardShared(account: Address | undefined, key: string) {
  if (sharedRead?.key === key) return sharedRead.promise
  const promise = readMonadCard(account).then((value) => {
    lastSnapshot = { account, value }
    return value
  })
  sharedRead = { key, promise }
  promise.catch(() => {
    if (sharedRead?.promise === promise) sharedRead = undefined
  })
  return promise
}

export function useMonadCard() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const tick = useRefreshTick(30)
  const manual = useSyncExternalStore(subscribeManual, manualSnapshot)
  const [state, setState] = useState<MonadCardSnapshot>(() =>
    lastSnapshot && lastSnapshot.account === wallet.account ? lastSnapshot.value : EMPTY,
  )

  useEffect(() => {
    let cancelled = false
    const key = `${wallet.account ?? ''}:${wallet.chainId ?? ''}:${tick}:${manual}`
    readMonadCardShared(wallet.account, key)
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch(() => {
        // keep the last known state; the next refresh tick retries
      })
    return () => {
      cancelled = true
    }
  }, [wallet.account, wallet.chainId, tick, manual])

  return state
}

export function __resetMonadCardForTests() {
  sharedRead = undefined
  lastSnapshot = undefined
  metadataCache.clear()
  driverStaticCache = new Map()
  manualVersion = 0
}
