import { useEffect, useState } from 'react'
import { isAddress, toFunctionSelector, type Address, type Hex } from 'viem'
import { publicClient } from './clients'
import { config } from './config'
import { discoverContracts, type ContractAddresses } from './contracts'
import { readHeavy, readMany } from './readMany'
import { useRefreshTick } from './refreshTick'

export type HardwareSource = 'measured' | 'onchain' | 'spec' | 'absent' | 'unknown'
export type DeviceStatus = 'present' | 'absent' | 'unknown'

export interface Sourced<T> {
  value: T
  source: HardwareSource
  doc?: string
  date?: string
}

export interface RomEntry {
  name: string
  address: Address
  bytes?: number
  source: HardwareSource
}

export interface MonadHardwareSnapshot {
  loading: boolean
  chainId: Sourced<number>
  clientVersion: Sourced<string>
  staking: {
    status: DeviceStatus
    epoch: Sourced<bigint | undefined>
    inDelay: Sourced<boolean | undefined>
    proposerValId: Sourced<bigint | undefined>
  }
  reserve: { status: DeviceStatus; dipped: Sourced<boolean | undefined> }
  history: { status: DeviceStatus; codeBytes: Sourced<number | undefined> }
  p256: { status: DeviceStatus; verified: Sourced<boolean | undefined> }
  storage: {
    status: DeviceStatus
    address?: Address
    cold: Sourced<bigint | undefined>
    warm: Sourced<bigint | undefined>
    nextPageCold: Sourced<bigint | undefined>
    overhead: Sourced<bigint | undefined>
  }
  rom: Sourced<RomEntry[]>
}

export const MONAD_HW_ADDRESSES = {
  staking: '0x0000000000000000000000000000000000001000' as Address,
  reserve: '0x0000000000000000000000000000000000001001' as Address,
  p256: '0x0000000000000000000000000000000000000100' as Address,
  history: '0x0000F90827F1C53a10cb7A02335B175320002935' as Address,
} as const

export const MONAD_HW_SELECTORS = {
  epoch: toFunctionSelector('getEpoch()'),
  proposer: toFunctionSelector('getProposerValId()'),
  reserve: '0x3a61584e' as Hex,
} as const

export const P256_VECTOR =
  '0x84620b4976eefe556d558a13e176b421238988a31fef4ec774cfe5e5e7ad479fe0c14450794f14eb78eabf357b55e7ad08de3bb2e8eb2982a4856328dacf27707bc0d2c6db0305dde670ef690dd4e9bbee8f4e5ba831a0c678997e5b58ee1b0f471c3e758c4904285bba7e53118ed0f524adeb0757d25bd2f8e7b0d76dfa714cdd520f7aca8a8b917acc37f51de8f0c9bbe3ad858382e702dc25a12d09f7a858' as Hex

export function sourceForDeviceStatus(
  status: DeviceStatus,
  presentSource: Extract<HardwareSource, 'measured' | 'onchain'> = 'onchain',
): HardwareSource {
  if (status === 'present') return presentSource
  return status === 'absent' ? 'absent' : 'unknown'
}

const SPEC_DOC = 'PHASE_MONAD_HW_PROMPT.md'
const SPEC_DATE = '2026-09-30'
const spec = <T>(value: T): Sourced<T> => ({ value, source: 'spec', doc: SPEC_DOC, date: SPEC_DATE })

export const MONAD_HW_SPEC = {
  processor: spec('parallel EVM · MonadBFT'),
  blockTimeMs: spec(300),
  transactionMemoryBytes: spec(8 * 1024 * 1024),
  contractRomBytes: spec(128 * 1024),
  storagePageBytes: spec(4096),
  storagePageWords: spec(128),
  historyWindowBlocks: spec(8191),
} as const

const PAGE_PROBE_ABI = [
  {
    type: 'function',
    name: 'probePage',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'cold', type: 'uint256' },
      { name: 'warm', type: 'uint256' },
      { name: 'nextPageCold', type: 'uint256' },
      { name: 'overhead', type: 'uint256' },
    ],
  },
] as const

