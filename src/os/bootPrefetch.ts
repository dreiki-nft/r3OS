import type { Address } from 'viem'
import { getActionRpcSnapshot, probeActionRpcs } from '../chain/actionRpc'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { discoverContracts, readCoreConstants, readCoreStatus } from '../chain/contracts'
import { readPainterProfile } from '../chain/painterProfile'
import { startMonadTraceFeed } from '../chain/monadLogs'
import { recordPerf } from '../chain/perf'
import { prewarmActionFees } from '../chain/tx'
import { getWalletSnapshot, restoreWallet, subscribeWallet } from '../chain/wallet'
import { loadCdSummary, loadOwnedCds } from '../cdrom/cdrom'
import { getFrameImage } from '../frames/frameImage'
import { getFrameInfoBatch, mineTokenIds, refreshFrameIndex } from '../frames/framesStore'
import { labsAddress, loadOwnedLabsSources, scanOwnedLabs } from '../frames/labsStore'
import { prefetchQuestData } from '../labs/questsData'
import { readLabsToken } from '../labs/labsToken'
import { getLiveSnapshot, setLiveOwner, subscribeLive } from '../live/liveStore'
import { readPassIdentity } from '../pass/passData'
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
  criticalReadyAt?: number
  finishedAt?: number
  tasks: readonly BootPrefetchTask[]
}

type Listener = () => void

const TASKS: readonly Omit<BootPrefetchTask, 'state'>[] = [
  { id: 'network', label: 'Monad network', critical: true },
  { id: 'programs', label: 'System programs', critical: true },
  { id: 'contracts', label: 'System contracts', critical: true },
  { id: 'canvas', label: 'Canvas baseline', critical: true },
  { id: 'frames', label: 'Frame index', critical: true },
  { id: 'rpc', label: 'Action RPC ranking', critical: true },
  { id: 'fees', label: 'Transaction fees', critical: true },
  { id: 'wallet', label: 'Wallet restore', critical: true },
  { id: 'account', label: 'Account data', critical: true },
  { id: 'art', label: 'Recent frame art', critical: false },
  { id: 'media', label: 'Recent Labs media', critical: false },
  { id: 'diagnostics', label: 'System diagnostics', critical: false },
]

const listeners = new Set<Listener>()
let snapshot: BootPrefetchSnapshot = {
  version: 0,
  tasks: TASKS.map((task) => ({ ...task, state: 'pending' })),
}
let started: Promise<void> | undefined
let stopAccountWatch: (() => void) | undefined
let observedAccount: Address | undefined
let pendingAccount: Address | undefined
let bootCriticalSettled = false
const accountWarmInflight = new Map<string, Promise<number[]>>()
const accountWarmCache = new Map<string, { frames: number[]; at: number }>()
const ACCOUNT_WARM_FRESH_MS = 8_000

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

async function runTask(id: string, metric: string, work: () => Promise<void>) {
  const startedAt = now()
  patchTask(id, { state: 'running', detail: undefined, ms: undefined })
  try {
    await work()
    const ms = now() - startedAt
    patchTask(id, { state: 'done', ms })
    recordPerf('boot-prefetch', metric, ms)
  } catch (error) {
    const ms = now() - startedAt
    patchTask(id, {
      state: 'error',
      detail: error instanceof Error ? error.message.slice(0, 80) : 'unavailable',
      ms,
    })
    recordPerf('boot-prefetch', metric, ms)
  }
}

function skipTask(id: string, detail: string) {
  patchTask(id, { state: 'skipped', detail, ms: 0 })
}

/** Tiny concurrency gate for boot/background reads. Static chunk downloads do not use it. */
function createLimiter(concurrency: number) {
  const queue: Array<() => void> = []
  let active = 0
  const drain = () => {
    while (active < concurrency && queue.length) {
      active += 1
      const start = queue.shift()!
      start()
    }
  }
  return <T>(work: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void work()
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            drain()
          })
      })
      drain()
    })
}

