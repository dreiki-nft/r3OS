import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient, wsClient } from '../chain/clients'
import { quoteAction, sendAction } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { readMany } from '../chain/readMany'
import { R3TARDS_QUESTS_ABI } from '../lib/generated/abi'
import { getLiveSnapshot, liveActive, subscribeLive } from '../live/liveStore'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { SafeImage } from '../os/ui/SafeImage'
import { errorText, labAddress, shortAddress } from './labCommon'
import { mapQuestProgress, type QuestProgressState } from './quests'

const RULES = [
  'each quest reads a number straight from a contract: pixels painted, frames saved, storm paints, and so on.',
  'when you reach the goal, press Claim. the contract checks it again before it records the badge.',
  'live mode can claim for you.',
  'badges are bragging rights only. new quests can be added later; existing ones never change.',
] as const

const DAY_ONE_DETAIL: Record<string, string> = {
  'MONTH IN': 'days painting',
  'STORM REGULAR': 'paints during storms',
  'LIVE WIRE': 'live-mode paints',
  '10K PIXELS': 'canvas pixels',
  ARCHIVIST: 'frames saved',
  ANIMATOR: 'Flipbook frames',
  'REEL MAKER': 'Flipbook reels owned',
  'GREEN THUMB': 'weeds plants',
  TIMELINES: 'different forks painted',
  'DNA HUNTER': 'verified brushes',
  'LAB RAT': 'Lab stamps',
  'PADDLE UP': 'finale-auction bids',
  RECYCLER: 'frames recycled',
}

function questSubtitle(name: string, goal: bigint) {
  const n = goal.toLocaleString('en-US')
  if (name === 'MONTH IN') return `${n} days painting`
  if (name === 'STORM REGULAR') return `${n} storm paints`
  if (name === 'LIVE WIRE') return `${n} live-mode paints`
  if (name === '10K PIXELS') return `${n} canvas pixels`
  if (name === 'ARCHIVIST') return `save ${n} frames`
  if (name === 'ANIMATOR') return `${n} Flipbook frames`
  if (name === 'REEL MAKER') return goal === 1n ? 'own a Flipbook reel' : `own ${n} Flipbook reels`
  if (name === 'GREEN THUMB') return `${n} weeds plants`
  if (name === 'TIMELINES') return `paint in ${n} distinct forks`
  if (name === 'DNA HUNTER') return `${n} verified brushes`
  if (name === 'LAB RAT') return goal === 4n ? 'earn four Lab stamps' : `earn ${n} Lab stamps`
  if (name === 'PADDLE UP')
    return goal === 1n ? 'place a finale-auction bid' : `place ${n} finale-auction bids`
  if (name === 'RECYCLER') return `burn ${n} frames`
  return `${n} onchain value`
}

type Condition = { target: Address; selector: `0x${string}`; word: number; op: number; threshold: bigint }
type QuestDef = { id: number; name: string; startBlock: bigint; endBlock: bigint; conditions: Condition[] }

function normalizeCondition(value: any): Condition {
  return {
    target: (value.target ?? value[0]) as Address,
    selector: (value.selector ?? value[1]) as `0x${string}`,
    word: Number(value.word ?? value[2]),
    op: Number(value.op ?? value[3]),
    threshold: BigInt(value.threshold ?? value[4]),
  }
}

export function badgeSrc(id: number) {
  return id < 13
    ? `/os/badges/q${String(id).padStart(2, '0')}_${
        [
          'month_in',
          'storm_regular',
          'live_wire',
          'pixels_10k',
          'archivist',
          'animator',
          'reel_maker',
          'green_thumb',
          'timelines',
          'dna_hunter',
          'lab_rat',
          'paddle_up',
          'recycler',
        ][id]
      }.png`
    : '/os/icons/trophy@2x.png'
}

