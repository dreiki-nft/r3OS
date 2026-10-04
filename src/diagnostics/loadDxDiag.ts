import type { Address } from 'viem'
import packageJson from '../../package.json'
import { getBlockSnapshot } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { chainName, config } from '../chain/config'
import { discoverContracts, getCachedContracts, getCachedCoreStatus, readCoreStatus } from '../chain/contracts'
import { isOfficialCard } from '../chain/monadCard'
import { getCachedMonadHardware, readMonadHardware } from '../chain/monadHardware'
import { readMany } from '../chain/readMany'
import { rpcStatsSnapshot, rpcStatsTotalSnapshot } from '../chain/rpcStats'
import { eventState, getCachedSystemEvent, readSystemEventNow } from '../chain/systemEvent'
import { R3OS_CARD_MEMORY_ABI } from '../lib/generated/abi'
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

const READ_TIMEOUT_MS = 2_500
const codePresence = new Map<string, boolean>()
const codeInflight = new Map<string, Promise<boolean | undefined>>()
const cardContextCache = new Map<string, DxDiagInput['card']['context']>()

async function hasCode(address?: Address, force = false) {
  if (!address || !publicClient) return undefined
  const key = address.toLowerCase()
  if (!force && codePresence.has(key)) return codePresence.get(key)
  const active = codeInflight.get(key)
  if (active) return active
  const pending = settle(publicClient.getCode({ address }))
    .then((code) => {
      if (code === undefined) return undefined
      const present = Boolean(code && code !== '0x')
      codePresence.set(key, present)
      return present
    })
    .finally(() => {
      if (codeInflight.get(key) === pending) codeInflight.delete(key)
    })
  codeInflight.set(key, pending)
  return pending
}

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
  // Snapshot RPC counters before DXDIAG generates any probes of its own. Diagnostics should report the
  // workload they found, not inflate the result simply by observing it.
  const rpcCounts = rpcStatsSnapshot()
  const rpcTotals = rpcStatsTotalSnapshot()
  const block = getBlockSnapshot()
  const cachedContracts = getCachedContracts()
  const cachedCoreStatus = getCachedCoreStatus()
  onStep('reading the r3OS contract list…')
  const contracts = (await settle(discoverContracts(force))) ?? cachedContracts
  const paint = contracts?.paint
  onStep('probing Monad devices and drivers…')

  const cardDriver = contracts?.labs['card-drv']
  const cachedHardware = getCachedMonadHardware()
  const cachedEvent = getCachedSystemEvent()
  const cardKey = cardDriver?.toLowerCase()
  const cachedCard = cardKey ? cardContextCache.get(cardKey) : undefined

  // Normal opens are stale-while-revalidate: boot already proved these facts, so DXDIAG renders the
  // cached snapshot immediately and quietly refreshes it. The explicit REFRESH path (`force`) still
  // waits for one bounded probe wave so the user can ask for authoritative current values.
  const coreRead = !force && cachedCoreStatus
    ? (void readCoreStatus().catch(() => undefined), Promise.resolve(cachedCoreStatus))
    : paint && publicClient
      ? settle(readCoreStatus(force))
      : Promise.resolve(undefined)
  const hardwareProbe = !force && cachedHardware
    ? (void readMonadHardware().catch(() => undefined), Promise.resolve(cachedHardware))
    : settle(readMonadHardware(force))
  const eventProbe = !force && cachedEvent
    ? (void readSystemEventNow().catch(() => undefined), Promise.resolve(cachedEvent))
    : settle(readSystemEventNow(force))
  const cardProbe = !force && cachedCard
    ? Promise.resolve(undefined)
    : cardDriver && publicClient
      ? settle(
          readMany([{ address: cardDriver, abi: R3OS_CARD_MEMORY_ABI, functionName: 'MONAD_CARD' }], {
            allowFailure: true,
          }),
        )
      : Promise.resolve(undefined)

  const [coreStatus, multicallPresent, driverCodes, hardwareRead, eventRead, cardRows] = await Promise.all([
    coreRead,
    config.multicall3Address ? hasCode(config.multicall3Address, force) : Promise.resolve(undefined),
    Promise.all(DXDIAG_DRIVERS.map(([name]) => hasCode(contracts?.labs[name], force))),
    hardwareProbe,
    eventProbe,
    cardProbe,
  ])
  const core = coreStatus ?? cachedCoreStatus
  const hardware = hardwareRead ?? cachedHardware
  const event = eventRead ?? cachedEvent

  const drivers: DriverRow[] = DXDIAG_DRIVERS.map(([name, label], index) => {
    const address = contracts?.labs[name]
    const state = contracts ? driverState(address, driverCodes[index]) : 'unknown'
    return { key: name, label, address, state, source: state === 'unknown' ? 'unknown' : 'onchain' }
  })

  // Card context is part of the same bounded probe wave above. Keeping it parallel avoids a second
  // full timeout window when one public RPC is degraded.
  let cardContext: DxDiagInput['card']['context'] = cachedCard ?? 'unknown'
  const card = (cardRows as any[] | undefined)?.[0]
  if (card?.status === 'success') {
    cardContext = isOfficialCard(config.chainId, card.result as Address) ? 'official' : 'mock'
    if (cardKey) cardContextCache.set(cardKey, cardContext)
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
    rpcStats: { windowSeconds: 10, counts: rpcCounts, totals: rpcTotals },
    contracts: {
      paint: paint ?? config.paintAddress,
      r3tards: contracts?.r3tards,
      pass: contracts?.pass,
      experimentCount: contracts?.experimentCount,
      renderersFrozen: core?.renderersFrozen,
      experimentsFrozen: core?.experimentsFrozen,
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