function waitForIdle(timeoutMs = 1_000) {
  if (typeof window === 'undefined') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const idle = (window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }).requestIdleCallback
    if (idle) idle(() => resolve(), { timeout: timeoutMs })
    else window.setTimeout(resolve, 0)
  })
}

function waitForNetwork(timeoutMs = 1_500) {
  const current = getBlockSnapshot()
  if (current.block > 0n) return Promise.resolve(current)
  return new Promise<ReturnType<typeof getBlockSnapshot>>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout>
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      stop()
      resolve(getBlockSnapshot())
    }
    const stop = subscribeBlocks(() => {
      if (getBlockSnapshot().block > 0n) finish()
    })
    timer = setTimeout(finish, timeoutMs)
  })
}

function waitForLiveReady(owner: Address, timeoutMs = 1_500) {
  const current = getLiveSnapshot()
  if (current.owner?.toLowerCase() === owner.toLowerCase() && !current.loading) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout>
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      stop()
      resolve()
    }
    const stop = subscribeLive(() => {
      const next = getLiveSnapshot()
      if (next.owner?.toLowerCase() === owner.toLowerCase() && !next.loading) finish()
    })
    timer = setTimeout(finish, timeoutMs)
  })
}

async function warmRecentFrameArt(ids: readonly number[]) {
  const recent = ids.filter((id) => id > 0).slice(0, 12)
  if (!recent.length) {
    skipTask('art', 'no owned frames')
    return
  }
  await runTask('art', 'boot-recent-art', async () => {
    await getFrameInfoBatch(recent)
    const images = await Promise.allSettled(recent.map((id) => getFrameImage(id)))
    const cached = images.filter((result) => result.status === 'fulfilled').length
    patchTask('art', { detail: `${cached}/${recent.length} thumbnails cached` })
  })
}

async function warmRecentMedia(owner: Address) {
  await runTask('media', 'boot-recent-media', async () => {
    const [contracts, labs, ownedCds] = await Promise.all([
      discoverContracts(),
      labsAddress(),
      loadOwnedCds(owner),
    ])
    const sources = await loadOwnedLabsSources(labs, owner)
    const camera = contracts.labs['block-camera']
    const photos = camera
      ? [...sources.entries()]
          .filter(([, source]) => source.toLowerCase() === camera.toLowerCase())
          .map(([id]) => BigInt(id))
          .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
          .slice(0, 6)
      : []
    const cds = ownedCds.slice(-6).reverse()
    if (!photos.length && !cds.length) {
      patchTask('media', { detail: 'no recent Labs media' })
      return
    }
    const [summaryResults, photoResults] = await Promise.all([
      Promise.allSettled(cds.map((id) => loadCdSummary(id))),
      Promise.allSettled(photos.map((id) => readLabsToken(id))),
    ])
    const cdCached = summaryResults.filter((result) => result.status === 'fulfilled').length
    const photoCached = photoResults.filter((result) => result.status === 'fulfilled').length
    patchTask('media', { detail: `${cdCached}/${cds.length} CDs · ${photoCached}/${photos.length} photos` })
  })
}

function sameAccount(a?: Address, b?: Address) {
  return a?.toLowerCase() === b?.toLowerCase()
}

function warmAccountShared(owner: Address) {
  const key = owner.toLowerCase()
  const cached = accountWarmCache.get(key)
  if (cached && Date.now() - cached.at < ACCOUNT_WARM_FRESH_MS) return Promise.resolve(cached.frames)
  const active = accountWarmInflight.get(key)
  if (active) return active
  const pending = warmAccountData(owner)
    .then((frames) => {
      accountWarmCache.set(key, { frames, at: Date.now() })
      return frames
    })
    .finally(() => {
      if (accountWarmInflight.get(key) === pending) accountWarmInflight.delete(key)
    })
  accountWarmInflight.set(key, pending)
  return pending
}