const LABS_GETTER_ABI = [
  {
    type: 'function',
    name: 'LABS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

const unknown = <T>(value: T): Sourced<T> => ({ value, source: 'unknown' })
const absent = <T>(value: T): Sourced<T> => ({ value, source: 'absent' })
const onchain = <T>(value: T): Sourced<T> => ({ value, source: 'onchain' })
const measured = <T>(value: T): Sourced<T> => ({ value, source: 'measured' })

function word(data: Hex | undefined, index: number) {
  if (!data || data === '0x') return undefined
  const start = 2 + index * 64
  const raw = data.slice(start, start + 64)
  if (raw.length !== 64) return undefined
  try {
    return BigInt(`0x${raw}`)
  } catch {
    return undefined
  }
}

export function decodeStakingEpoch(data?: Hex) {
  const epoch = word(data, 0)
  const delay = word(data, 1)
  if (epoch == null || delay == null) return undefined
  return { epoch, inDelay: delay !== 0n }
}

export function decodeStakingProposer(data?: Hex) {
  return word(data, 0)
}

export function decodeReserveResult(data?: Hex) {
  const value = word(data, 0)
  return value == null ? undefined : value !== 0n
}

export function decodeP256Result(data?: Hex) {
  const value = word(data, 0)
  return value == null ? undefined : value === 1n
}

function codeBytes(code?: Hex) {
  return code && code !== '0x' ? (code.length - 2) / 2 : 0
}

async function rawCall(to: Address, data: Hex) {
  if (!publicClient) return undefined
  try {
    const result = await publicClient.call({ to, data })
    return result.data
  } catch {
    return undefined
  }
}

interface StaticProbe {
  chainId: Sourced<number>
  clientVersion: Sourced<string>
  reserve: MonadHardwareSnapshot['reserve']
  history: MonadHardwareSnapshot['history']
  p256: MonadHardwareSnapshot['p256']
  storage: MonadHardwareSnapshot['storage']
  rom: Sourced<RomEntry[]>
}

let staticProbePromise: Promise<StaticProbe> | undefined

async function findLabsAddress(labs: Record<string, Address | undefined>) {
  const candidates = ['block-camera', 'flipbook', 'forks', 'sleepwalker', 'cd-burner']
    .map((name) => labs[name])
    .filter((value): value is Address => Boolean(value))
  if (!candidates.length) return undefined
  const reads = await readMany(
    candidates.map((address) => ({ address, abi: LABS_GETTER_ABI, functionName: 'LABS' })),
    { allowFailure: true },
  ).catch(() => [])
  for (const row of reads) {
    if (row?.status === 'success' && isAddress(String(row.result))) return row.result as Address
  }
  return undefined
}

async function probeStatic(): Promise<StaticProbe> {
  if (!publicClient) {
    return {
      chainId: unknown(config.chainId),
      clientVersion: unknown('unknown'),
      reserve: { status: 'unknown', dipped: unknown(undefined) },
      history: { status: 'unknown', codeBytes: unknown(undefined) },
      p256: { status: 'unknown', verified: unknown(undefined) },
      storage: {
        status: 'unknown',
        cold: unknown(undefined),
        warm: unknown(undefined),
        nextPageCold: unknown(undefined),
        overhead: unknown(undefined),
      },
      rom: unknown([]),
    }
  }

  const client = publicClient
  const contracts = await discoverContracts().catch((): ContractAddresses => ({ labs: {} }))
  const pageAddress = contracts.labs['page-exe']

  const [chainIdValue, clientVersionValue, reserveData, historyCode, p256Data] = await Promise.all([
    client.getChainId().catch(() => undefined),
    (client.request as any)({ method: 'web3_clientVersion' }).catch(() => undefined),
    rawCall(MONAD_HW_ADDRESSES.reserve, MONAD_HW_SELECTORS.reserve),
    // viem returns undefined for "no code"; only a failed request (null here) is unknown.
    client.getCode({ address: MONAD_HW_ADDRESSES.history }).then(
      (code: Hex | undefined) => code ?? '0x',
      () => null,
    ),
    rawCall(MONAD_HW_ADDRESSES.p256, P256_VECTOR),
  ])

  const reserveDecoded = decodeReserveResult(reserveData)
  const p256Decoded = decodeP256Result(p256Data)

  let storage: MonadHardwareSnapshot['storage'] = {
    status: pageAddress ? 'unknown' : 'unknown',
    address: pageAddress,
    cold: unknown(undefined),
    warm: unknown(undefined),
    nextPageCold: unknown(undefined),
    overhead: unknown(undefined),
  }
  if (pageAddress) {
    const result = await readHeavy([
      { address: pageAddress, abi: PAGE_PROBE_ABI, functionName: 'probePage' },
    ]).catch(() => [])
    const row = result[0]
    if (row?.status === 'success') {
      const values = row.result as readonly bigint[]
      storage = {
        status: 'present',
        address: pageAddress,
        cold: measured(BigInt(values[0] ?? 0n)),
        warm: measured(BigInt(values[1] ?? 0n)),
        nextPageCold: measured(BigInt(values[2] ?? 0n)),
        overhead: measured(BigInt(values[3] ?? 0n)),
      }
    }
  }

  const labCollection = await findLabsAddress(contracts.labs).catch(() => undefined)
  const entries = new Map<string, Address>()
  if (contracts.paint) entries.set('Paint', contracts.paint)
  if (contracts.pass) entries.set('Painter Pass', contracts.pass)
  if (labCollection) entries.set('Labs', labCollection)
  for (const [name, address] of Object.entries(contracts.labs)) {
    if (address) entries.set(name, address)
  }

  const romAddresses = [...entries.entries()]
  const codes = await Promise.all(
    romAddresses.map(async ([name, address]) => {
      const code = await client.getCode({ address }).catch(() => undefined)
      if (code == null) return { name, address, source: 'unknown' as const }
      return { name, address, bytes: codeBytes(code), source: 'measured' as const }
    }),
  )

  return {
    chainId: chainIdValue == null ? unknown(config.chainId) : onchain(chainIdValue),
    clientVersion: typeof clientVersionValue === 'string' ? onchain(clientVersionValue) : unknown('unknown'),
    reserve:
      reserveDecoded == null
        ? {
            status: reserveData === '0x' ? 'absent' : 'unknown',
            dipped: reserveData === '0x' ? absent(undefined) : unknown(undefined),
          }
        : { status: 'present', dipped: onchain(reserveDecoded) },
    history:
      historyCode == null
        ? { status: 'unknown', codeBytes: unknown(undefined) }
        : historyCode === '0x'
          ? { status: 'absent', codeBytes: absent(0) }
          : { status: 'present', codeBytes: onchain(codeBytes(historyCode)) },
    p256:
      p256Decoded === true
        ? { status: 'present', verified: onchain(true) }
        : p256Data === '0x'
          ? { status: 'absent', verified: absent(false) }
          : { status: p256Decoded === false ? 'unknown' : 'unknown', verified: unknown(p256Decoded) },
    storage,
    rom: measured(codes),
  }
}

async function probeConsensus(): Promise<MonadHardwareSnapshot['staking']> {
  if (!publicClient) {
    return {
      status: 'unknown',
      epoch: unknown(undefined),
      inDelay: unknown(undefined),
      proposerValId: unknown(undefined),
    }
  }
  const [epochData, proposerData] = await Promise.all([
    rawCall(MONAD_HW_ADDRESSES.staking, MONAD_HW_SELECTORS.epoch),
    rawCall(MONAD_HW_ADDRESSES.staking, MONAD_HW_SELECTORS.proposer),
  ])
  const epoch = decodeStakingEpoch(epochData)
  const proposer = decodeStakingProposer(proposerData)
  const absentDevice = epochData === '0x' && proposerData === '0x'
  if (!epoch && proposer == null) {
    return {
      status: absentDevice ? 'absent' : 'unknown',
      epoch: absentDevice ? absent(undefined) : unknown(undefined),
      inDelay: absentDevice ? absent(undefined) : unknown(undefined),
      proposerValId: absentDevice ? absent(undefined) : unknown(undefined),
    }
  }
  return {
    status: 'present',
    epoch: epoch ? onchain(epoch.epoch) : unknown(undefined),
    inDelay: epoch ? onchain(epoch.inDelay) : unknown(undefined),
    proposerValId: proposer == null ? unknown(undefined) : onchain(proposer),
  }
}

const EMPTY: MonadHardwareSnapshot = {
  loading: true,
  chainId: unknown(config.chainId),
  clientVersion: unknown('unknown'),
  staking: {
    status: 'unknown',
    epoch: unknown(undefined),
    inDelay: unknown(undefined),
    proposerValId: unknown(undefined),
  },
  reserve: { status: 'unknown', dipped: unknown(undefined) },
  history: { status: 'unknown', codeBytes: unknown(undefined) },
  p256: { status: 'unknown', verified: unknown(undefined) },
  storage: {
    status: 'unknown',
    cold: unknown(undefined),
    warm: unknown(undefined),
    nextPageCold: unknown(undefined),
    overhead: unknown(undefined),
  },
  rom: unknown([]),
}

export async function readMonadHardware(): Promise<MonadHardwareSnapshot> {
  staticProbePromise ??= probeStatic()
  const [staticProbe, staking] = await Promise.all([staticProbePromise, probeConsensus()])
  return { loading: false, ...staticProbe, staking }
}

export function useMonadHardware() {
  const refreshTick = useRefreshTick(30)
  const [state, setState] = useState<MonadHardwareSnapshot>(EMPTY)
  useEffect(() => {
    let cancelled = false
    void readMonadHardware().then((next) => !cancelled && setState(next))
    return () => {
      cancelled = true
    }
  }, [refreshTick])
  return state
}

export function __resetMonadHardwareForTests() {
  staticProbePromise = undefined
}
