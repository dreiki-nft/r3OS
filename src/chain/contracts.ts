import { type Address, zeroAddress } from 'viem'
import { publicClient } from './clients'
import { config } from './config'
import { readMany } from './readMany'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import { getBootPacketSnapshot } from './bootPacket'

export interface ContractAddresses {
  paint?: Address
  pass?: Address
  r3tards?: Address
  experimentCount?: number
  labs: Record<string, Address | undefined>
}

export interface CoreStatus {
  renderersFrozen: boolean
  experimentsFrozen: boolean
}

let cached: ContractAddresses | undefined
let inflight: Promise<ContractAddresses> | undefined
let constantsPromise: Promise<typeof demoConstants> | undefined
let coreStatusCache: { value?: CoreStatus; fetchedAt: number; promise?: Promise<CoreStatus> } = { fetchedAt: 0 }
const CORE_STATUS_FRESH_MS = 8_000

function bootSeedForPaint(paint: Address) {
  const seed = getBootPacketSnapshot()
  if (
    !seed ||
    Date.now() - seed.at > CORE_STATUS_FRESH_MS ||
    seed.chainId !== config.chainId ||
    seed.paintAddress?.toLowerCase() !== paint.toLowerCase()
  ) {
    return undefined
  }
  return seed
}

/**
 * The registry is read once and shared: concurrent callers (every window that needs an address) join the
 * same in-flight read instead of each re-reading every experiment. A failed read is not cached.
 */
export function getCachedContracts() {
  return cached
}

export function discoverContracts(force = false): Promise<ContractAddresses> {
  if (cached && !force) return Promise.resolve(cached)
  if (inflight && !force) return inflight
  const read = readRegistry(force).then((value) => {
    cached = value
    return value
  })
  inflight = read
  void read.then(
    () => {
      if (inflight === read) inflight = undefined
    },
    () => {
      if (inflight === read) inflight = undefined
    },
  )
  return read
}

async function readRegistry(force = false): Promise<ContractAddresses> {
  if (!publicClient || !config.paintAddress) {
    return { paint: config.paintAddress, labs: { ...config.labs } }
  }

  const paint = config.paintAddress
  const seed = force ? undefined : bootSeedForPaint(paint)
  let pass: Address
  let r3tards: Address
  let count: bigint
  if (seed?.painterPass && seed.r3tards && seed.experimentCount != null) {
    pass = seed.painterPass
    r3tards = seed.r3tards
    count = BigInt(seed.experimentCount)
  } else {
    const registry = (await readMany(
      [
        { address: paint, abi: R3OS_PAINT_ABI, functionName: 'painterPass' },
        { address: paint, abi: R3OS_PAINT_ABI, functionName: 'R3TARDS' },
        { address: paint, abi: R3OS_PAINT_ABI, functionName: 'experimentCount' },
      ],
      { allowFailure: false },
    )) as [Address, Address, bigint]
    pass = registry[0]
    r3tards = registry[1]
    count = registry[2]
  }

  const labs: Record<string, Address | undefined> = { ...config.labs }
  const infos = (await readMany(
    Array.from({ length: Number(count) }, (_, index) => ({
      address: paint,
      abi: R3OS_PAINT_ABI,
      functionName: 'experimentInfo',
      args: [BigInt(index)],
    })),
    { allowFailure: false },
  )) as { experiment: Address; name: string; retired: boolean }[]
  for (const info of infos) {
    const envOverride = config.labs[info.name as keyof typeof config.labs]
    if (!info.retired && info.experiment !== zeroAddress && !envOverride) labs[info.name] = info.experiment
  }

  return { paint, pass, r3tards, experimentCount: Number(count), labs }
}