async function warmDiagnostics() {
  await runTask('diagnostics', 'boot-diagnostics', async () => {
    const { loadDxDiag } = await import('../diagnostics/loadDxDiag')
    await loadDxDiag(false)
  })
}

function schedulePostConnectWarm(owner: Address) {
  const startedAt = now()
  void warmAccountShared(owner)
    .then((frames) => {
      if (!sameAccount(getWalletSnapshot().account, owner)) return
      recordPerf('boot-prefetch', 'account-post-connect', now() - startedAt)
      return waitForIdle().then(() =>
        Promise.allSettled([warmRecentFrameArt(frames), warmRecentMedia(owner)]),
      )
    })
    .catch(() => undefined)
}

function ensureAccountPrefetchWatch() {
  if (stopAccountWatch) return
  observedAccount = getWalletSnapshot().account
  stopAccountWatch = subscribeWallet(() => {
    const owner = getWalletSnapshot().account
    if (sameAccount(owner, observedAccount)) return
    observedAccount = owner
    if (!owner) {
      pendingAccount = undefined
      return
    }
    if (!bootCriticalSettled) {
      pendingAccount = owner
      return
    }
    schedulePostConnectWarm(owner)
  })
}

async function warmAccountData(owner: Address) {
  const limit = createLimiter(2)
  setLiveOwner(owner)

  let ownedFrames: number[] = []
  let holderCount = 0
  const jobs = [
    limit(async () => {
      ownedFrames = await mineTokenIds(owner)
      await getFrameInfoBatch(ownedFrames.filter((id) => id > 0).slice(0, 24))
    }),
    limit(async () => {
      const identity = await readPassIdentity(owner)
      holderCount = identity.holderIds.length
    }),
    limit(async () => {
      await readPainterProfile(owner)
    }),
    limit(async () => {
      await prefetchQuestData(owner)
    }),
    limit(async () => {
      const labs = await labsAddress()
      await Promise.all([scanOwnedLabs(labs, owner), loadOwnedLabsSources(labs, owner)])
    }),
    waitForLiveReady(owner),
  ]
  const results = await Promise.allSettled(jobs)
  const unavailable = results.filter((result) => result.status === 'rejected').length
  patchTask('account', {
    detail: `${ownedFrames.filter((id) => id > 0).length} frames · ${holderCount} holder token${holderCount === 1 ? '' : 's'}${unavailable ? ` · ${unavailable} read${unavailable === 1 ? '' : 's'} unavailable` : ''}`,
  })
  return ownedFrames
}

/**
 * Make the visible boot screen do useful work. Static code is aggressive; public-chain reads are bounded
 * to two concurrent startup jobs; action-RPC probing stays in its separate low-latency lane. Every caller
 * joins this one pass, and the stores/caches warmed here are the same ones programs consume after boot.
 */
