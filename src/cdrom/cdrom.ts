import { hexToBytes, parseAbiItem, type Address, type Hex } from 'viem'
import { publicClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { getLogsWindow } from '../chain/logs'
import { readHeavy, readMany } from '../chain/readMany'
import { getFrameInfoBatch, type FrameInfo } from '../frames/framesStore'
import { labsAddress, loadOwnedLabsSources, scanOwnedLabs } from '../frames/labsStore'
import { readLabsToken, type LabsTokenData } from '../labs/labsToken'
import { R3TARDS_CD_BURNER_ABI, R3TARDS_LABS_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { safeRouteInt } from '../lib/route'

/**
 * CD-ROM (D:). A burned CD is an immutable onchain snapshot (R3tardsCDBurner, SSTORE2-style FrameStore):
 * header, label, then one 38-byte record per track holding the source frame id. The pixels of every
 * track stay in the Paint core forever (burning a frame removes its owner, not its frame data), so any
 * viewer can read the original tracks; ownership is only needed for the wallet's Insert disc convenience.
 */

// Layout constants mirror R3tardsCDBurner (snapshot = pointer runtime code minus the STOP byte).
export const LEGACY_SNAPSHOT_VERSION = 2
export const SNAPSHOT_VERSION = 3
export const HEADER_SIZE = 80
export const TRACK_SIZE = 38
export const LABEL_OFFSET = 50
export const DISC_MASK_OFFSET = 48
export const FRAME_COUNT_OFFSET = 74
export const PHOTO_COUNT_OFFSET = 75
export const MAX_TRACKS = 12
export const BLOCK_PHOTO_FLAG = 4

/** A 256×256, 4-bit BMP: 14 file header + 40 info header + 16×4 palette + 128 bytes × 256 rows. */
export const TRACK_BMP_BYTES = 14 + 40 + 16 * 4 + 128 * 256

export type CdTrackKind = 'frame' | 'block-photo'

export interface CdTrack {
  index: number
  sourceId: number
  kind: CdTrackKind
  season: number
  storm: boolean
  finale: boolean
  colourPair: number
}

export interface CdSnapshot {
  version: number
  label: string
  trackCount: number
  dominantColour: number
  coloursUsed: number
  seasonCount: number
  stormTracks: number
  hasFinale: boolean
  oldestTrack: number
  minSeason: number
  maxSeason: number
  discMask: number
  frameTracks: number
  photoTracks: number
  tracks: CdTrack[]
}

function readUint(bytes: Uint8Array, offset: number, length: number) {
  let value = 0n
  for (let i = 0; i < length; i++) value = (value << 8n) | BigInt(bytes[offset + i])
  return value
}

/** Parse the snapshot bytes (pointer code without its leading STOP byte). Throws on anything malformed. */
export function parseCdSnapshot(snapshot: Uint8Array): CdSnapshot {
  if (snapshot.length < HEADER_SIZE) throw new Error('CD snapshot too short')
  const version = snapshot[0]
  if (version !== LEGACY_SNAPSHOT_VERSION && version !== SNAPSHOT_VERSION)
    throw new Error(`unknown CD snapshot version ${version}`)
  const trackCount = snapshot[1]
  if (trackCount === 0 || trackCount > MAX_TRACKS) throw new Error(`invalid track count ${trackCount}`)
  if (snapshot.length !== HEADER_SIZE + trackCount * TRACK_SIZE)
    throw new Error('CD snapshot length mismatch')
  const labelLength = snapshot[2]
  if (LABEL_OFFSET + labelLength > HEADER_SIZE) throw new Error('CD label overflows header')
  const label = new TextDecoder().decode(snapshot.slice(LABEL_OFFSET, LABEL_OFFSET + labelLength))
  const tracks: CdTrack[] = []
  for (let index = 0; index < trackCount; index++) {
    const record = HEADER_SIZE + index * TRACK_SIZE
    const flags = snapshot[record + 36]
    tracks.push({
      index,
      sourceId: Number(readUint(snapshot, record, 32)),
      kind: version >= SNAPSHOT_VERSION && (flags & BLOCK_PHOTO_FLAG) !== 0 ? 'block-photo' : 'frame',
      season: Number(readUint(snapshot, record + 32, 4)),
      storm: (flags & 1) !== 0,
      finale: (flags & 2) !== 0,
      colourPair: snapshot[record + 37],
    })
  }
  const frameTracks = version >= SNAPSHOT_VERSION ? snapshot[FRAME_COUNT_OFFSET] : trackCount
  const photoTracks = version >= SNAPSHOT_VERSION ? snapshot[PHOTO_COUNT_OFFSET] : 0
  if (frameTracks + photoTracks !== trackCount) throw new Error('CD mixed-track counts mismatch')
  if (tracks.filter((track) => track.kind === 'frame').length !== frameTracks) throw new Error('CD frame count mismatch')
  if (tracks.filter((track) => track.kind === 'block-photo').length !== photoTracks)
    throw new Error('CD photo count mismatch')
  return {
    version,
    label,
    trackCount,
    dominantColour: snapshot[3],
    coloursUsed: snapshot[4],
    seasonCount: snapshot[5],
    stormTracks: snapshot[6],
    hasFinale: snapshot[7] === 1,
    oldestTrack: Number(readUint(snapshot, 8, 32)),
    minSeason: Number(readUint(snapshot, 40, 4)),
    maxSeason: Number(readUint(snapshot, 44, 4)),
    discMask: Number(readUint(snapshot, DISC_MASK_OFFSET, 2)),
    frameTracks,
    photoTracks,
    tracks,
  }
}

/** `0x00 ‖ snapshot` runtime code → snapshot bytes. */
export function snapshotFromCode(code: Hex | Uint8Array) {
  const bytes = typeof code === 'string' ? hexToBytes(code) : code
  if (bytes.length <= 1 || bytes[0] !== 0) throw new Error('not a CD snapshot pointer')
  return bytes.slice(1)
}

export function trackFileName(index: number, kind: CdTrackKind = 'frame') {
  const number = String(index + 1).padStart(2, '0')
  return kind === 'block-photo' ? `PHOTO${number}.SVG` : `TRACK${number}.BMP`
}

/** `#/cdrom?cd=5` opens any real burned CD read-only, without requiring a wallet or ownership. */
export function cdromIdFromHash(hash: string) {
  if (hash !== '#/cdrom' && !hash.startsWith('#/cdrom?')) return undefined
  const id = safeRouteInt(new URLSearchParams(hash.split('?')[1] ?? '').get('cd'))
  return id > 0 ? String(id) : undefined
}

export { volumeLabel } from './cdromStore'

/** Explorer "Size" column: whole KB, rounded up, with thousands separators. */
export function explorerSize(bytes: number) {
  if (bytes <= 0) return '0KB'
  return `${Math.ceil(bytes / 1024).toLocaleString('en-US')}KB`
}

/** Status-bar total, one decimal like Explorer (e.g. 96.4KB). */
export function explorerTotal(bytes: number) {
  const kb = bytes / 1024
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)}MB` : `${kb.toFixed(1)}KB`
}

/** Win98 short date/time: 9/30/26 6:57 PM (local time). */
export function win98Date(timestampSeconds: number | bigint, timeZone?: string) {
  const date = new Date(Number(timestampSeconds) * 1000)
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

export function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'unknown'
}

export interface TrackStatus {
  owner?: Address
  recycled: boolean
}

export interface LoadedCd {
  tokenId: bigint
  snapshot: CdSnapshot
  pointer: Address
  mintBlock?: bigint
  mintTimestamp?: number
  burner?: Address
  token?: LabsTokenData
  frames: Map<number, FrameInfo>
  frameTimestamps: Map<number, number>
  photos: Map<number, LabsTokenData>
}

export function cdInfoText(cd: LoadedCd, statuses: ReadonlyMap<number, TrackStatus> = new Map()) {
  const s = cd.snapshot
  const seasons = s.minSeason === s.maxSeason ? `${s.minSeason + 1}` : `${s.minSeason + 1}–${s.maxSeason + 1}`
  const format = String(cd.token?.attributes.Format ?? '')
  const lines = [
    `r3tards labs cd #${cd.tokenId}`,
    '',
    `label ......... ${s.label}`,
    `tracks ........ ${s.trackCount}${format ? ` (${format})` : ''}`,
    `seasons ....... ${seasons}`,
    `storm tracks .. ${s.stormTracks}`,
    `finale ........ ${s.hasFinale ? 'yes' : 'no'}`,
    `burned ........ ${
      cd.mintBlock != null
        ? `block ${cd.mintBlock}${cd.mintTimestamp ? ` · ${win98Date(cd.mintTimestamp)}` : ''}`
        : 'unknown'
    }`,
    `burned by ..... ${cd.burner ?? 'unknown'}`,
    `snapshot ...... ${cd.pointer}`,
    '',
    ...s.tracks.map((track) => {
      const status = track.kind === 'frame' ? statuses.get(track.sourceId) : undefined
      const flags = [
        track.storm ? 'storm' : '',
        track.finale ? 'finale' : '',
        status?.recycled ? 'recycled' : '',
      ]
        .filter(Boolean)
        .join(' ')
      const source = track.kind === 'frame' ? `frame #${track.sourceId}` : `block photo #${track.sourceId}`
      return `${trackFileName(track.index, track.kind)}  ${source}  season ${track.season + 1}${flags ? `  ${flags}` : ''}`
    }),
    '',
    s.photoTracks
      ? 'paint tracks read from the Paint core; block photos read from their immutable Labs source.'
      : 'every track is read from the Paint contract, where frame pixels stay forever.',
  ]
  return lines.join('\r\n')
}

