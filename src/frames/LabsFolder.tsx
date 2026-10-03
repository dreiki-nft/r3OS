import '../labs/phase3c2a.css'
import { screenSafeMessage } from '../chain/errors'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { zeroAddress, type Address } from 'viem'
import { wsClient } from '../chain/clients'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_LABS_ABI } from '../lib/generated/abi'
import { openProgram } from '../os/programs'
import { isRetiredProgram } from '../os/retired'
import { getReleaseSnapshot, isProgramAvailable, subscribeReleases } from '../os/releases'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { SafeImage } from '../os/ui/SafeImage'
import type { LabsTokenData } from '../labs/labsToken'
import {
  applyLabsTransfer,
  labsAddress,
  labsBucket,
  loadOwnedLabsTokens,
  type LabsOwnedToken,
} from './labsStore'

export type LabsFilter = 'All' | 'Reels' | 'Forks' | 'Dreams' | 'CDs' | 'Portraits'

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