export function startBootPrefetch() {
  ensureAccountPrefetchWatch()
  if (started) return started
  const bootStarted = now()
  emit(TASKS.map((task) => ({ ...task, state: 'pending' })), {
    startedAt: Date.now(),
    criticalReadyAt: undefined,
    finishedAt: undefined,
  })

  started = (async () => {
    const readLimit = createLimiter(2)
    let optionalOwner: Address | undefined
    let optionalFrames: number[] = []

    // Static chunks are not RPC work, so download them immediately and aggressively.
    const programs = runTask('programs', 'boot-code-preload', async () => {
      await preloadLaunchPrograms((done, total, label) => {
        patchTask('programs', { detail: `${done}/${total} · ${label}` })
      })
    })

    // Wallet discovery/provider work is separate from the chain read lane.
    const walletOwner = restoreWallet(800)
      .catch(() => false)
      .then(() => getWalletSnapshot().account)
    const wallet = runTask('wallet', 'boot-wallet', async () => {
      const owner = await walletOwner
      patchTask('wallet', { detail: owner ? 'restored' : 'guest session' })
    })

    // Public reads are deliberately limited. Each readMany may itself be one Multicall3 eth_call.
    const chainStarted = now()
    const network = runTask('network', 'boot-chain-network', async () => {
      const head = await waitForNetwork()
      patchTask('network', {
        detail: head.block > 0n ? `#${head.block.toLocaleString('en-US')} · ${head.mode}` : 'degraded',
      })
    })
    const contracts = runTask('contracts', 'boot-chain-contracts', () =>
      readLimit(async () => {
        const value = await discoverContracts()
        const traceAddresses = [value.paint, value.pass, ...Object.values(value.labs)].filter(
          (address): address is Address => Boolean(address),
        )
        void startMonadTraceFeed(traceAddresses)
        await Promise.all([readCoreConstants(), readCoreStatus().catch(() => undefined)])
        patchTask('contracts', {
          detail: `${Object.values(value.labs).filter(Boolean).length} drivers`,
        })
      }),
    )
    const canvas = runTask('canvas', 'boot-chain-canvas', () =>
      readLimit(async () => {
        await startCanvasStore()
      }),
    )
    const frames = runTask('frames', 'boot-chain-frames', () =>
      readLimit(async () => {
        await refreshFrameIndex()
      }),
    )
    const chainReady = Promise.allSettled([network, contracts, canvas, frames]).then(() => {
      recordPerf('boot-prefetch', 'boot-chain', now() - chainStarted)
    })

    // The action lane is intentionally independent from background public reads.
    const rpc = runTask('rpc', 'boot-action-rpc', async () => {
      await probeActionRpcs()
      const measured = getActionRpcSnapshot().endpoints.filter((endpoint) => endpoint.samples > 0).length
      patchTask('rpc', { detail: `${measured} endpoint${measured === 1 ? '' : 's'} measured` })
    })
    const fees = runTask('fees', 'boot-fees', async () => {
      await rpc
      await prewarmActionFees(false)
    })

    // Account-specific reads start after the shared contract/frame groundwork and silent wallet restore.
    const account = runTask('account', 'boot-account-prefetch', async () => {
      const owner = await walletOwner
      if (!owner) {
        patchTask('account', { detail: 'guest session' })
        return
      }
      await Promise.allSettled([contracts, canvas, frames])
      optionalFrames = await warmAccountShared(owner)
      optionalOwner = owner
      if (sameAccount(pendingAccount, owner)) pendingAccount = undefined
    })

    const critical = [programs, wallet, network, contracts, canvas, frames, chainReady, rpc, fees, account]
    await Promise.allSettled(critical)
    const criticalMs = now() - bootStarted
    recordPerf('boot-prefetch', 'boot-critical', criticalMs)
    emit(snapshot.tasks, { criticalReadyAt: Date.now() })
    bootCriticalSettled = true
    const queuedOwner = pendingAccount
    pendingAccount = undefined
    if (queuedOwner && sameAccount(getWalletSnapshot().account, queuedOwner)) schedulePostConnectWarm(queuedOwner)

    // Optional work never competes with critical startup. Hand it to the browser's idle lane after
    // readiness; if the desktop already appeared because of the cap, this remains bounded background work.
    if (!optionalOwner) {
      skipTask('art', 'no account data')
      skipTask('media', 'no account data')
    }
    const owner = optionalOwner
    const framesToWarm = optionalFrames
    void waitForIdle()
      .then(() =>
        Promise.allSettled([
          warmDiagnostics(),
          ...(owner ? [warmRecentFrameArt(framesToWarm), warmRecentMedia(owner)] : []),
        ]),
      )
      .then(() => emit(snapshot.tasks, { finishedAt: Date.now() }))
  })()

  return started
}

export function __resetBootPrefetchForTests() {
  started = undefined
  stopAccountWatch?.()
  stopAccountWatch = undefined
  observedAccount = undefined
  pendingAccount = undefined
  bootCriticalSettled = false
  accountWarmInflight.clear()
  accountWarmCache.clear()
  snapshot = {
    version: 0,
    tasks: TASKS.map((task) => ({ ...task, state: 'pending' })),
  }
  listeners.clear()
}