export function QuestsProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [defs, setDefs] = useState<QuestDef[]>([])
  const [progress, setProgress] = useState<QuestProgressState[]>([])
  const [claimableMask, setClaimableMask] = useState(0n)
  const [completedMask, setCompletedMask] = useState(0n)
  const [completedCount, setCompletedCount] = useState(0n)
  const [selected, setSelected] = useState(0)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void labAddress('quests')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  const loadDefs = useCallback(async () => {
    if (!publicClient || !address) return
    try {
      const count = Number(
        (await publicClient.readContract({
          address,
          abi: R3TARDS_QUESTS_ABI,
          functionName: 'questCount',
        })) as bigint,
      )
      if (!count) {
        setDefs([])
        return
      }
      const values = await readMany(
        Array.from({ length: count }, (_, id) => ({
          address,
          abi: R3TARDS_QUESTS_ABI,
          functionName: 'questInfo',
          args: [BigInt(id)],
        })) as any,
        { allowFailure: false },
      )
      setDefs(
        values.map((value: any, id: number) => ({
          id,
          name: String(value[0]),
          startBlock: BigInt(value[1]),
          endBlock: BigInt(value[2]),
          conditions: (value[3] as any[]).map(normalizeCondition),
        })),
      )
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address])

  useEffect(() => {
    void loadDefs()
  }, [loadDefs])

  const refresh = useCallback(async () => {
    if (!publicClient || !address || !wallet.account || !defs.length) {
      setProgress([])
      setClaimableMask(0n)
      setCompletedMask(0n)
      setCompletedCount(0n)
      return
    }
    try {
      const contracts: any[] = [
        { address, abi: R3TARDS_QUESTS_ABI, functionName: 'claimable', args: [wallet.account] },
        { address, abi: R3TARDS_QUESTS_ABI, functionName: 'completedMask', args: [wallet.account] },
        { address, abi: R3TARDS_QUESTS_ABI, functionName: 'completedCount', args: [wallet.account] },
        ...defs.map((quest) => ({
          address,
          abi: R3TARDS_QUESTS_ABI,
          functionName: 'progress',
          args: [wallet.account, BigInt(quest.id)],
        })),
      ]
      const result = await readMany(contracts as any, { allowFailure: false })
      const claimable = BigInt(result[0] as bigint)
      const completed = BigInt(result[1] as bigint)
      setClaimableMask(claimable)
      setCompletedMask(completed)
      setCompletedCount(BigInt(result[2] as bigint))
      setProgress(
        defs.map((quest, index) => {
          const row = result[index + 3] as any
          const values = (row[0] as readonly bigint[]).map(BigInt)
          const passing = (row[1] as readonly boolean[]).map(Boolean)
          const bit = 1n << BigInt(quest.id)
          return mapQuestProgress(
            quest.conditions,
            values,
            passing,
            Boolean(completed & bit),
            Boolean(claimable & bit),
          )
        }),
      )
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, wallet.account, defs])

  useEffect(() => {
    void refresh()
  }, [refresh, block.block])

  useEffect(() => {
    if (!wsClient || !address) return
    return wsClient.watchContractEvent({
      address,
      abi: R3TARDS_QUESTS_ABI,
      onLogs: (eventLogs) => {
        if (eventLogs.some((log) => log.eventName === 'QuestAdded')) void loadDefs()
        void refresh()
      },
    })
  }, [address, loadDefs, refresh])

  async function quoteClaims(ids: number[]) {
    if (!address || !wallet.account) return []
    const questsAddress = address
    const account = wallet.account
    return Promise.all(
      ids.map(async (id) => ({
        id,
        quote: await quoteAction({
          kind: 'estimate',
          address: questsAddress,
          abi: R3TARDS_QUESTS_ABI,
          functionName: 'claim',
          args: [BigInt(id)],
          account,
          signer: liveActive(live) ? 'burner' : 'wallet',
          action: `claim quest ${defs[id]?.name ?? id}`,
        }),
      })),
    )
  }

  async function claimIds(ids: number[]) {
    if (!address || !wallet.account || !ids.length || pending) return
    setPending(true)
    setMessage('')
    try {
      const quoted = await quoteClaims(ids)
      const cost = quoted
        .map((item) => `${defs[item.id]?.name ?? `quest ${item.id}`}: ${item.quote.maxCost}`)
        .join('\n')
      if (
        !window.confirm(
          `${ids.length === 1 ? 'Claim this badge?' : `Claim ${ids.length} badges as separate transactions?`}\n\n${cost}`,
        )
      )
        return
      for (const item of quoted) {
        await sendAction({
          kind: 'estimate',
          address,
          abi: R3TARDS_QUESTS_ABI,
          functionName: 'claim',
          args: [BigInt(item.id)],
          account: wallet.account,
          signer: liveActive(live) ? 'burner' : 'wallet',
          quote: item.quote,
          action: `claim quest ${defs[item.id]?.name ?? item.id}`,
          successSound: 'success-heavy',
          confirmHigherCost: async (_old, next) =>
            window.confirm(`gas went up. continue with ${next.maxCost}?`),
        })
      }
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  const claimableIds = defs
    .filter((quest) => Boolean(claimableMask & (1n << BigInt(quest.id))))
    .map((quest) => quest.id)
  const chosenDef = defs[selected]
  const chosenProgress = progress[selected]
  const menus = [
    { label: 'File', items: [{ label: 'Close', action: () => closeWindow('quests') }] },
    { label: 'View', items: [{ label: 'Refresh', action: refresh }] },
    { label: 'Help', items: [{ label: 'How it works', disabled: true }] },
  ]

  if (missing) return <div className="lab-missing">this Lab isn't deployed on this network</div>

  return (
    <div className="lab-program quests-program">
      <MenuBar menus={menus} />
      <IntroBar
        lead="achievements across the whole site. reach the goal, claim it, and your Pass counts it."
        monad="every goal is checked onchain against the contract that tracks it, so a claim can't be faked."
        rules={RULES}
      />
      <header className="quests-head">
        <div>
          <span className="badge-placeholder" />
          <div>
            <b>
              {completedCount.toString()} of {defs.length} badges
            </b>
            <small>
              your Pass shows QUESTS {completedCount.toString()} · badges are bragging rights, they grant
              nothing
            </small>
          </div>
        </div>
        <Button primary disabled={pending || !claimableIds.length} onClick={() => claimIds(claimableIds)}>
          Claim all ({claimableIds.length})
        </Button>
      </header>
      <div className="quests-main">
        <section className="quest-list sunken">
          {defs.map((quest, index) => {
            const row = progress[index]
            const claimed = Boolean(completedMask & (1n << BigInt(quest.id)))
            const claimable = Boolean(claimableMask & (1n << BigInt(quest.id)))
            const value = row?.value ?? 0n
            const goal =
              row?.goal ??
              (quest.conditions.length > 1
                ? BigInt(quest.conditions.length)
                : (quest.conditions[0]?.threshold ?? 1n))
            const percent = goal > 0n ? Math.min(100, Number((value * 100n) / goal)) : 0
            return (
              <div
                key={quest.id}
                role="button"
                tabIndex={0}
                className={`quest-row ${selected === index ? 'selected' : ''}`}
                onClick={() => setSelected(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelected(index)
                  }
                }}
              >
                <SafeImage
                  className="quest-mini-badge"
                  src={badgeSrc(quest.id)}
                  alt={quest.name}
                  width={34}
                  height={34}
                />
                <span className="quest-name">
                  <b>{quest.name}</b>
                  <small>{questSubtitle(quest.name, goal)}</small>
                </span>
                <span className="quest-progress">
                  <i>
                    <em style={{ width: `${percent}%` }} />
                  </i>
                </span>
                <span className="quest-value">
                  {value.toString()} / {goal.toString()}
                </span>
                <span className={`quest-state ${claimed ? 'claimed' : claimable ? 'ready' : ''}`}>
                  {claimed ? (
                    'claimed ✓'
                  ) : claimable ? (
                    <Button
                      disabled={pending}
                      onClick={(event) => {
                        event.stopPropagation()
                        void claimIds([quest.id])
                      }}
                    >
                      Claim
                    </Button>
                  ) : (
                    'in progress'
                  )}
                </span>
              </div>
            )
          })}
        </section>
        <aside className="quest-side">
          <GroupBox title="Trophy case">
            <div className="trophy-grid">
              {defs.map((quest) => {
                const claimed = Boolean(completedMask & (1n << BigInt(quest.id)))
                const ready = Boolean(claimableMask & (1n << BigInt(quest.id)))
                return (
                  <button
                    key={quest.id}
                    className={`${selected === quest.id ? 'selected' : ''} ${claimed ? 'claimed' : 'locked'}`}
                    onClick={() => setSelected(quest.id)}
                  >
                    <SafeImage src={badgeSrc(quest.id)} alt={quest.name} width={60} height={60} />
                    <span>{claimed ? '✓' : ready ? '!' : ''}</span>
                  </button>
                )
              })}
            </div>
          </GroupBox>
          <GroupBox title={chosenDef?.name ?? 'Quest'}>
            {chosenDef && (
              <div className="quest-detail">
                <SafeImage src={badgeSrc(chosenDef.id)} alt={chosenDef.name} width={60} height={60} />
                <p>
                  {chosenDef.conditions.length > 1
                    ? `${chosenProgress?.value ?? 0n} of ${chosenDef.conditions.length} conditions`
                    : `${chosenProgress?.value ?? 0n} ${DAY_ONE_DETAIL[chosenDef.name] ?? 'onchain value'}`}
                </p>
                <b
                  className={
                    chosenProgress?.claimed ? 'cyan-text' : chosenProgress?.claimable ? 'warn-text' : ''
                  }
                >
                  {chosenProgress?.claimed
                    ? 'claimed ✓'
                    : chosenProgress?.claimable
                      ? 'ready to claim'
                      : 'in progress'}
                </b>
                <div className="quest-conditions">
                  {chosenDef.conditions.map((condition, index) => {
                    const value = chosenProgress?.values[index] ?? 0n
                    const pass = chosenProgress?.passing[index]
                    const pct =
                      condition.threshold > 0n
                        ? Math.min(100, Number((value * 100n) / condition.threshold))
                        : 0
                    return (
                      <div key={index}>
                        <div>
                          <span>
                            {chosenDef.conditions.length > 1
                              ? `condition ${index + 1}`
                              : (DAY_ONE_DETAIL[chosenDef.name] ?? 'condition')}
                          </span>
                          <b>
                            {value.toString()} / {condition.threshold.toString()} {pass ? '✓' : ''}
                          </b>
                        </div>
                        <progress
                          max={100}
                          value={pct}
                          title={`${shortAddress(condition.target)} · selector ${condition.selector} · word ${condition.word}`}
                        />
                      </div>
                    )
                  })}
                </div>
                {(chosenDef.startBlock !== 0n || chosenDef.endBlock !== 0n) && (
                  <small>
                    active blocks {chosenDef.startBlock.toString()}–
                    {chosenDef.endBlock === 0n ? '∞' : chosenDef.endBlock.toString()}
                  </small>
                )}
                <p className="muted">
                  claim once and your Pass counts it for good. new quests can be added later; existing ones
                  never change. live mode can claim for you.
                </p>
              </div>
            )}
          </GroupBox>
        </aside>
      </div>
      <footer className="lab-status">
        <span>
          {message ||
            `${defs.length} quests · conditions and progress read directly from their onchain targets`}
        </span>
        <span>{wallet.account ? shortAddress(wallet.account) : 'wallet disconnected'}</span>
        <span>#{block.block.toString()}</span>
      </footer>
    </div>
  )
}
