import { type Address, zeroAddress } from 'viem'
import { publicClient } from './clients'
import { config } from './config'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'

export interface ContractAddresses {
  paint?: Address
  pass?: Address
  r3tards?: Address
  labs: Record<string, Address | undefined>
}

let cached: ContractAddresses | undefined
let constantsPromise: Promise<typeof demoConstants> | undefined

export async function discoverContracts(force = false): Promise<ContractAddresses> {
  if (cached && !force) return cached
  if (!publicClient || !config.paintAddress) {
    return { paint: config.paintAddress, labs: { ...config.labs } }
  }

  const client = publicClient
  const paint = config.paintAddress
  const [pass, r3tards, count] = await Promise.all([
    client.readContract({
      address: paint,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'painterPass',
    }) as Promise<Address>,
    client.readContract({
      address: paint,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'R3TARDS',
    }) as Promise<Address>,
    client.readContract({
      address: paint,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'experimentCount',
    }) as Promise<bigint>,
  ])

  const labs: Record<string, Address | undefined> = { ...config.labs }
  const infos = await Promise.all(
    Array.from(
      { length: Number(count) },
      (_, index) =>
        client.readContract({
          address: paint,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'experimentInfo',
          args: [BigInt(index)],
        }) as Promise<{ experiment: Address; name: string; retired: boolean }>,
    ),
  )
  for (const info of infos) {
    const envOverride = config.labs[info.name as keyof typeof config.labs]
    if (!info.retired && info.experiment !== zeroAddress && !envOverride) labs[info.name] = info.experiment
  }

  cached = { paint, pass, r3tards, labs }
  return cached
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
  HOLDER_PIXELS_PER_DAY: 256n,
  PIXELS_PER_ACTIVE_DAY: 16n,
  SEASON_START: 0n,
  SEASON_LENGTH: 30n * 24n * 60n * 60n,
} as const

export function readCoreConstants() {
  if (constantsPromise) return constantsPromise
  constantsPromise = (async () => {
    if (!publicClient || !config.paintAddress) return demoConstants
    const client = publicClient
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
    const values = await Promise.all(
      names.map(
        (name) =>
          client.readContract({
            address: config.paintAddress!,
            abi: R3TARDS_PAINT_ABI,
            functionName: name,
          }) as Promise<bigint>,
      ),
    )
    return Object.fromEntries(names.map((name, index) => [name, values[index]])) as typeof demoConstants
  })().catch((error) => {
    constantsPromise = undefined
    throw error
  })
  return constantsPromise
}

export function seasonAtTimestamp(timestamp: bigint, constants = demoConstants) {
  if (timestamp < constants.SEASON_START) return 0n
  return (timestamp - constants.SEASON_START) / constants.SEASON_LENGTH
}
