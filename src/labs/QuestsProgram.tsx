import { helpHash } from '../os/helpTopics'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { openProgram } from '../os/programs'
import { confirmHigherCost, osConfirm } from '../os/confirm'
import { type Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { markProgramDataReady } from '../chain/perf'
import { wsClient } from '../chain/clients'
import { sendActions, walletCanBatch } from '../chain/batch'
import { quoteAction } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { discoverContracts } from '../chain/contracts'
import { R3OS_QUESTS_ABI } from '../lib/generated/abi'
import { getLiveSnapshot, liveActive, subscribeLive } from '../live/liveStore'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { SafeImage } from '../os/ui/SafeImage'
import { Icon } from '../os/ui/Icon'
import { readPassImage } from '../pass/passImage'
import { errorText, labLoadError, LabNotDeployedError, shortAddress } from './labCommon'
import {
  QUEST_GROUP_TITLES,
  QUEST_HOW,
  questGroup,
  questLockedByHiddenLab,
  type QuestGroup,
  type QuestProgressState,
} from './quests'
import { config } from '../chain/config'
import { getReleaseSnapshot, isProgramAvailable, subscribeReleases } from '../os/releases'
import { useRefreshTick } from '../chain/refreshTick'
import { questIsRetired, retiredAddresses } from '../os/retired'
import { questAddress, readQuestAccountData, readQuestDefinitions, type QuestDefinition } from './questsData'

const RULES = [
  'each quest reads a number straight from a contract: pixels painted, frames saved, storm paints, and so on.',
  'when you reach the goal, press Claim. the contract checks it again before it records the badge.',
  'live mode can claim for you.',
  'badges are bragging rights only. new quests can be added later; existing ones never change.',
] as const

const EXPERIMENT_PROGRAMS: Record<string, string> = {
  'finale auction': 'auction',
  'recycle-bin': 'bin',
  'cd-burner': 'cd',
}

const DAY_ONE_DETAIL: Record<string, string> = {
  'MONTH IN': 'days painting',
  'STORM REGULAR': 'paints during storms',
  'LIVE WIRE': 'live-mode paints',
  '10K PIXELS': 'canvas pixels',
  ARCHIVIST: 'frames saved',
  'PADDLE UP': 'finale-auction bids',
  RECYCLER: 'frames recycled',
  'CARD CARRIER': 'Monad Card + canvas pixels',
}

function questSubtitle(name: string, goal: bigint) {
  const n = goal.toLocaleString('en-US')
  if (name === 'MONTH IN') return `${n} days painting`
  if (name === 'STORM REGULAR') return `${n} storm paints`
  if (name === 'LIVE WIRE') return `${n} live-mode paints`
  if (name === '10K PIXELS') return `${n} canvas pixels`
  if (name === 'ARCHIVIST') return `save ${n} frames`
  if (name === 'PADDLE UP')
    return goal === 1n ? 'place a finale-auction bid' : `place ${n} finale-auction bids`
  if (name === 'RECYCLER') return `burn ${n} frames`
  if (name === 'CARD CARRIER') return 'hold a Monad Card and paint 143 pixels'
  return `${n} onchain value`
}

export function badgeSrc(name: string) {
  const activeBadges: Readonly<Record<string, string>> = {
    'MONTH IN': '/os/badges/q00_month_in.png',
    'STORM REGULAR': '/os/badges/q01_storm_regular.png',
    'LIVE WIRE': '/os/badges/q02_live_wire.png',
    '10K PIXELS': '/os/badges/q03_pixels_10k.png',
    ARCHIVIST: '/os/badges/q04_archivist.png',
    'PADDLE UP': '/os/badges/q11_paddle_up.png',
    RECYCLER: '/os/badges/q12_recycler.png',
  }
  return activeBadges[name] ?? '/os/icons/trophy@2x.png'
}

export function QuestsProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const refreshTick = useRefreshTick()
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [passImage, setPassImage] = useState<string>()
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const [labTargets, setLabTargets] = useState<Record<string, string>>({})
  const [labTargetsReady, setLabTargetsReady] = useState(false)
  // Quests that read a retired Lab are not shown, counted or claimable here (their contracts are untouched).
  const [retiredTargets, setRetiredTargets] = useState<ReadonlySet<string>>(new Set())
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState<{ text: string; offline: boolean }>()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [defsLoaded, setDefsLoaded] = useState(false)
  const [defs, setDefs] = useState<QuestDefinition[]>([])
  const [progress, setProgress] = useState<QuestProgressState[]>([])
  const [claimableMask, setClaimableMask] = useState(0n)
  const [completedMask, setCompletedMask] = useState(0n)
  const [completedCount, setCompletedCount] = useState(0n)
  // The header shows your actual Painter Pass (its QUESTS line changes with every claim).
  useEffect(() => {
    if (!wallet.account) {
      setPassImage(undefined)
      return
    }
    let cancelled = false
    void readPassImage(wallet.account, completedCount.toString()).then((image) => {
      if (!cancelled) setPassImage(image)
    })
    return () => {
      cancelled = true
    }
  }, [wallet.account, completedCount])
  const [selected, setSelected] = useState(0)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [progressLoaded, setProgressLoaded] = useState(false)

  useEffect(() => {
    void questAddress()
      .then(setAddress)
      .catch((error) =>
        setMissing({ text: labLoadError(error), offline: !(error instanceof LabNotDeployedError) }),
      )
  }, [loadAttempt])

  useEffect(() => {
    void discoverContracts()
      .then((contracts) => {
        const targets: Record<string, string> = {}
        for (const [name, programId] of Object.entries(EXPERIMENT_PROGRAMS)) {
          const target = contracts.labs[name]
          if (target) targets[target.toLowerCase()] = programId
        }
        setLabTargets(targets)
        setRetiredTargets(retiredAddresses(contracts.labs))
        setLabTargetsReady(true)
      })
      .catch(() => undefined)
  }, [])

  const loadDefs = useCallback(async (force = false) => {
    if (!address) return
    try {
      const next = await readQuestDefinitions(address, force)
      setDefs(next)
      setDefsLoaded(true)
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address])

  useEffect(() => {
    void loadDefs()
  }, [loadDefs])

  const refresh = useCallback(async (force = false) => {
    if (!address || !wallet.account || !defs.length) {
      setProgress([])
      setClaimableMask(0n)
      setCompletedMask(0n)
      setCompletedCount(0n)
      setProgressLoaded(true)
      return
    }
    try {
      const next = await readQuestAccountData(address, wallet.account, defs, force)
      setClaimableMask(next.claimableMask)
      setCompletedMask(next.completedMask)
      setCompletedCount(next.completedCount)
      setProgress(next.progress)
      setProgressLoaded(true)
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, wallet.account, defs])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshTick])

  useEffect(() => {
    if (defsLoaded && (!wallet.account || progressLoaded)) markProgramDataReady('quests')
  }, [defsLoaded, wallet.account, progressLoaded])

  useEffect(() => {
    if (!wsClient || !address) return
    return wsClient.watchContractEvent({
      address,
      abi: R3OS_QUESTS_ABI,
      onLogs: (eventLogs) => {
        if (eventLogs.some((log) => log.eventName === 'QuestAdded')) void loadDefs(true)
        void refresh(true)
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
          abi: R3OS_QUESTS_ABI,
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
      const signer = liveActive(live) ? 'burner' : 'wallet'
      const quoted = await quoteClaims(ids)
      const batched = ids.length > 1 && signer === 'wallet' && (await walletCanBatch(wallet.account))
      const cost = quoted
        .map((item) => `${defs[item.id]?.name ?? `quest ${item.id}`}: ${item.quote.maxCost}`)
        .join('\n')
      const how =
        ids.length === 1
          ? 'Claim this badge?'
          : signer === 'burner'
            ? `Claim ${ids.length} badges? Live mode sends them, no wallet prompts.`
            : batched
              ? `Claim ${ids.length} badges in one wallet prompt?`
              : `Claim ${ids.length} badges? Your wallet asks once per badge.`
      if (
        !(await osConfirm({
          title: ids.length === 1 ? 'Claim badge' : 'Claim badges',
          message: `${how}\n\n${cost}`,
          okLabel: 'Claim',
          kind: 'info',
        }))
      )
        return
      await sendActions(
        quoted.map((item) => ({
          kind: 'estimate' as const,
          address,
          abi: R3OS_QUESTS_ABI,
          functionName: 'claim',
          args: [BigInt(item.id)],
          account: wallet.account!,
          signer,
          quote: item.quote,
          action: `claim quest ${defs[item.id]?.name ?? item.id}`,
          successSound: 'success-heavy' as const,
          confirmHigherCost,
        })),
        {
          action:
            ids.length === 1 ? `claim quest ${defs[ids[0]]?.name ?? ids[0]}` : `claim ${ids.length} quests`,
        },
      )
      await refresh(true)
    } catch (error) {
      setMessage(errorText(error))
      await refresh(true)
    } finally {
      setPending(false)
    }
  }

  const locked = (quest: QuestDefinition) =>
    !labTargetsReady ||
    questLockedByHiddenLab(quest.conditions, labTargets, (id) => !isProgramAvailable(id, releases))
  const retired = (quest: QuestDefinition) => questIsRetired(quest.conditions, retiredTargets)
  const visibleCount = labTargetsReady ? defs.filter((quest) => !retired(quest)).length : defs.length
  const claimableIds = defs
    .filter((quest) => !retired(quest) && !locked(quest) && Boolean(claimableMask & (1n << BigInt(quest.id))))
    .map((quest) => quest.id)
  const chosenDef = defs[selected]
  const chosenProgress = progress[selected]
  const menus = [
    { label: 'File', items: [{ label: 'Close', action: () => closeWindow('quests') }] },
    { label: 'View', items: [{ label: 'Refresh', action: refresh }] },
    {
      label: 'Help',
      items: [{ label: 'How it works', action: () => openProgram('help', true, helpHash('quests')) }],
    },
  ]

  if (missing)
    return (
      <div className="lab-missing">
        <p>{missing.text}</p>
        {missing.offline && (
          <Button
            onClick={() => {
              setMissing(undefined)
              setLoadAttempt((value) => value + 1)
            }}
          >
            Try again
          </Button>
        )}
      </div>
    )

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
          {passImage ? (
            <SafeImage className="quests-pass" src={passImage} alt="your Painter Pass" width={38} height={38} />
          ) : (
            <span className="badge-placeholder" title="claim your Painter Pass in My Pass to see it here">
              <Icon name="computer" size={24} />
            </span>
          )}
          <div>
            <b>{defsLoaded ? `${completedCount} of ${visibleCount} badges` : 'loading quests…'}</b>
            <small>
              your Pass shows QUESTS {completedCount.toString()} · badges are bragging rights, they grant
              nothing
            </small>
          </div>
        </div>
        <Button
          primary
          disabled={pending || !claimableIds.length}
          title={
            !wallet.account
              ? 'connect a wallet first'
              : !claimableIds.length
                ? 'nothing to claim yet: reach a goal first'
                : 'claim every finished quest'
          }
          onClick={() => claimIds(claimableIds)}
        >
          Claim all ({claimableIds.length})
        </Button>
      </header>
      <div className="quests-main">
        <section className="quest-list sunken">
          {defs.map((quest, index) => {
            if (retired(quest)) return null
            // Group header ("ON THE CANVAS" / "AROUND r3OS") when the group changes.
            const group: QuestGroup = questGroup(quest.conditions, config.paintAddress)
            const previous = defs
              .slice(0, index)
              .filter((item) => !retired(item))
              .at(-1)
            const header =
              !previous || questGroup(previous.conditions, config.paintAddress) !== group
                ? QUEST_GROUP_TITLES[group]
                : undefined
            const row = progress[index]
            const isLocked = locked(quest)
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
              <div key={quest.id} className="quest-row-wrap">
                {header && <div className="quest-group">{header}</div>}
                <div
                  role="button"
                  tabIndex={0}
                  className={`quest-row ${selected === index ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
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
                    src={badgeSrc(quest.name)}
                    alt={isLocked ? 'locked quest' : quest.name}
                    width={34}
                    height={34}
                    style={isLocked ? { filter: 'grayscale(1)', opacity: 0.35 } : undefined}
                  />
                  <span className="quest-name">
                    <b>{isLocked ? '???' : quest.name}</b>
                    <small>{isLocked ? 'coming soon' : questSubtitle(quest.name, goal)}</small>
                  </span>
                  <span className="quest-progress">
                    <i>
                      <em style={{ width: isLocked ? '0%' : `${percent}%` }} />
                    </i>
                  </span>
                  <span className="quest-value">
                    {isLocked ? '—' : `${value.toString()} / ${goal.toString()}`}
                  </span>
                  <span
                    className={`quest-state ${!isLocked && claimed ? 'claimed' : !isLocked && claimable ? 'ready' : ''}`}
                  >
                    {isLocked ? (
                      'coming soon'
                    ) : claimed ? (
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
              </div>
            )
          })}
        </section>
        <aside className="quest-side">
          <GroupBox title="Trophy case">
            <div className="trophy-grid">
              {defs.map((quest) => {
                if (retired(quest)) return null
                const isLocked = locked(quest)
                const claimed = Boolean(completedMask & (1n << BigInt(quest.id)))
                const ready = Boolean(claimableMask & (1n << BigInt(quest.id)))
                return (
                  <button
                    key={quest.id}
                    className={`${selected === quest.id ? 'selected' : ''} ${claimed && !isLocked ? 'claimed' : 'locked'}`}
                    onClick={() => setSelected(quest.id)}
                  >
                    <SafeImage
                      src={badgeSrc(quest.name)}
                      alt={isLocked ? 'locked quest' : quest.name}
                      width={60}
                      height={60}
                      style={isLocked ? { filter: 'grayscale(1)', opacity: 0.35 } : undefined}
                    />
                    <span>{isLocked ? '' : claimed ? '✓' : ready ? '!' : ''}</span>
                  </button>
                )
              })}
            </div>
          </GroupBox>
          <GroupBox title={chosenDef && locked(chosenDef) ? '???' : (chosenDef?.name ?? 'Quest')}>
            {chosenDef && locked(chosenDef) ? (
              <div className="quest-detail">
                <SafeImage
                  src={badgeSrc(chosenDef.name)}
                  alt="locked quest"
                  width={60}
                  height={60}
                  style={{ filter: 'grayscale(1)', opacity: 0.35 }}
                />
                <b>coming soon</b>
                <p className="muted">this quest belongs to a Lab that isn't installed yet.</p>
              </div>
            ) : chosenDef ? (
              <div className="quest-detail">
                <SafeImage src={badgeSrc(chosenDef.name)} alt={chosenDef.name} width={60} height={60} />
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
                {QUEST_HOW[chosenDef.name] && !chosenProgress?.claimed && (
                  <Button
                    onClick={() => {
                      const how = QUEST_HOW[chosenDef.name]
                      openProgram(how.program, true, how.hash)
                    }}
                  >
                    {QUEST_HOW[chosenDef.name].label}
                  </Button>
                )}
                <p className="muted">
                  claim once and your Pass counts it for good. new quests can be added later; existing ones
                  never change. live mode can claim for you.
                </p>
              </div>
            ) : null}
          </GroupBox>
        </aside>
      </div>
      <footer className="lab-status">
        <span>
          {message ||
            (defsLoaded
              ? `${visibleCount} quests · conditions and progress read directly from their onchain targets`
              : 'reading quests from the chain…')}
        </span>
        <span>{wallet.account ? shortAddress(wallet.account) : 'wallet disconnected'}</span>
        <span>#{block.block.toString()}</span>
      </footer>
    </div>
  )
}
