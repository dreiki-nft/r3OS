import type { Address } from 'viem'
import packageJson from '../../package.json'
import { getBlockSnapshot } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { chainName, config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { isOfficialCard } from '../chain/monadCard'
import { readMonadHardware } from '../chain/monadHardware'
import { readMany } from '../chain/readMany'
import { rpcStatsSnapshot } from '../chain/rpcStats'
import { eventState, readSystemEventNow } from '../chain/systemEvent'
import { R3TARDS_CARD_MEMORY_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import {
  driverState,
  normalizeBuildId,
  type DriverRow,
  type DxDiagInput,
  type EventState,
} from './diagnostics'

/** Registry names DXDIAG reports as drivers, in display order. */
export const DXDIAG_DRIVERS = [
  ['block-camera', 'Block Camera'],
  ['card-drv', 'CARD.DRV'],
  ['operator-record', 'Operator Record'],
  ['system-event', 'System Event'],
] as const

async function hasCode(address?: Address) {
  if (!address || !publicClient) return undefined
  const code = await settle(publicClient.getCode({ address }))
  return code === undefined ? undefined : Boolean(code && code !== '0x')
}

const READ_TIMEOUT_MS = 6_000

/** Resolves to undefined on error or after a timeout, so an offline RPC degrades to "unknown" instead of hanging. */
const settle = <T>(promise: Promise<T>, ms = READ_TIMEOUT_MS) =>
  Promise.race([
    promise.then((value) => value).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ])

/**
 * One read pass for DXDIAG. Called on open and on REFRESH only: no polling, no log scans, no wallet.
 * Session caches are reused (static hardware probe); `force` re-reads the registry.
 */
export async function loadDxDiag(
  force = false,
  onStep: (step: string) => void = () => {},
): Promise<DxDiagInput> {
  const block = getBlockSnapshot()
  onStep('reading the r3tardOS contract list…')
  const contracts = await settle(discoverContracts(force))
  const paint = contracts?.paint
  onStep('probing Monad devices and drivers…')

  const [coreRows, multicallPresent, driverCodes, hardware, event] = await Promise.all([
    paint && publicClient
      ? settle(
          readMany(
            [
              { address: paint, abi: R3TARDS_PAINT_ABI, functionName: 'experimentCount' },
              { address: paint, abi: R3TARDS_PAINT_ABI, functionName: 'renderersFrozen' },
              { address: paint, abi: R3TARDS_PAINT_ABI, functionName: 'experimentsFrozen' },
            ],
            { allowFailure: true },
          ),
        )
      : Promise.resolve(undefined),
    config.multicall3Address ? hasCode(config.multicall3Address) : Promise.resolve(undefined),
    Promise.all(DXDIAG_DRIVERS.map(([name]) => hasCode(contracts?.labs[name]))),
    settle(readMonadHardware()),
    settle(readSystemEventNow()),
  ])

  const row = (index: number) => {
    const entry = (coreRows as any[] | undefined)?.[index]
    return entry?.status === 'success' ? entry.result : undefined
  }

  const drivers: DriverRow[] = DXDIAG_DRIVERS.map(([name, label], index) => {
    const address = contracts?.labs[name]
    const state = contracts ? driverState(address, driverCodes[index]) : 'unknown'
    return { key: name, label, address, state, source: state === 'unknown' ? 'unknown' : 'onchain' }
  })

  // Card context: official address on chain 143, otherwise a mock driver target.
  const cardDriver = contracts?.labs['card-drv']
  let cardContext: DxDiagInput['card']['context'] = 'unknown'
  if (cardDriver && publicClient) {
    const cardRows = await settle(
      readMany([{ address: cardDriver, abi: R3TARDS_CARD_MEMORY_ABI, functionName: 'MONAD_CARD' }], {
        allowFailure: true,
      }),
    )
    const card = (cardRows as any[] | undefined)?.[0]
    if (card?.status === 'success')
      cardContext = isOfficialCard(config.chainId, card.result as Address) ? 'official' : 'mock'
  }

  // Without a registry read we cannot say "not installed": unknown stays unknown.
  const eventValue: EventState = event
    ? eventState(event)
    : contracts && !contracts.labs['system-event']
      ? 'no-driver'
      : 'unknown'

  return {
    appVersion: packageJson.version,
    buildId: normalizeBuildId((import.meta.env as Record<string, unknown>).VITE_BUILD_ID),
    chain: { id: config.chainId, name: chainName, client: hardware?.clientVersion.value },
    block: {
      number: block.block > 0n ? block.block : undefined,
      mode: block.mode,
      blockTimeMs: block.block > 0n ? block.blockTimeMs : undefined,
    },
    deployBlock: config.deployBlock,
    rpc: {
      httpEndpoints: config.rpcUrls.length,
      wsConfigured: Boolean(config.wsUrl),
      multicallConfigured: Boolean(config.multicall3Address),
      multicallPresent,
    },
    rpcStats: import.meta.env.DEV ? { windowSeconds: 10, counts: rpcStatsSnapshot() } : undefined,
    contracts: {
      paint: paint ?? config.paintAddress,
      r3tards: contracts?.r3tards,
      pass: contracts?.pass,
      experimentCount: row(0) == null ? undefined : Number(row(0)),
      renderersFrozen: row(1) as boolean | undefined,
      experimentsFrozen: row(2) as boolean | undefined,
    },
    drivers,
    hardware: {
      staking: hardware?.staking.status ?? 'unknown',
      reserve: hardware?.reserve.status ?? 'unknown',
      history: hardware?.history.status ?? 'unknown',
      p256: hardware?.p256.status ?? 'unknown',
      romContracts: hardware?.rom.value.length || undefined,
    },
    systemEvent: eventValue,
    card: { driver: drivers.find((driver) => driver.key === 'card-drv')!.state, context: cardContext },
  }
}
