import type { Address } from 'viem'
import { probeActionRpcs } from '../chain/actionRpc'
import { publicClient } from '../chain/clients'
import { discoverContracts, readCoreConstants } from '../chain/contracts'
import { resolveHolderIds } from '../chain/holders'
import { recordPerf } from '../chain/perf'
import { prewarmActionFees } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { getFrameImage } from '../frames/frameImage'
import { getFrameInfoBatch, mineTokenIds, refreshFrameIndex } from '../frames/framesStore'
import { startCanvasStore } from '../paint/canvasStore'
import { preloadLaunchPrograms } from './programs'

export type BootPrefetchState = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface BootPrefetchTask {
  id: string
  label: string
  critical: boolean
  state: BootPrefetchState
  detail?: string
  ms?: number
}

export interface BootPrefetchSnapshot {
  version: number
  startedAt?: number
  finishedAt?: number
  tasks: readonly BootPrefetchTask[]
}

type Listener = () => void

const TASKS: readonly Omit<BootPrefetchTask, 'state'>[] = [
  { id: 'programs', label: 'Loading system programs', critical: true },
  { id: 'rpc', label: 'Testing action RPCs', critical: true },
  { id: 'contracts', label: 'Reading system contracts', critical: true },
  { id: 'canvas', label: 'Loading canvas state', critical: true },
  { id: 'fees', label: 'Warming transaction fees', critical: true },
  { id: 'frames', label: 'Indexing saved frames', critical: true },
  { id: 'account', label: 'Warming wallet data', critical: true },
  { id: 'art', label: 'Caching recent frame art', critical: false },
]

const listeners = new Set<Listener>()
let snapshot: BootPrefetchSnapshot = {
  version: 0,
  tasks: TASKS.map((task) => ({ ...task, state: 'pending' })),
}
let started: Promise<void> | undefined

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

function emit(tasks: readonly BootPrefetchTask[], extra: Partial<BootPrefetchSnapshot> = {}) {
  snapshot = { ...snapshot, ...extra, version: snapshot.version + 1, tasks }
  for (const listener of listeners) listener()
}

function patchTask(id: string, patch: Partial<BootPrefetchTask>) {
  emit(snapshot.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))
}

function settled(state: BootPrefetchState) {
  return state === 'done' || state === 'error' || state === 'skipped'
}

export function bootPrefetchReady(input: BootPrefetchSnapshot = snapshot) {
  return input.tasks.filter((task) => task.critical).every((task) => settled(task.state))
}

export function bootPrefetchComplete(input: BootPrefetchSnapshot = snapshot) {
  return input.tasks.every((task) => settled(task.state))
}

export function bootPrefetchProgress(input: BootPrefetchSnapshot = snapshot) {
  const critical = input.tasks.filter((task) => task.critical)
  return {
    done: critical.filter((task) => settled(task.state)).length,
    total: critical.length,
  }
}

export function bootPrefetchRows(input: BootPrefetchSnapshot = snapshot) {
  return input.tasks
    .filter((task) => task.critical || task.state === 'running')
    .map((task) => ({
      id: task.id,
      label: task.label,
      state: task.state,
      detail: task.detail,
    }))
}

export function subscribeBootPrefetch(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBootPrefetchSnapshot() {
  return snapshot
}

async function runTask(id: string, work: () => Promise<void>) {
  const startedAt = now()
  patchTask(id, { state: 'running', detail: undefined, ms: undefined })
  try {
    await work()
    const ms = now() - startedAt
    patchTask(id, { state: 'done', ms })
    recordPerf('boot-prefetch', id, ms)
  } catch (error) {
    const ms = now() - startedAt
    patchTask(id, {
      state: 'error',
      detail: error instanceof Error ? error.message.slice(0, 80) : 'unavailable',
      ms,
    })
    recordPerf('boot-prefetch', id, ms)
  }
}

function skipTask(id: string, detail: string) {
  patchTask(id, { state: 'skipped', detail, ms: 0 })
}

function waitForAccount(timeoutMs = 900): Promise<Address | undefined> {
  const current = getWalletSnapshot().account
  if (current) return Promise.resolve(current)
  return new Promise((resolve) => {
    let done = false
    const finish = (account?: Address) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      stop()
      resolve(account)
    }
    const stop = subscribeWallet(() => {
      const account = getWalletSnapshot().account
      if (account) finish(account)
    })
    const timer = window.setTimeout(() => finish(getWalletSnapshot().account), timeoutMs)
  })
}

async function warmRecentFrameArt(ids: readonly number[]) {
  const recent = ids.filter((id) => id > 0).slice(0, 6)
  if (!recent.length) {
    skipTask('art', 'no owned frames')
    return
  }
  await runTask('art', async () => {
    await getFrameInfoBatch(recent)
    await Promise.allSettled(recent.map((id) => getFrameImage(id)))
    patchTask('art', { detail: `${recent.length} thumbnails cached` })
  })
}

async function warmAccountData(account: Address) {
  const contracts = await discoverContracts()
  const minePromise = mineTokenIds(account)
  const holderPromise =
    publicClient && contracts.r3tards
      ? resolveHolderIds(publicClient, contracts.r3tards, account).catch(() => [])
      : Promise.resolve([] as bigint[])
  const [mine, holderIds] = await Promise.all([minePromise, holderPromise])
  patchTask('account', {
    detail: `${mine.filter((id) => id > 0).length} frames · ${holderIds.length} holder token${holderIds.length === 1 ? '' : 's'}`,
  })
  void warmRecentFrameArt(mine)
}

/**
 * Fill the boot screen with useful work instead of making every program pay its own cold-start tax later.
 * The function is idempotent: every caller joins the same startup pass, and individual stores still dedupe
 * their own chain reads. Failed tasks settle instead of trapping the user behind the splash screen.
 */
export function startBootPrefetch() {
  if (started) return started
  emit(TASKS.map((task) => ({ ...task, state: 'pending' })), { startedAt: Date.now(), finishedAt: undefined })

  started = (async () => {
    const programs = runTask('programs', async () => {
      await preloadLaunchPrograms((done, total, label) => {
        patchTask('programs', { detail: `${done}/${total} · ${label}` })
      })
    })
    const rpc = runTask('rpc', async () => {
      await probeActionRpcs()
    })
    const contracts = runTask('contracts', async () => {
      await Promise.all([discoverContracts(), readCoreConstants()])
    })
    const canvas = runTask('canvas', async () => {
      await startCanvasStore()
    })
    const fees = runTask('fees', async () => {
      await rpc
      await prewarmActionFees(false)
    })
    const frames = runTask('frames', async () => {
      await refreshFrameIndex()
    })
    const account = runTask('account', async () => {
      const owner = await waitForAccount()
      if (!owner) {
        patchTask('account', { detail: 'guest session' })
        skipTask('art', 'guest session')
        return
      }
      await warmAccountData(owner)
    })

    await Promise.allSettled([programs, rpc, contracts, canvas, fees, frames, account])
    const art = snapshot.tasks.find((task) => task.id === 'art')
    if (art?.state === 'pending') skipTask('art', 'account data unavailable')
    emit(snapshot.tasks, { finishedAt: Date.now() })
  })()

  return started
}

export function __resetBootPrefetchForTests() {
  started = undefined
  snapshot = {
    version: 0,
    tasks: TASKS.map((task) => ({ ...task, state: 'pending' })),
  }
  listeners.clear()
}
