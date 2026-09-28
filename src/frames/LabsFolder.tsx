import '../labs/phase3c2a.css'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { zeroAddress, type Address } from 'viem'
import { publicClient, wsClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { readMany } from '../chain/readMany'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_FLIPBOOK_ABI, R3TARDS_LABS_ABI } from '../lib/generated/abi'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { SafeImage } from '../os/ui/SafeImage'
import { readLabsToken, type LabsTokenData } from '../labs/labsToken'

export type LabsOwnedToken = { id: bigint; data?: LabsTokenData }
export type LabsFilter = 'All' | 'Reels' | 'Forks' | 'Dreams' | 'CDs'

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

async function labsAddress() {
  if (!publicClient) throw new Error('DEMO_MODE')
  const flipbook = (await discoverContracts()).labs.flipbook
  if (!flipbook) throw new Error("this Lab isn't deployed on this network")
  return (await publicClient.readContract({
    address: flipbook,
    abi: R3TARDS_FLIPBOOK_ABI,
    functionName: 'LABS',
  })) as Address
}

async function scanOwned(labs: Address, owner: Address) {
  if (!publicClient) return []
  const total = BigInt(
    await publicClient.readContract({ address: labs, abi: R3TARDS_LABS_ABI, functionName: 'totalMinted' }),
  )
  const owned: bigint[] = []
  for (let start = 1n; start <= total; start += 100n) {
    const end = start + 99n < total ? start + 99n : total
    const calls = Array.from({ length: Number(end - start + 1n) }, (_, i) => ({
      address: labs,
      abi: R3TARDS_LABS_ABI,
      functionName: 'ownerOf',
      args: [start + BigInt(i)],
    }))
    const rows = await readMany(calls, { allowFailure: true })
    owned.push(...ownedFromOwnerScan(rows, owner, start))
  }
  return owned
}

function bucket(data?: LabsTokenData) {
  const type = String(data?.attributes.Type ?? '').toLowerCase()
  if (type.includes('reel')) return 'Reels'
  if (type.includes('fork')) return 'Forks'
  if (type.includes('dream')) return 'Dreams'
  if (type === 'cd' || type.includes('cd')) return 'CDs'
  return 'All'
}

function labFor(data?: LabsTokenData) {
  const type = bucket(data)
  if (type === 'Reels') return 'flipbook'
  if (type === 'Forks') return 'forks'
  if (type === 'Dreams') return 'sleepwalker'
  if (type === 'CDs') return 'cd-burner'
  return undefined
}

export function LabsFolder({ onExit }: { onExit: () => void }) {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [labs, setLabs] = useState<Address>()
  const [tokens, setTokens] = useState<LabsOwnedToken[]>([])
  const [filter, setFilter] = useState<LabsFilter>('All')
  const [selected, setSelected] = useState<bigint>()
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!wallet.account) return setTokens([])
    try {
      const address = labs ?? (await labsAddress())
      setLabs(address)
      const ids = await scanOwned(address, wallet.account)
      const rows = await Promise.all(
        ids.map(async (id) => ({ id, data: await readLabsToken(id).catch(() => undefined) })),
      )
      setTokens(rows)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [labs, wallet.account])

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
    () => tokens.filter((token) => filter === 'All' || bucket(token.data) === filter),
    [tokens, filter],
  )
  const chosen = tokens.find((token) => token.id === selected)
  const targetLab = labFor(chosen?.data)
  const available = targetLab === 'flipbook' || targetLab === 'forks' || targetLab === 'sleepwalker'

  return (
    <div className="labs-folder-view">
      <div className="labs-folder-head">
        <Button onClick={onExit}>↑ My Frames</Button>
        <b>Labs</b>
        <div className="labs-type-filter">
          {(['All', 'Reels', 'Forks', 'Dreams', 'CDs'] as LabsFilter[]).map((item) => (
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
            <small>{bucket(token.data) === 'All' ? 'Labs token' : bucket(token.data)}</small>
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
            title={available ? 'open this token in its Lab' : 'this Lab window arrives in 3c-2c'}
            onClick={() => {
              if (!targetLab) return
              if (targetLab === 'sleepwalker') {
                openProgram('sleepwalker', true, `#/sleepwalker?tab=morning&token=${chosen.id}`)
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
        <span>reels · forks · dreams · CDs</span>
      </footer>
    </div>
  )
}