// ---------------------------------------------------------------------------
// Chain reads (all cached: a CD snapshot and a frame are immutable)
// ---------------------------------------------------------------------------

const CD_BURNED = parseAbiItem(
  'event CDBurned(address indexed owner, uint256 indexed tokenId, uint8 tracks, string label)',
)

const cdMemory = new Map<string, Promise<LoadedCd>>()
const blockTimeMemory = new Map<string, Promise<number | undefined>>()

async function blockTimestamp(blockNumber: bigint) {
  const key = blockNumber.toString()
  let cached = blockTimeMemory.get(key)
  if (!cached) {
    const client = publicClient
    cached = client
      ? client
          .getBlock({ blockNumber })
          .then((block) => Number(block.timestamp))
          .catch(() => {
            blockTimeMemory.delete(key)
            return undefined
          })
      : Promise.resolve(undefined)
    blockTimeMemory.set(key, cached)
  }
  return cached
}

export async function cdBurnerAddress() {
  return (await discoverContracts()).labs['cd-burner']
}

/** The CDs (Labs tokens minted by the CD Burner) that `owner` holds right now. */
export async function loadOwnedCds(owner: Address, force = false) {
  const burner = await cdBurnerAddress()
  if (!burner) return []
  const labs = await labsAddress()
  const [owned, sources] = await Promise.all([
    scanOwnedLabs(labs, owner, force),
    loadOwnedLabsSources(labs, owner, force),
  ])
  return owned.filter((id) => sources.get(id.toString())?.toLowerCase() === burner.toLowerCase())
}

