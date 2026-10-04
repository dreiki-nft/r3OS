import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { useRefreshTick } from '../chain/refreshTick'
import { getTxTraceSnapshot, subscribeTxTrace } from '../chain/txTrace'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_PAINT_ABI, R3TARDS_PAINTER_PASS_ABI } from '../lib/generated/abi'
import { isFirstRunOpen, subscribeFirstRun } from './firstRunState'
import { helpHash } from './helpTopics'
import { openProgram } from './programs'
import { playSound } from './sound'
import { Button } from './ui/Button'
import { WalletChooser } from './WalletChooser'
import {
  nextWelcomeStep,
  SHOW_WELCOME_EVENT,
  welcomeSteps,
  type WelcomeFacts,
  type WelcomeStepId,
} from './welcomeChecklist'

const HIDDEN_KEY = 'r3os.welcome.hidden'

function storedHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function storeHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, '1')
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // Storage can be blocked: the checklist just shows again next visit.
  }
}

/**
 * Persistent getting-started card. Guests are pointed at read-only Paint first; after a wallet connects, the
 * chain-backed checklist becomes connect → paint → save a frame → claim the Pass. It sits under every window,
 * can be closed, and Help › getting started reopens it. Chain reads only run while it is visible and useful.
 */
export function Welcome() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const traces = useSyncExternalStore(subscribeTxTrace, getTxTraceSnapshot)
  const tick = useRefreshTick(30)
  const firstRunOpen = useSyncExternalStore(subscribeFirstRun, isFirstRunOpen)
  const [hidden, setHidden] = useState(storedHidden)
  const [choosing, setChoosing] = useState(false)
  const [facts, setFacts] = useState<Omit<WelcomeFacts, 'connected'> & { account?: string }>({})

  useEffect(() => {
    const show = () => {
      storeHidden(false)
      setHidden(false)
    }
    window.addEventListener(SHOW_WELCOME_EVENT, show)
    return () => window.removeEventListener(SHOW_WELCOME_EVENT, show)
  }, [])

  const account = wallet.account
  const steps = useMemo(
    () => welcomeSteps({ connected: Boolean(account), ...(facts.account === account ? facts : {}) }),
    [account, facts],
  )
  const next = nextWelcomeStep(steps)

  useEffect(() => {
    if (hidden || !account || !publicClient || !config.paintAddress) return
    let cancelled = false
    const client = publicClient
    void (async () => {
      const [stats, contracts] = await Promise.all([
        client.readContract({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'painterStats',
          args: [account],
        }) as Promise<readonly bigint[]>,
        discoverContracts(),
      ])
      const passId = contracts.pass
        ? ((await client.readContract({
            address: contracts.pass,
            abi: R3TARDS_PAINTER_PASS_ABI,
            functionName: 'passOf',
            args: [account],
          })) as bigint)
        : 0n
      if (!cancelled)
        setFacts({ account, framesMinted: stats[3], paintCount: stats[6], hasPass: passId > 0n })
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
    // Re-read after any transaction the app sends, and on the slow refresh tick.
  }, [hidden, account, tick, traces.version])

  if (hidden || firstRunOpen) return null

  const close = () => {
    storeHidden(true)
    setHidden(true)
    playSound('select')
  }

  const act = (id: WelcomeStepId) => {
    if (id === 'connect') setChoosing(true)
    else if (id === 'pass') openProgram('pass')
    else openProgram('paint')
  }

  if (!account) {
    return (
      <aside className="welcome raised" aria-label="Try r3tardOS">
        <header>
          <b>try r3tardOS</b>
          <button className="welcome-close" aria-label="Close getting started" onClick={close}>
            ×
          </button>
        </header>
        <p className="welcome-guest-copy">
          Watch the shared canvas first. Connect a wallet only when you want to write onchain.
        </p>
        <div className="welcome-actions">
          <Button primary onClick={() => openProgram('paint')}>
            Open Paint
          </Button>
          <Button onClick={() => setChoosing(true)}>Connect wallet</Button>
          <Button onClick={() => openProgram('help', true, helpHash('getting-started'))}>
            60-second tour
          </Button>
        </div>
        {choosing && <WalletChooser onClose={() => setChoosing(false)} />}
      </aside>
    )
  }

  const done = steps.filter((step) => step.done).length
  return (
    <aside className="welcome raised" aria-label="Getting started">
      <header>
        <b>getting started</b>
        <span>
          {done} / {steps.length}
        </span>
        <button className="welcome-close" aria-label="Close getting started" onClick={close}>
          ×
        </button>
      </header>
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={step.done ? 'done' : step === next ? 'current' : ''}>
            <span className="welcome-check" aria-hidden="true">
              {step.done ? '✓' : ''}
            </span>
            <span>
              {step.label}
              {step === next && <small>{step.hint}</small>}
            </span>
          </li>
        ))}
      </ol>
      {next ? (
        <div className="welcome-actions">
          <Button primary onClick={() => act(next.id)}>
            {next.id === 'connect' ? 'Connect wallet' : next.id === 'pass' ? 'Open My Pass' : 'Open Paint'}
          </Button>
          <Button onClick={() => openProgram('help', true, helpHash('getting-started'))}>Help</Button>
        </div>
      ) : (
        <div className="welcome-actions">
          <p>you're set. try Quests, Burn a CD and Block Camera next.</p>
          <Button onClick={close}>Done</Button>
        </div>
      )}
      {choosing && <WalletChooser onClose={() => setChoosing(false)} />}
    </aside>
  )
}