export const demoConstants = {
  MAX_RAW_PIXELS_PER_PAINT: 65_536n,
  MAX_PIXELS_PER_REGION_PER_BLOCK: 512n,
  FRAME_COOLDOWN_BLOCKS: 200n,
  FACE_FLIP_COOLDOWN_BLOCKS: 100n,
  BACKGROUND_COOLDOWN_BLOCKS: 1_000n,
  WET_WINDOW_BLOCKS: 2_000n,
  MAX_TILE_HEAT: 512n,
  TILE_COOLDOWN_PER_BLOCK: 2n,
  STORM_PERIOD_BLOCKS: 200_000n,
  STORM_LENGTH_BLOCKS: 600n,
  HOLDER_PIXELS_PER_DAY: 512n,
  PIXELS_PER_ACTIVE_DAY: 32n,
  SEASON_START: 0n,
  SEASON_LENGTH: 30n * 24n * 60n * 60n,
} as const

export function readCoreConstants() {
  if (constantsPromise) return constantsPromise
  constantsPromise = (async () => {
    if (!publicClient || !config.paintAddress) return demoConstants
    const names = [
      'MAX_RAW_PIXELS_PER_PAINT',
      'MAX_PIXELS_PER_REGION_PER_BLOCK',
      'FRAME_COOLDOWN_BLOCKS',
      'FACE_FLIP_COOLDOWN_BLOCKS',
      'BACKGROUND_COOLDOWN_BLOCKS',
      'WET_WINDOW_BLOCKS',
      'MAX_TILE_HEAT',
      'TILE_COOLDOWN_PER_BLOCK',
      'STORM_PERIOD_BLOCKS',
      'STORM_LENGTH_BLOCKS',
      'HOLDER_PIXELS_PER_DAY',
      'PIXELS_PER_ACTIVE_DAY',
      'SEASON_START',
      'SEASON_LENGTH',
    ] as const
    const values = (await readMany(
      names.map((name) => ({
        address: config.paintAddress!,
        abi: R3OS_PAINT_ABI,
        functionName: name,
      })),
      { allowFailure: false },
    )) as bigint[]
    return Object.fromEntries(names.map((name, index) => [name, values[index]])) as typeof demoConstants
  })().catch((error) => {
    constantsPromise = undefined
    throw error
  })
  return constantsPromise
}


/** Short-lived shared status read for DXDIAG/boot. These flags may still change until the core is frozen. */
export function getCachedCoreStatus() {
  return coreStatusCache.value
}

export function readCoreStatus(force = false): Promise<CoreStatus> {
  if (!publicClient || !config.paintAddress) return Promise.reject(new Error('CORE_STATUS_UNAVAILABLE'))
  if (!force && !coreStatusCache.value) {
    const seed = bootSeedForPaint(config.paintAddress)
    if (seed?.renderersFrozen != null && seed.experimentsFrozen != null) {
      coreStatusCache = {
        value: { renderersFrozen: seed.renderersFrozen, experimentsFrozen: seed.experimentsFrozen },
        fetchedAt: seed.at,
      }
    }
  }
  if (!force && coreStatusCache.value && Date.now() - coreStatusCache.fetchedAt < CORE_STATUS_FRESH_MS) {
    return Promise.resolve(coreStatusCache.value)
  }
  if (coreStatusCache.promise) return coreStatusCache.promise

  const pending = readMany(
    [
      { address: config.paintAddress, abi: R3OS_PAINT_ABI, functionName: 'renderersFrozen' },
      { address: config.paintAddress, abi: R3OS_PAINT_ABI, functionName: 'experimentsFrozen' },
    ],
    { allowFailure: false },
  )
    .then((values) => {
      const value = {
        renderersFrozen: Boolean(values[0]),
        experimentsFrozen: Boolean(values[1]),
      }
      coreStatusCache.value = value
      coreStatusCache.fetchedAt = Date.now()
      return value
    })
    .finally(() => {
      if (coreStatusCache.promise === pending) coreStatusCache.promise = undefined
    })
  coreStatusCache.promise = pending
  return pending
}

export function seasonAtTimestamp(timestamp: bigint, constants = demoConstants) {
  if (timestamp < constants.SEASON_START) return 0n
  return (timestamp - constants.SEASON_START) / constants.SEASON_LENGTH
}
