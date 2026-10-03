import '../labs/phase3c2a.css'
import { screenSafeMessage } from '../chain/errors'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { zeroAddress, type Address } from 'viem'
import { publicClient, wsClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { readHeavy, readMany } from '../chain/readMany'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_FLIPBOOK_ABI, R3TARDS_LABS_ABI } from '../lib/generated/abi'
import { openProgram } from '../os/programs'
import { isRetiredProgram } from '../os/retired'
import { getReleaseSnapshot, isProgramAvailable, subscribeReleases } from '../os/releases'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { SafeImage } from '../os/ui/SafeImage'
import { decodeLabsTokenUri, readLabsToken, type LabsTokenData } from '../labs/labsToken'

export type LabsOwnedToken = { id: bigint; data?: LabsTokenData }
export type LabsFilter = 'All' | 'Reels' | 'Forks' | 'Dreams' | 'CDs' | 'Portraits'

function same(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

export function applyLabsTransfer(
  ids: readonly bigint[],
  owner: Address,
  from: Address,
  to: Address,
  id: bigint,
) {
  const next = new Set(ids.map(String))
  if (same(from, owner)) next.delete(String(id))
  if (same(to, owner)) next.add(String(id))
  return [...next].map(BigInt).sort((a, b) => (a < b ? -1 : 1))
}

export function ownedFromOwnerScan(results: readonly any[], owner: Address, startId = 1n) {
  return results.flatMap((row, index) =>
    row?.status === 'success' && same(String(row.result), owner) ? [startId + BigInt(index)] : [],
  )
}

let labsAddressPromise: Promise<Address> | undefined
const ownedLabsInflight = new Map<string, Promise<bigint[]>>()

export async function labsAddress() {
  if (labsAddressPromise) return labsAddressPromise
  if (!publicClient) throw new Error('DEMO_MODE')
  labsAddressPromise = (async () => {
    const flipbook = (await discoverContracts()).labs.flipbook
    if (!flipbook) throw new Error("this Lab isn't deployed on this network")
    return (await publicClient.readContract({
      address: flipbook,
      abi: R3TARDS_FLIPBOOK_ABI,
      functionName: 'LABS',
    })) as Address
  })().catch((error) => {
    labsAddressPromise = undefined
    throw error
  })
  return labsAddressPromise
}

export async function scanOwnedLabs(labs: Address, owner: Address) {
  if (!publicClient) return []
  const key = `${labs.toLowerCase()}:${owner.toLowerCase()}`
  const active = ownedLabsInflight.get(key)
  if (active) return active

  const pending = (async () => {
    const total = BigInt(
      await publicClient.readContract({ address: labs, abi: R3TARDS_LABS_ABI, functionName: 'totalMinted' }),
    )
    if (total === 0n) return []
    // readMany already slices Multicall3 into 100-call chunks and runs four chunks at a time.
    // Feeding it the whole owner scan avoids a serial 100-token waterfall as Labs grows.
    const rows = await readMany(
      Array.from({ length: Number(total) }, (_, i) => ({
        address: labs,
        abi: R3TARDS_LABS_ABI,
        functionName: 'ownerOf',
        args: [1n + BigInt(i)],
      })),
      { allowFailure: true },
    )
    return ownedFromOwnerScan(rows, owner, 1n)
  })().finally(() => {
    if (ownedLabsInflight.get(key) === pending) ownedLabsInflight.delete(key)
  })

  ownedLabsInflight.set(key, pending)
  return pending
}

export async function loadOwnedLabsTokens(owner: Address) {
  const address = await labsAddress()
  const ids = await scanOwnedLabs(address, owner)
  if (!ids.length) return []
  const rows = await readHeavy(
    ids.map((id) => ({ address, abi: R3TARDS_LABS_ABI, functionName: 'tokenURI', args: [id] })),
    { concurrency: 4 },
  )
  return ids.map((id, index) => ({
    id,
    data:
      rows[index]?.status === 'success'
        ? decodeLabsTokenUriSafe(String((rows[index] as { status: 'success'; result: unknown }).result))
        : undefined,
  }))
}

function decodeLabsTokenUriSafe(uri: string) {
  try {
    return decodeLabsTokenUri(uri)
  } catch {
    return undefined
  }
}

export function labsBucket(data?: LabsTokenData) {
  const type = String(data?.attributes.Type ?? '').toLowerCase()
  if (type.includes('reel')) return 'Reels'
  if (type.includes('fork')) return 'Forks'
  if (type.includes('dream')) return 'Dreams'
  if (type === 'cd' || type.includes('cd')) return 'CDs'
  if (type.includes('portrait')) return 'Portraits'
  return 'All'
}

function labFor(data?: LabsTokenData) {
  const type = labsBucket(data)
  if (type === 'Reels') return 'flipbook'
  if (type === 'Forks') return 'forks'
  if (type === 'Dreams') return 'sleepwalker'
  if (type === 'CDs') return 'cd'
  return undefined
}

export function LabsFolder({ onExit }: { onExit: () => void }) {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const [labs, setLabs] = useState<Address>()
  const [tokens, setTokens] = useState<LabsOwnedToken[]>([])
  const [filter, setFilter] = useState<LabsFilter>('All')
  const [selected, setSelected] = useState<bigint>()
  const [message, setMessage] = useState('')
  const routeToken = useMemo(() => {
    const raw = new URLSearchParams(location.hash.split('?')[1] ?? '').get('token')
    return raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined
  }, [])

  const load = useCallback(async () => {
    if (!wallet.account) return setTokens([])
    try {
      const address = labs ?? (await labsAddress())
      setLabs(address)
      const rows = await loadOwnedLabsTokens(wallet.account)
      setTokens(rows)
      if (routeToken != null && rows.some((token) => token.id === routeToken)) setSelected(routeToken)
    } catch (error) {
      setMessage(screenSafeMessage(error))
    }
  }, [labs, wallet.account, routeToken])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!wsClient || !labs || !wallet.account) return
    return wsClient.watchContractEvent({
      address: labs,
      abi: R3TARDS_LABS_ABI,
      eventName: 'Transfer',
      onLogs: (logs) => {
        setTokens((current) => {
          let ids = current.map((item) => item.id)
          for (const log of logs) {
            const args = log.args as { from?: Address; to?: Address; tokenId?: bigint }
            if (args.tokenId != null)
              ids = applyLabsTransfer(
                ids,
                wallet.account!,
                args.from ?? zeroAddress,
                args.to ?? zeroAddress,
                args.tokenId,
              )
          }
          if (ids.length !== current.length || ids.some((id, i) => id !== current[i]?.id)) void load()
          return current
        })
      },
    })
  }, [labs, wallet.account, load])

  const shown = useMemo(
    () => tokens.filter((token) => filter === 'All' || labsBucket(token.data) === filter),
    [tokens, filter],
  )
  const chosen = tokens.find((token) => token.id === selected)
  const targetLab = labFor(chosen?.data)
  const hasWindow =
    targetLab === 'flipbook' || targetLab === 'forks' || targetLab === 'sleepwalker' || targetLab === 'cd'
  const available = Boolean(
    targetLab && hasWindow && !isRetiredProgram(targetLab) && isProgramAvailable(targetLab, releases),
  )

  return (
    <div className="labs-folder-view">
      <div className="labs-folder-head">
        <Button onClick={onExit}>↑ My Frames</Button>
        <b>Labs</b>
        <div className="labs-type-filter">
          {(['All', 'CDs', 'Portraits'] as LabsFilter[]).map((item) => (
            <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="labs-folder-grid sunken">
        {shown.map((token) => (
          <button
            key={String(token.id)}
            className={selected === token.id ? 'selected' : ''}
            onClick={() => setSelected(token.id)}
            onDoubleClick={() => setSelected(token.id)}
          >
            <SafeImage
              src={token.data?.image ?? ''}
              alt={token.data?.name ?? `Labs #${token.id}`}
              width={128}
              height={128}
            />
            <b>{token.data?.name || `Labs #${token.id}`}</b>
            <small>{labsBucket(token.data) === 'All' ? 'Labs token' : labsBucket(token.data)}</small>
          </button>
        ))}
        {!shown.length && (
          <p>{wallet.account ? 'no matching Labs tokens.' : 'connect a wallet to view Labs tokens.'}</p>
        )}
      </div>
      {chosen && (
        <div className="labs-properties raised">
          <div className="labs-properties-main">
            <SafeImage
              src={chosen.data?.image ?? ''}
              alt={chosen.data?.name ?? ''}
              width={220}
              height={220}
            />
            <div>
              <h3>{chosen.data?.name}</h3>
              <small>Labs token #{chosen.id.toString()}</small>
            </div>
          </div>
          <GroupBox title="Traits">
            <dl className="lab-dl">
              {Object.entries(chosen.data?.attributes ?? {}).map(([name, value]) => (
                <span className="labs-trait" key={name}>
                  <dt>{name}</dt>
                  <dd>{String(value)}</dd>
                </span>
              ))}
            </dl>
          </GroupBox>
          <Button
            disabled={!available}
            title={
              available
                ? 'open this token in its Lab'
                : targetLab && hasWindow && !isProgramAvailable(targetLab, releases)
                  ? 'not installed yet'
                  : 'this Lab window is not available'
            }
            onClick={() => {
              if (!targetLab) return
              if (targetLab === 'sleepwalker') {
                openProgram('sleepwalker', true, `#/sleepwalker?tab=morning&token=${chosen.id}`)
                return
              }
              if (targetLab === 'cd') {
                openProgram('cd', true, `#/cd?token=${chosen.id}`)
                return
              }
              openProgram(targetLab)
            }}
          >
            Open in its Lab
          </Button>
        </div>
      )}
      <footer className="labs-folder-status">
        <span>{message || `${shown.length} object${shown.length === 1 ? '' : 's'}`}</span>
        <span>CDs · block portraits</span>
      </footer>
    </div>
  )
}
