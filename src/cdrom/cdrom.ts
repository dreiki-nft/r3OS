import { hexToBytes, parseAbiItem, type Address, type Hex } from 'viem'
import { publicClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { getLogsWindow } from '../chain/logs'
import { readHeavy, readMany } from '../chain/readMany'
import { getFrameInfoBatch, type FrameInfo } from '../frames/framesStore'
import { labsAddress, scanOwnedLabs } from '../frames/LabsFolder'
import { readLabsToken, type LabsTokenData } from '../labs/labsToken'
import { R3TARDS_CD_BURNER_ABI, R3TARDS_LABS_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'

/**
 * CD-ROM (D:). A burned CD is an immutable onchain snapshot (R3tardsCDBurner, SSTORE2-style FrameStore):
 * header, label, then one 38-byte record per track holding the source frame id. The pixels of every
 * track stay in the Paint core forever (burning a frame removes its owner, not its frame data), so any
 * holder of the CD can read the original tracks.
 */

// Layout constants mirror R3tardsCDBurner (snapshot = pointer runtime code minus the STOP byte).
export const SNAPSHOT_VERSION = 2
export const HEADER_SIZE = 80
export const TRACK_SIZE = 38
export const LABEL_OFFSET = 50
export const DISC_MASK_OFFSET = 48
export const MAX_TRACKS = 12

/** A 256×256, 4-bit BMP: 14 file header + 40 info header + 16×4 palette + 128 bytes × 256 rows. */
export const TRACK_BMP_BYTES = 14 + 40 + 16 * 4 + 128 * 256

export interface CdTrack {
  index: number
  frameId: number
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
  if (version !== SNAPSHOT_VERSION) throw new Error(`unknown CD snapshot version ${version}`)
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
      frameId: Number(readUint(snapshot, record, 32)),
      season: Number(readUint(snapshot, record + 32, 4)),
      storm: (flags & 1) !== 0,
      finale: (flags & 2) !== 0,
      colourPair: snapshot[record + 37],
    })
  }
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
    tracks,
  }
}

/** `0x00 ‖ snapshot` runtime code → snapshot bytes. */
export function snapshotFromCode(code: Hex | Uint8Array) {
  const bytes = typeof code === 'string' ? hexToBytes(code) : code
  if (bytes.length <= 1 || bytes[0] !== 0) throw new Error('not a CD snapshot pointer')
  return bytes.slice(1)
}

export function trackFileName(index: number) {
  return `TRACK${String(index + 1).padStart(2, '0')}.BMP`
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
      const status = statuses.get(track.frameId)
      const flags = [
        track.storm ? 'storm' : '',
        track.finale ? 'finale' : '',
        status?.recycled ? 'recycled' : '',
      ]
        .filter(Boolean)
        .join(' ')
      return `${trackFileName(track.index)}  frame #${track.frameId}  season ${track.season + 1}${flags ? `  ${flags}` : ''}`
    }),
    '',
    'every track is read from the Paint contract, where frame pixels stay forever.',
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
export async function loadOwnedCds(owner: Address) {
  const burner = await cdBurnerAddress()
  if (!burner) return []
  const labs = await labsAddress()
  const owned = await scanOwnedLabs(labs, owner)
  if (!owned.length) return []
  const sources = await readMany(
    owned.map((id) => ({ address: labs, abi: R3TARDS_LABS_ABI, functionName: 'sourceOf', args: [id] })),
    { allowFailure: true },
  )
  return owned.filter((_, index) => {
    const row = sources[index] as any
    return row?.status === 'success' && String(row.result).toLowerCase() === burner.toLowerCase()
  })
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

  const frameIds = snapshot.tracks.map((track) => track.frameId)
  const [frames, token, mintTimestamp, burnerAddress] = await Promise.all([
    getFrameInfoBatch(frameIds),
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