async function loadCdUncached(tokenId: bigint): Promise<LoadedCd> {
  const client = publicClient
  if (!client) throw new Error('DEMO_MODE')
  const burner = await cdBurnerAddress()
  if (!burner) throw new Error('Burn a CD is not deployed on this network')
  const labs = await labsAddress()
  const [pointerRow, mintRow] = await readMany(
    [
      { address: burner, abi: R3TARDS_CD_BURNER_ABI, functionName: 'snapshotPointer', args: [tokenId] },
      { address: labs, abi: R3TARDS_LABS_ABI, functionName: 'mintData', args: [tokenId] },
    ],
    { allowFailure: true },
  )
  const pointer =
    (pointerRow as any)?.status === 'success' ? ((pointerRow as any).result as Address) : undefined
  if (!pointer || /^0x0+$/.test(pointer)) throw new Error(`CD #${tokenId} has no snapshot`)
  const code = await client.getCode({ address: pointer })
  if (!code || code === '0x') throw new Error(`CD #${tokenId} snapshot is empty`)
  const snapshot = parseCdSnapshot(snapshotFromCode(code))

  const mint = (mintRow as any)?.status === 'success' ? (mintRow as any).result : undefined
  const mintBlock = mint ? BigInt(mint.blockNumber ?? mint[2] ?? 0) : undefined

  const frameIds = snapshot.tracks.filter((track) => track.kind === 'frame').map((track) => track.sourceId)
  const photoIds = snapshot.tracks.filter((track) => track.kind === 'block-photo').map((track) => track.sourceId)
  const [frames, photoRows, token, mintTimestamp, burnerAddress] = await Promise.all([
    getFrameInfoBatch(frameIds),
    Promise.all(photoIds.map((id) => readLabsToken(BigInt(id)).catch(() => undefined))),
    readLabsToken(tokenId).catch(() => undefined),
    mintBlock ? blockTimestamp(mintBlock) : Promise.resolve(undefined),
    // The burner is the CDBurned emitter at the mint block: one bounded single-block log query.
    mintBlock
      ? getLogsWindow({
          address: burner,
          event: CD_BURNED,
          args: { tokenId },
          fromBlock: mintBlock,
          toBlock: mintBlock,
        })
          .then((logs) => (logs[0]?.args?.owner as Address | undefined) ?? undefined)
          .catch(() => undefined)
      : Promise.resolve(undefined),
  ])

  const photos = new Map<number, LabsTokenData>()
  photoIds.forEach((id, index) => {
    const data = photoRows[index]
    if (data) photos.set(id, data)
  })

  const frameTimestamps = new Map<number, number>()
  const times = await readHeavy(
    frameIds.map((id) => ({
      run: async () => {
        const info = frames.get(id)
        return info ? blockTimestamp(info.blockNumber) : undefined
      },
    })),
  )
  frameIds.forEach((id, index) => {
    const row = times[index] as any
    if (row?.status === 'success' && typeof row.result === 'number') frameTimestamps.set(id, row.result)
  })

  return {
    tokenId,
    snapshot,
    pointer,
    mintBlock,
    mintTimestamp,
    burner: burnerAddress,
    token,
    frames,
    frameTimestamps,
    photos,
  }
}

export function loadCd(tokenId: bigint) {
  const key = tokenId.toString()
  let cached = cdMemory.get(key)
  if (!cached) {
    cached = loadCdUncached(tokenId).catch((error) => {
      cdMemory.delete(key)
      throw error
    })
    cdMemory.set(key, cached)
  }
  return cached
}

export interface CdSummary {
  tokenId: bigint
  label: string
  trackCount: number
}

const summaryMemory = new Map<string, Promise<CdSummary>>()

/** Label + track count only (snapshot pointer + one getCode): what the Insert dialog needs. */
export function loadCdSummary(tokenId: bigint) {
  const key = tokenId.toString()
  const full = cdMemory.get(key)
  if (full)
    return full.then((cd) => ({ tokenId, label: cd.snapshot.label, trackCount: cd.snapshot.trackCount }))
  let cached = summaryMemory.get(key)
  if (!cached) {
    cached = (async () => {
      const client = publicClient
      const burner = await cdBurnerAddress()
      if (!client || !burner) throw new Error('DEMO_MODE')
      const pointer = (await client.readContract({
        address: burner,
        abi: R3TARDS_CD_BURNER_ABI,
        functionName: 'snapshotPointer',
        args: [tokenId],
      })) as Address
      const code = await client.getCode({ address: pointer })
      if (!code || code === '0x') throw new Error(`CD #${tokenId} snapshot is empty`)
      const snapshot = parseCdSnapshot(snapshotFromCode(code))
      return { tokenId, label: snapshot.label, trackCount: snapshot.trackCount }
    })().catch((error) => {
      summaryMemory.delete(key)
      throw error
    })
    summaryMemory.set(key, cached)
  }
  return cached
}

/** Where each source frame is now: its owner, or recycled (burned) — the art stays readable either way. */
export async function trackStatuses(frameIds: readonly number[]) {
  const paint = (await discoverContracts()).paint
  const out = new Map<number, TrackStatus>()
  if (!paint || !frameIds.length) return out
  const rows = await readMany(
    frameIds.map((id) => ({
      address: paint,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'ownerOf',
      args: [BigInt(id)],
    })),
    { allowFailure: true },
  )
  frameIds.forEach((id, index) => {
    const row = rows[index] as any
    out.set(
      id,
      row?.status === 'success' ? { owner: row.result as Address, recycled: false } : { recycled: true },
    )
  })
  return out
}

/** Labs ownerOf for the inserted disc (to eject it if it left the wallet). */
export async function cdOwner(tokenId: bigint) {
  const client = publicClient
  if (!client) return undefined
  const labs = await labsAddress()
  return (await client
    .readContract({ address: labs, abi: R3TARDS_LABS_ABI, functionName: 'ownerOf', args: [tokenId] })
    .catch(() => undefined)) as Address | undefined
}

export function __resetCdromCacheForTests() {
  cdMemory.clear()
  summaryMemory.clear()
  blockTimeMemory.clear()
}
