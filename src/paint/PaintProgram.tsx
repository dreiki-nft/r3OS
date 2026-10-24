import { helpHash } from '../os/helpTopics'
import { paintedText, type LastPaint } from './paintedText'
import { overheatReason } from './explain'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react'
import { bytesToHex, hexToBytes, type Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { decodeCoreEventLog } from '../chain/coreLogs'
import { config } from '../chain/config'
import { demoConstants, discoverContracts, readCoreConstants } from '../chain/contracts'
import { friendlyError } from '../chain/errors'
import { parseManualIds, resolveHolderIds } from '../chain/holders'
import { markProgramDataReady, recordPerf, recordPerfSampled, startPerf } from '../chain/perf'
import { quoteAction, sendAction, type ActionOptions, type ActionQuote } from '../chain/tx'
import {
  connectWallet,
  getWalletSnapshot,
  subscribeWallet,
  switchToMonad,
  usingGuestWallet,
  walletOnCorrectChain,
} from '../chain/wallet'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import {
  formatBurnerBalance,
  formatLiveTime,
  getLiveSnapshot,
  liveActive,
  liveTimeLeftMs,
  MAX_BURNER_FUND,
  setLiveOwner,
  subscribeLive,
  unitsLeft,
} from '../live/liveStore'
import { createStrokeQueue } from '../live/paintQueue'
import { HOVER_REFRESH_MS, hoverReadDelay } from './hoverRead'
import { gasHint } from './gasHint'
import { maxCostWei } from '../chain/gas'
import { startLiveQuick, type QuickProgress } from '../live/quickStart'
import { drawEllipse, drawLine, drawRect, floodFill, type Point } from '../lib/paintEngine'
import { BACKGROUND_CHOICES, PALETTE } from '../lib/palette'
import { encodeChangedRuns } from '../lib/patch'
import { clearAssistantTip, setAssistantTip } from '../os/assistantStore'
import { pushBalloon } from '../os/balloons'
import { openProgram } from '../os/programs'
import { playSound } from '../os/sound'
import { requestFloppy } from '../os/floppy'
import { applyWallpaperResource } from '../os/wallpaper'
import { Button } from '../os/ui/Button'
import { FeeNote } from '../os/ui/FeeNote'
import { MenuBar } from '../os/ui/MenuBar'
import { MessageBox } from '../os/ui/MessageBox'
import { WalletChooser } from '../os/WalletChooser'
import { useWindowActive } from '../os/Window'
import { closeWindow } from '../os/windows'
import { regionsFromRunList } from '../xray/regions'
import { BudgetMeter, type BudgetState } from './BudgetMeter'
import { spendObservedBudget } from './budget'
import { isPhoneScreen } from '../os/phone'
import { CanvasView } from './CanvasView'
import {
  agoLabel,
  focusPaint,
  getPresenceSnapshot,
  PRESENCE_WINDOW_BLOCKS,
  setPresenceAccount,
  subscribePresence,
  summarize,
  windowLabel,
} from './presence'
import {
  applyReceiptActivity,
  beginInFlight,
  clearPending,
  dropInFlight,
  getActivityFeedSnapshot,
  getCanvasSnapshot,
  getTileCacheSnapshot,
  readTileState,
  readTileStates,
  setWorking,
  settleInFlightFromReceipt,
  subscribeCanvas,
  subscribeCanvasActivity,
  subscribeTileCache,
} from './canvasStore'
import { decayTileHeat, previewPaintCost, type TilePreviewState } from './cost'
import { applyRedo, applyUndo } from './history'
import { observedRegionUsage } from './livePreflight'
import { PaletteBar } from './PaletteBar'
import { bytesToRuns, runsToBytes, splitPaintRuns } from './split'
import { drawStrokeSegment, protectOutline } from './strokes'
import { Toolbox, type Tool } from './Toolbox'
import { painterName, usePainterNames } from '../chain/names'
import { recordStrokeIssue, type StrokeIssueKind } from './strokeLog'

const EMPTY_BUDGET: BudgetState = { hourly: 0, hourlyLimit: 0, holder: 0, total: 0, activeDays: 0 }

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

function tileFor(point: Point) {
  return (point.y >> 4) * 16 + (point.x >> 4)
}

function tilesFromDiff(before: Uint8Array, after: Uint8Array) {
  const out = new Set<number>()
  for (let index = 0; index < after.length; index++) {
    if (after[index] === before[index]) continue
    const x = index & 255
    const y = index >> 8
    out.add((y >> 4) * 16 + (x >> 4))
  }
  return out
}

export function PaintProgram() {
  const active = useWindowActive()
  const canvas = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const tileSnapshot = useSyncExternalStore(subscribeTileCache, getTileCacheSnapshot)
  const presence = useSyncExternalStore(subscribePresence, getPresenceSnapshot)
  usePainterNames()
  // A judge's guest wallet signs locally with no popups, so the Live Mode offer is replaced by a note.
  const guest = Boolean(wallet.account) && usingGuestWallet()
  const together = summarize(presence.strokes, block.block)
  const togetherWindow = windowLabel(PRESENCE_WINDOW_BLOCKS, block.blockTimeMs)
  const me = wallet.account?.toLowerCase()
  const togetherText = together.painters ? ` · ${together.painters} active recently` : ''
  useEffect(() => setPresenceAccount(wallet.account), [wallet.account])
  useEffect(() => {
    if (canvas.status !== 'offline') markProgramDataReady('paint')
  }, [canvas.status])

  const [tool, setTool] = useState<Tool>('pencil')
  const [colour, setColour] = useState(1)
  const [bgColour, setBgColour] = useState(0)
  const [size, setSize] = useState(1)
  // The pencil keeps its own size (1 px by default, for detail) so switching to the brush doesn't change it.
  const [pencilSize, setPencilSize] = useState(1)
  const strokeSize = tool === 'pencil' ? pencilSize : size
  // 0 = fit the whole canvas to the window; 1/2/4/8 = fixed zoom (the well scrolls).
  const [zoom, setZoom] = useState(0)
  const [grid, setGrid] = useState(false)
  const [protectedView, setProtected] = useState(false)
  const [heatView, setHeatView] = useState(false)
  const [hover, setHover] = useState<Point>({ x: 0, y: 0 })
  const [dragStart, setDragStart] = useState<Point>()
  const [undoStack, setUndoStack] = useState<Uint8Array[]>([])
  const [redoStack, setRedoStack] = useState<Uint8Array[]>([])
  const [manualIds, setManualIds] = useState('')
  const [holderIds, setHolderIds] = useState<bigint[]>([])
  const [holderDialog, setHolderDialog] = useState(false)
  const [walletDialog, setWalletDialog] = useState(false)
  const [walletIntent, setWalletIntent] = useState<'paint' | 'live'>('paint')
  const [backgroundPicker, setBackgroundPicker] = useState(false)
  const [backgroundCandidate, setBackgroundCandidate] = useState(canvas.backgroundColor)
  const [budget, setBudget] = useState<BudgetState>(EMPTY_BUDGET)
  const [constants, setConstants] = useState(demoConstants)
  const [paintQuote, setPaintQuote] = useState<ActionQuote>()
  // The newest real stroke cost, kept after the stroke is sent so "Need MON?" can still count strokes left.
  const [lastStrokeCost, setLastStrokeCost] = useState<bigint>()
  useEffect(() => {
    if (paintQuote) setLastStrokeCost(maxCostWei(paintQuote.gasLimit, paintQuote.maxFeePerGas))
  }, [paintQuote])
  const [quotes, setQuotes] = useState<Record<string, ActionQuote | string>>({})
  const [busy, setBusy] = useState(false)
  const [txState, setTxState] = useState<'signing' | 'sent' | 'confirmed'>()
  const [liveStarting, setLiveStarting] = useState(false)
  const [liveQuick, setLiveQuick] = useState<QuickProgress>()
  const [lastPaint, setLastPaint] = useState<LastPaint>()
  // The receipt-inclusion line stays for a few seconds, then the status bar goes back to normal.
  useEffect(() => {
    if (!lastPaint) return
    const timer = window.setTimeout(() => setLastPaint(undefined), 12_000)
    return () => window.clearTimeout(timer)
  }, [lastPaint])
  const [autoPaint, setAutoPaint] = useState(true)
  const [progress, setProgress] = useState<{ current: number; total: number; stopping?: boolean } | null>(
    null,
  )
  const [box, setBox] = useState<{
    title: string
    message: string
    kind?: 'info' | 'warning' | 'error'
    details?: string
  }>()
  const [gasConfirm, setGasConfirm] = useState<{
    oldQuote: ActionQuote
    nextQuote: ActionQuote
    resolve: (ok: boolean) => void
  }>()

  const cancelRef = useRef(false)
  const strokeLast = useRef<Point | null>(null)
  const strokeBuffer = useRef<Uint8Array | null>(null)
  const renderFrame = useRef<number | undefined>(undefined)
  const pendingTiles = useRef(new Set<number>())
  const pendingTimer = useRef<number | undefined>(undefined)
  const paintChunksRef = useRef<(andFrame?: boolean) => Promise<void>>(async () => undefined)
  const strokeQueueRef = useRef<ReturnType<typeof createStrokeQueue> | undefined>(undefined)
  // RegionBusy usually means someone else filled that region's per-block allowance a moment ago. Live
  // strokes try again by themselves a few times before giving up, instead of popping an error at once.
  const regionRetriesRef = useRef(0)
  const liveQuoteRef = useRef<{ hex: string; quote: Promise<ActionQuote> } | undefined>(undefined)
  const paintQuoteHexRef = useRef<string | undefined>(undefined)
  const budgetReconcileTimer = useRef<number | undefined>(undefined)
  if (!strokeQueueRef.current) {
    strokeQueueRef.current = createStrokeQueue(() => paintChunksRef.current(false))
  }
  const lastHeatFullRefresh = useRef<bigint>(-100n)
  const undoStackRef = useRef<Uint8Array[]>([])
  const redoStackRef = useRef<Uint8Array[]>([])
  const holderKey = useMemo(() => holderIds.map(String).join(','), [holderIds])
  const stableHolderIds = useMemo(() => holderKey.split(',').filter(Boolean).map(BigInt), [holderKey])
  const budgetKey = wallet.account ? `${wallet.account.toLowerCase()}:${holderKey}` : ''
  const budgetKeyRef = useRef(budgetKey)
  const budgetRefreshInFlight = useRef<{ key: string; promise: Promise<void> } | undefined>(undefined)
  // The UTC hour the shown budget belongs to, so a stroke right after the refill isn't judged by last hour's zero.
  const budgetHourRef = useRef(-1)
  budgetKeyRef.current = budgetKey
  const patch = useMemo(
    () => encodeChangedRuns(canvas.background, canvas.working),
    [canvas.background, canvas.working],
  )
  const tileStates = useMemo(() => {
    const result = new Map<number, TilePreviewState>()
    for (const [tile, entry] of tileSnapshot.map) {
      result.set(
        tile,
        decayTileHeat(entry.state, entry.block, block.block, constants.TILE_COOLDOWN_PER_BLOCK),
      )
    }
    return result
  }, [tileSnapshot, block.block, constants.TILE_COOLDOWN_PER_BLOCK])
  const cost = useMemo(
    () =>
      previewPaintCost(
        canvas.background,
        canvas.working,
        canvas.outline,
        tileStates,
        Number(constants.MAX_TILE_HEAT),
      ),
    [canvas.background, canvas.working, canvas.outline, tileStates, constants.MAX_TILE_HEAT],
  )
  const previewInputMode =
    tool === 'fill'
      ? 'down'
      : tool === 'pencil' || tool === 'brush' || tool === 'eraser'
        ? 'stroke'
        : tool === 'line' || tool === 'rect' || tool === 'ellipse'
          ? 'up'
          : undefined

  const reason = cost.overheatTiles.length
    ? overheatReason(cost.overheat, constants, block.blockTimeMs)
    : cost.units > budget.total
      ? `needs ${cost.units} units; ${budget.total} available`
      : patch.pixelWrites === 0
        ? 'nothing to paint'
        : undefined

  const scheduleWorking = useCallback((next: Uint8Array) => {
    strokeBuffer.current = next
    if (renderFrame.current != null) return
    renderFrame.current = requestAnimationFrame(() => {
      renderFrame.current = undefined
      if (strokeBuffer.current) setWorking(strokeBuffer.current.slice())
    })
  }, [])

  const recordPendingTiles = useCallback((tiles: Iterable<number>) => {
    for (const tile of tiles) pendingTiles.current.add(tile)
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current)
    pendingTimer.current = window.setTimeout(() => {
      const list = [...pendingTiles.current]
      pendingTiles.current.clear()
      void readTileStates(list, getBlockSnapshot().block)
    }, 300)
  }, [])

  const setHistory = useCallback((undo: Uint8Array[], redo: Uint8Array[]) => {
    undoStackRef.current = undo
    redoStackRef.current = redo
    setUndoStack(undo)
    setRedoStack(redo)
  }, [])

  const pushUndo = useCallback(() => {
    const undo = [...undoStackRef.current.slice(-29), getCanvasSnapshot().working.slice()]
    setHistory(undo, [])
  }, [setHistory])

  const undo = useCallback(() => {
    const current = getCanvasSnapshot().working
    const result = applyUndo({ undo: undoStackRef.current, redo: redoStackRef.current }, current)
    if (!result.changed) return
    setHistory(result.stacks.undo, result.stacks.redo)
    setWorking(result.working)
  }, [setHistory])

  const redo = useCallback(() => {
    const current = getCanvasSnapshot().working
    const result = applyRedo({ undo: undoStackRef.current, redo: redoStackRef.current }, current)
    if (!result.changed) return
    setHistory(result.stacks.undo, result.stacks.redo)
    setWorking(result.working)
  }, [setHistory])

  useEffect(() => {
    void readCoreConstants().then(setConstants)
  }, [])

  useEffect(() => setLiveOwner(wallet.account), [wallet.account])

  const isLive = liveActive(live)

  // Every stroke that doesn't land gets a line in DXDIAG › Paint problems (src/paint/strokeLog.ts), with the
  // block and whether a storm was on, so a "Live Mode wouldn't paint" report comes with its real reason.
  const noteStroke = (kind: StrokeIssueKind, px: number, reason: unknown) =>
    recordStrokeIssue({
      kind,
      px,
      reason,
      block: getBlockSnapshot().block.toString(),
      storm: getBlockSnapshot().storm,
      live: isLive,
    })

  useEffect(() => {
    if (isLive) {
      setAutoPaint(true)
      setLiveStarting(false)
    }
  }, [isLive])

  const startLiveFor = useCallback(
    async (owner?: Address) => {
      const account = owner ?? wallet.account
      if (!account) {
        setWalletIntent('live')
        setWalletDialog(true)
        return
      }
      if (isLive || liveStarting) return
      // WalletChooser can hand us the newly connected account before React has rendered the new wallet snapshot.
      // Point the Live store at it immediately so the successful startSession receipt can flip the UI to LIVE.
      setLiveOwner(account)
      setLiveStarting(true)
      setLiveQuick({ phase: 'prepare', prompts: 2 })
      try {
        await startLiveQuick(account, setLiveQuick)
        setAssistantTip('Live Mode is on. Strokes now land onchain without wallet popups. No Undo.')
      } catch (caught) {
        const friendly =
          (caught as { friendly?: ReturnType<typeof friendlyError> }).friendly ??
          friendlyError(caught, 'startSession')
        setBox({
          title: 'Live Mode',
          message: friendly.message,
          kind: friendly.rejected ? 'info' : 'error',
        })
        setLiveQuick(undefined)
      } finally {
        setLiveStarting(false)
      }
    },
    [wallet.account, isLive, liveStarting],
  )

  const startLiveFromPaint = useCallback(() => startLiveFor(), [startLiveFor])

  const liveButtonLabel = isLive
    ? 'LIVE · Manage…'
    : liveStarting
      ? liveQuick?.phase === 'sign'
        ? 'LIVE · Sign…'
        : liveQuick?.phase === 'fund'
          ? 'LIVE · Fund…'
          : liveQuick?.phase === 'start'
            ? 'LIVE · Starting…'
            : 'LIVE · Preparing…'
      : 'Start Live Mode'

  const liveUnits = unitsLeft(live.session)
  const liveTime = formatLiveTime(liveTimeLeftMs(live.session))
  const latestRemote = presence.strokes.find((stroke) => !me || stroke.owner !== me)
  const remoteNow = Boolean(
    latestRemote && block.block >= latestRemote.block && block.block - latestRemote.block <= 50n,
  )
  const lastExplorer =
    lastPaint?.hash && config.explorerUrl ? `${config.explorerUrl}/tx/${lastPaint.hash}` : undefined
  const remoteExplorer =
    latestRemote?.tx && config.explorerUrl ? `${config.explorerUrl}/tx/${latestRemote.tx}` : undefined
  const remoteRenderProbe =
    canvas.renderProbe && (!me || canvas.renderProbe.owner !== me)
      ? { key: canvas.renderProbe.key, observedAt: canvas.renderProbe.observedAt }
      : undefined
  const recordRemoteRender = useCallback((_key: string, latencyMs: number) => {
    recordPerf('remote-paint', 'websocket event → rendered canvas', latencyMs)
  }, [])

  const refreshHolderIds = useCallback(async () => {
    if (!wallet.account || !publicClient) return
    const contracts = await discoverContracts()
    if (!contracts.r3tards) return
    const ids = await resolveHolderIds(
      publicClient,
      contracts.r3tards,
      wallet.account,
      parseManualIds(manualIds),
    )
    const key = ids.map(String).join(',')
    setHolderIds((current) => (current.map(String).join(',') === key ? current : ids))
  }, [wallet.account, manualIds])

  useEffect(() => {
    void refreshHolderIds()
  }, [refreshHolderIds])

  const refreshBudget = useCallback(() => {
    if (!wallet.account || !publicClient || !config.paintAddress) return Promise.resolve()
    const requestKey = `${wallet.account.toLowerCase()}:${holderKey}`
    if (budgetRefreshInFlight.current?.key === requestKey) return budgetRefreshInFlight.current.promise

    const owner = wallet.account
    const holderIds = stableHolderIds
    const pending = (async () => {
      try {
        const values = (await publicClient.readContract({
          address: config.paintAddress!,
          abi: R3OS_PAINT_ABI,
          functionName: 'budgetOf',
          args: [owner, holderIds],
        })) as readonly bigint[]
        if (budgetKeyRef.current !== requestKey) return
        budgetHourRef.current = Math.floor(Date.now() / 3_600_000)
        setBudget({
          hourly: Number(values[0]),
          holder: Number(values[1]),
          total: Number(values[2]),
          hourlyLimit: Number(values[3]),
          activeDays: Number(values[4]),
        })
      } catch {
        // Stale ids are corrected by the next holder refresh.
      }
    })().finally(() => {
      if (budgetRefreshInFlight.current?.promise === pending) budgetRefreshInFlight.current = undefined
    })
    budgetRefreshInFlight.current = { key: requestKey, promise: pending }
    return pending
  }, [wallet.account, holderKey])

  useEffect(() => {
    void refreshBudget()
  }, [refreshBudget])

  const scheduleBudgetReconcile = useCallback(() => {
    if (budgetReconcileTimer.current != null) window.clearTimeout(budgetReconcileTimer.current)
    budgetReconcileTimer.current = window.setTimeout(() => {
      budgetReconcileTimer.current = undefined
      void refreshBudget()
    }, 1_200)
  }, [refreshBudget])

  useEffect(
    () =>
      subscribeCanvasActivity((activity) => {
        if (!wallet.account) return
        const account = wallet.account.toLowerCase()
        if (activity.eventName === 'Painted' && activity.owner?.toLowerCase() === account) {
          const units = activity.units
          if (units != null) setBudget((current) => spendObservedBudget(current, units))
          // The event already tells us exactly how many units the contract spent. Mirror it locally so a
          // rapid Live burst does not issue budgetOf after every stroke; one delayed read repairs any drift.
          scheduleBudgetReconcile()
        }
      }),
    [wallet.account, scheduleBudgetReconcile],
  )

  useEffect(
    () => () => {
      if (budgetReconcileTimer.current != null) window.clearTimeout(budgetReconcileTimer.current)
    },
    [],
  )

  useEffect(() => {
    let hour = Math.floor(Date.now() / 3_600_000)
    const timer = window.setInterval(() => {
      const next = Math.floor(Date.now() / 3_600_000)
      if (next !== hour) {
        hour = next
        void refreshBudget()
      }
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [refreshBudget])

  // The "under cursor" readout: paced so a resting cursor over busy paint doesn't read every block.
  const hoverRead = useRef({ tile: -1, at: 0 })
  useEffect(() => {
    const tile = tileFor(hover)
    const read = () => {
      if (document.hidden) return
      hoverRead.current = { tile, at: Date.now() }
      void readTileState(tile, getBlockSnapshot().block)
    }
    let interval: number | undefined
    const timer = window.setTimeout(
      () => {
        read()
        interval = window.setInterval(read, HOVER_REFRESH_MS)
      },
      hoverReadDelay(tile, hoverRead.current, Date.now()),
    )
    return () => {
      window.clearTimeout(timer)
      if (interval) window.clearInterval(interval)
    }
  }, [tileFor(hover)])

  useEffect(() => {
    if (!heatView) return
    if (block.block - lastHeatFullRefresh.current < 20n && lastHeatFullRefresh.current >= 0n) return
    lastHeatFullRefresh.current = block.block
    void readTileStates(
      Array.from({ length: 256 }, (_, index) => index),
      block.block,
    )
  }, [heatView, block.block])

  useEffect(() => {
    setPaintQuote(undefined)
    paintQuoteHexRef.current = undefined
    if (!wallet.account || !config.paintAddress || patch.pixelWrites === 0 || config.demo) return
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        const quotePromise =
          isLive && liveQuoteRef.current?.hex === patch.hex
            ? liveQuoteRef.current.quote
            : quoteAction({
                kind: 'corePaint',
                address: config.paintAddress!,
                abi: R3OS_PAINT_ABI,
                functionName: 'paint',
                args: [patch.hex, stableHolderIds],
                account: wallet.account!,
                pixels: patch.pixelWrites,
                signer: isLive ? 'burner' : 'wallet',
              })
        if (isLive) liveQuoteRef.current = { hex: patch.hex, quote: quotePromise }
        void quotePromise
          .then((quote) => {
            if (!cancelled) {
              paintQuoteHexRef.current = patch.hex
              setPaintQuote(quote)
            }
          })
          .catch(() => {
            if (!cancelled) setPaintQuote(undefined)
          })
      },
      isLive ? 40 : 100,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [patch.hex, patch.pixelWrites, wallet.account, holderKey, isLive])

  useEffect(() => {
    if (!active) return
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        if (isLive) {
          setAssistantTip('Live Mode has no Undo. Sent strokes are reconciled from onchain state.')
          return
        }
        undo()
      } else if (
        (event.ctrlKey && event.key.toLowerCase() === 'y') ||
        (command && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
        event.preventDefault()
        if (isLive) {
          setAssistantTip('Live Mode has no Redo. Paint over a pixel with a new transaction instead.')
          return
        }
        redo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, undo, redo, isLive])

  const confirmHigherCost = (oldQuote: ActionQuote, nextQuote: ActionQuote) =>
    new Promise<boolean>((resolve) => setGasConfirm({ oldQuote, nextQuote, resolve }))

  const quoteKey = (functionName: string, suffix = '') => `${functionName}:${holderKey}:${suffix}`

  async function lazyQuote(key: string, options: ActionOptions) {
    const current = quotes[key]
    if (typeof current !== 'string' && current && block.block <= current.quotedAtBlock + 20n) return current
    setQuotes((all) => ({ ...all, [key]: 'quoting…' }))
    try {
      const next = await quoteAction(options)
      setQuotes((all) => ({ ...all, [key]: next }))
      return next
    } catch (error) {
      const text = friendlyError(error, options.functionName).message
      setQuotes((all) => ({ ...all, [key]: text }))
      return undefined
    }
  }

  function quoteText(key: string) {
    const value = quotes[key]
    return typeof value === 'string' ? value : (value?.maxCost ?? 'quoting…')
  }

  const quoteMenus = (menu: string) => {
    if (!wallet.account || !config.paintAddress || config.demo) return
    if (menu === 'File') {
      void lazyQuote(quoteKey('mintFrame'), {
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName: 'mintFrame',
        account: wallet.account,
      })
      if (patch.pixelWrites > 0) {
        void lazyQuote(quoteKey('paintAndMintFrame', patch.hex), {
          kind: 'paintAndMintFrame',
          address: config.paintAddress,
          abi: R3OS_PAINT_ABI,
          functionName: 'paintAndMintFrame',
          args: [patch.hex, stableHolderIds],
          account: wallet.account,
          pixels: patch.pixelWrites,
        })
      }
    }
    if (menu === 'Colors') {
      if (canvas.face !== 1)
        void lazyQuote(quoteKey('setFace', '1'), {
          kind: 'estimate',
          address: config.paintAddress,
          abi: R3OS_PAINT_ABI,
          functionName: 'setFace',
          args: [1, stableHolderIds],
          account: wallet.account,
        })
      if (canvas.face !== 7)
        void lazyQuote(quoteKey('setFace', '7'), {
          kind: 'estimate',
          address: config.paintAddress,
          abi: R3OS_PAINT_ABI,
          functionName: 'setFace',
          args: [7, stableHolderIds],
          account: wallet.account,
        })
    }
  }

  useEffect(() => {
    if (!backgroundPicker || !wallet.account || !config.paintAddress || config.demo) return
    // The current colour can't be set again (the contract reverts NoChange): nothing to quote until one is picked.
    if (backgroundCandidate === canvas.backgroundColor) return
    void lazyQuote(quoteKey('setBackground', String(backgroundCandidate)), {
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'setBackground',
      args: [backgroundCandidate, stableHolderIds],
      account: wallet.account,
    })
  }, [backgroundPicker, backgroundCandidate, canvas.backgroundColor, wallet.account, holderKey])

  function commit(mutator: (buffer: Uint8Array) => void) {
    pushUndo()
    const next = canvas.working.slice()
    mutator(next)
    protectOutline(next, canvas.outline, canvas.working)
    recordPendingTiles(tilesFromDiff(canvas.working, next))
    setWorking(next)
  }

  const startStroke = (point: Point) => {
    const editStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
    pushUndo()
    const next = canvas.working.slice()
    drawStrokeSegment(next, point, point, tool as 'pencil' | 'brush' | 'eraser', colour, strokeSize)
    protectOutline(next, canvas.outline, canvas.working)
    strokeLast.current = point
    strokeBuffer.current = next
    recordPendingTiles([tileFor(point)])
    scheduleWorking(next)
    const editEnded = typeof performance === 'undefined' ? Date.now() : performance.now()
    recordPerfSampled('paint-edit', 'stroke mutation + protection', editEnded - editStarted, 8)
  }

  const continueStroke = (point: Point) => {
    if (!strokeLast.current || !strokeBuffer.current) return
    const editStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
    const before = strokeBuffer.current.slice()
    drawStrokeSegment(
      strokeBuffer.current,
      strokeLast.current,
      point,
      tool as 'pencil' | 'brush' | 'eraser',
      colour,
      strokeSize,
    )
    protectOutline(strokeBuffer.current, canvas.outline, before)
    recordPendingTiles(tilesFromDiff(before, strokeBuffer.current))
    strokeLast.current = point
    scheduleWorking(strokeBuffer.current)
    const editEnded = typeof performance === 'undefined' ? Date.now() : performance.now()
    recordPerfSampled('paint-edit', 'stroke mutation + protection', editEnded - editStarted, 8)
  }

  const endStroke = () => {
    if (renderFrame.current != null) {
      cancelAnimationFrame(renderFrame.current)
      renderFrame.current = undefined
    }
    if (strokeBuffer.current) setWorking(strokeBuffer.current.slice())
    strokeBuffer.current = null
    strokeLast.current = null
  }

  // A pinch-zoom on a phone starts with one finger already drawing. The browser then takes the touch over, and
  // that half-stroke must not be kept (in Live Mode it would be sent onchain as a stray dot or line).
  const cancelStroke = () => {
    if (renderFrame.current != null) {
      cancelAnimationFrame(renderFrame.current)
      renderFrame.current = undefined
    }
    setDragStart(undefined)
    if (!strokeBuffer.current) return
    strokeBuffer.current = null
    strokeLast.current = null
    const stack = undoStackRef.current
    const before = stack[stack.length - 1]
    if (!before) return
    setHistory(stack.slice(0, -1), redoStackRef.current)
    setWorking(before.slice())
  }

  // If a send is still going after 30 s, something is stuck (a wallet that never answered, a request that never
  // came back): say so in the log, because every stroke after it waits behind it.
  useEffect(() => {
    if (!busy) return
    const timer = window.setTimeout(
      () => noteStroke('held', patch.pixelWrites, 'a send has been in progress for 30 s; new strokes wait behind it'),
      30_000,
    )
    return () => window.clearTimeout(timer)
  }, [busy])

  const scheduleAutoPaint = () => {
    if (!isLive || !autoPaint) {
      const waiting = encodeChangedRuns(getCanvasSnapshot().background, getCanvasSnapshot().working).pixelWrites
      if (waiting > 0 && wallet.account && !guest) {
        if (isLive) noteStroke('held', waiting, 'auto-paint is off: strokes wait for the Paint button')
        else if (live.burner)
          noteStroke(
            'held',
            waiting,
            `live mode not active in this tab (${
              live.loading
                ? 'still loading the session'
                : !live.session
                  ? 'no session read yet'
                  : live.session.revoked
                    ? 'session revoked'
                    : getBlockSnapshot().block > live.session.expiryBlock
                      ? 'session expired'
                      : 'session inactive'
            })`,
          )
      }
      return
    }
    // Pointer-up is the earliest moment we know the final stroke bytes. Start eth_estimateGas immediately
    // and hide most of that RTT behind the short coalescing window instead of waiting for React's quote effect.
    if (wallet.account && config.paintAddress && !config.demo) {
      const current = getCanvasSnapshot()
      const nextPatch = encodeChangedRuns(current.background, current.working)
      if (nextPatch.pixelWrites > 0) {
        const quotePromise = quoteAction({
          kind: 'corePaint',
          address: config.paintAddress,
          abi: R3OS_PAINT_ABI,
          functionName: 'paint',
          args: [nextPatch.hex, stableHolderIds],
          account: wallet.account,
          pixels: nextPatch.pixelWrites,
          signer: 'burner',
        })
        liveQuoteRef.current = { hex: nextPatch.hex, quote: quotePromise }
        void quotePromise
          .then((quote) => {
            const latest = getCanvasSnapshot()
            const latestPatch = encodeChangedRuns(latest.background, latest.working)
            if (latestPatch.hex !== nextPatch.hex) return
            paintQuoteHexRef.current = nextPatch.hex
            setPaintQuote(quote)
          })
          .catch(() => undefined)
      }
    }
    strokeQueueRef.current?.schedule()
  }

  const onDown = (point: Point, event: PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'picker') {
      const index = point.y * 256 + point.x
      setColour(canvas.outline[index] ? canvas.face : canvas.working[index])
      return
    }
    if (tool === 'zoom') {
      setZoom((current) => (current === 0 ? 2 : current >= 8 ? 0 : current * 2))
      return
    }
    if (tool === 'fill') {
      commit((buffer) => {
        const temporary = buffer.slice()
        for (let index = 0; index < canvas.outline.length; index++)
          if (canvas.outline[index]) temporary[index] = 255
        floodFill(temporary, point, colour)
        for (let index = 0; index < temporary.length; index++)
          if (temporary[index] !== 255) buffer[index] = temporary[index]
      })
      scheduleAutoPaint()
      return
    }
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      startStroke(point)
      return
    }
    setDragStart(point)
    if (event.shiftKey) playSound('select')
  }

  const onMove = (point: Point, event: PointerEvent<HTMLCanvasElement>) => {
    if (event.buttons && (tool === 'pencil' || tool === 'brush' || tool === 'eraser')) continueStroke(point)
  }

  const onUp = (point: Point) => {
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      endStroke()
      scheduleAutoPaint()
      return
    }
    if (!dragStart) return
    const start = dragStart
    setDragStart(undefined)
    if (tool === 'line') commit((buffer) => drawLine(buffer, start, point, colour, size))
    if (tool === 'rect') commit((buffer) => drawRect(buffer, start, point, colour, false, size))
    if (tool === 'ellipse') commit((buffer) => drawEllipse(buffer, start, point, colour, false, size))
    scheduleAutoPaint()
  }

  const hoverTile = tileFor(hover)
  const hoverState = tileSnapshot.map.get(hoverTile)?.state
  const hoverIndex = hover.y * 256 + hover.x
  const hoverBase = canvas.background[hoverIndex]
  const hoverBit = BigInt((hover.y & 15) * 16 + (hover.x & 15))
  const hoverWet = hoverState ? ((hoverState.wetBitmap >> hoverBit) & 1n) !== 0n : false
  const hoverCost = hoverBase === 0 ? 1 : hoverWet ? 1 : 2
  const hoverLabel = hoverBase === 0 ? 'blank' : hoverWet ? 'wet' : 'dry'
  const heatRatio = hoverState ? hoverState.heat / Math.max(1, Number(constants.MAX_TILE_HEAT)) : 0
  const heatBars = Math.max(0, Math.min(5, Math.ceil(heatRatio * 5)))
  const heatLabel = heatRatio >= 0.8 ? 'hot' : heatRatio >= 0.4 ? 'warm' : 'cooling'
  const seasonSeconds = Number(constants.SEASON_START + canvas.season * constants.SEASON_LENGTH)
  const day = Math.max(1, Math.floor((Date.now() / 1_000 - seasonSeconds) / 86_400) + 1)

  function liveRegionUsage() {
    return observedRegionUsage(getActivityFeedSnapshot().items, block.block)
  }

  // Painting goes through Live Mode: a connected wallet starts it once, then every stroke is sent by the
  // session key with no popup. Guest wallets (for judges) already sign locally, so they paint directly.
  const needsLive = Boolean(wallet.account) && !guest && !isLive

  // Asking the wallet to switch networks can be refused or fail; either way the person hears about it
  // (it used to fail silently, so pressing Switch to Monad and rejecting looked like nothing happened).
  async function switchNetwork() {
    try {
      await switchToMonad()
      return true
    } catch (error) {
      const friendly = friendlyError(error)
      playSound(friendly.rejected ? 'cancel' : 'error')
      setBox({
        title: 'Still on another network',
        message: friendly.rejected
          ? 'you turned down the switch in your wallet. r3OS paints on Monad: press Switch to Monad again when you are ready.'
          : friendly.message,
        kind: friendly.rejected ? 'warning' : 'error',
      })
      return false
    }
  }

  async function paintChunks(andFrame = false) {
    if (andFrame && isLive) return
    if (needsLive) {
      if (!walletOnCorrectChain()) await switchNetwork()
      else void startLiveFor()
      return
    }
    if (config.demo) {
      setBox({
        title: 'Demo mode',
        message: 'demo mode: add VITE_RPC_URL and VITE_PAINT_ADDRESS to go onchain',
      })
      return
    }
    if (!wallet.account) {
      setWalletIntent('paint')
      setWalletDialog(true)
      return
    }
    if (!config.paintAddress) return
    if ((!isLive || andFrame) && !walletOnCorrectChain()) {
      await switchNetwork()
      return
    }
    if (patch.pixelWrites === 0) return

    setBusy(true)
    cancelRef.current = false
    // Auto-painted Live strokes have no Paint button to press again, so a stroke that fails comes back off the
    // canvas instead of sitting there looking painted. A stroke you send yourself stays put so you can retry it.
    const autoSent = isLive && autoPaint && !andFrame
    let attempted: Map<number, number> | undefined
    try {
      const preflightStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
      // A network read of all 16 region counters was adding hundreds of ms (and occasional seconds)
      // before every Live send, while the 300ms block could change underneath it anyway. Use the
      // current-block Painted events already delivered to this tab as a best-effort split hint; the
      // contract remains authoritative and still enforces the region cap onchain.
      const usage = isLive ? liveRegionUsage() : new Map<number, { block: bigint; pixels: number }>()
      const chunks = splitPaintRuns(bytesToRuns(patch.bytes), {
        maxRawPixels: Number(constants.MAX_RAW_PIXELS_PER_PAINT),
        regionCap: Number(constants.MAX_PIXELS_PER_REGION_PER_BLOCK),
        currentBlock: block.block,
        regionUsage: usage,
        budgetUnits: Math.max(0, budget.total),
        unitCostAt: (y, x) => {
          const index = y * 256 + x
          if (canvas.background[index] === 0) return 1
          const tile = (y >> 4) * 16 + (x >> 4)
          const state = tileSnapshot.map.get(tile)?.state
          const bit = BigInt((y & 15) * 16 + (x & 15))
          return state && ((state.wetBitmap >> bit) & 1n) !== 0n ? 1 : 2
        },
      })
      if (autoSent) attempted = beginInFlight(runsToBytes(chunks.flatMap((chunk) => chunk.runs)))
      // In Live Mode a stroke that doesn't fit this hour's budget used to stay on the canvas unsent, looking painted.
      // The pile grew with every stroke, and after the hourly refill the next small stroke sent all of it, so the
      // budget went straight back to 0. Now what fits is painted and the rest comes off, with a note saying why.
      const fitting = chunks.reduce((sum, chunk) => sum + chunk.pixels, 0)
      if (autoSent && fitting < patch.pixelWrites) {
        const hour = Math.floor(Date.now() / 3_600_000)
        if (budgetHourRef.current !== hour) {
          // The refill may not be loaded yet: read the budget once for this hour, then try the stroke again.
          budgetHourRef.current = hour
          await refreshBudget()
          strokeQueueRef.current?.schedule()
          return
        }
        const sending = attempted ?? new Map<number, number>()
        const leftover = new Map([...beginInFlight(patch.bytes)].filter(([index]) => !sending.has(index)))
        dropInFlight(leftover)
        noteStroke('dropped', leftover.size, "out of paint: didn't fit this hour's budget")
        const minutes = 60 - new Date().getUTCMinutes()
        pushBalloon({
          id: 'out-of-paint',
          title: 'Out of paint',
          body: `${leftover.size.toLocaleString()} px didn't fit this hour's budget, so they came off the canvas. it refills in ${minutes} min.`,
        })
        if (!chunks.length) return
      }
      // The whole-drawing quote only fits when the drawing goes out as one paint. A drawing with more than
      // 512 px in one region (a fill, a big shape) is split into several paints, and estimating it as one
      // transaction always reverted with RegionBusy, so nothing was ever sent. Those quote their first chunk.
      const wholePatch = chunks.length === 1 && chunks[0].pixels === patch.pixelWrites
      const primedLiveQuote =
        isLive && liveQuoteRef.current?.hex === patch.hex ? liveQuoteRef.current.quote : undefined
      const matchingPaintQuote = paintQuoteHexRef.current === patch.hex ? paintQuote : undefined
      const initialPaintQuote =
        wholePatch && !andFrame
          ? (matchingPaintQuote ??
            (await (primedLiveQuote ??
              quoteAction({
                kind: 'corePaint',
                address: config.paintAddress,
                abi: R3OS_PAINT_ABI,
                functionName: 'paint',
                args: [patch.hex, stableHolderIds],
                account: wallet.account,
                pixels: patch.pixelWrites,
                signer: isLive ? 'burner' : 'wallet',
              }))))
          : undefined
      const preflightEnded = typeof performance === 'undefined' ? Date.now() : performance.now()
      recordPerf('paint-preflight', isLive ? 'live' : 'wallet', preflightEnded - preflightStarted)
      if (andFrame && chunks.length !== 1) {
        setBox({
          title: 'Paint and save frame',
          message: 'the pending paint needs more than one chunk. paint it first, then save a frame.',
          kind: 'warning',
        })
        return
      }

      setProgress({ current: 0, total: chunks.length })
      for (let index = 0; index < chunks.length; index++) {
        if (cancelRef.current) break
        setProgress({ current: index + 1, total: chunks.length })
        const bytes = runsToBytes(chunks[index].runs)
        const hex = bytesToHex(bytes)
        const options: ActionOptions = {
          kind: andFrame ? 'paintAndMintFrame' : 'corePaint',
          address: config.paintAddress,
          abi: R3OS_PAINT_ABI,
          functionName: andFrame ? 'paintAndMintFrame' : 'paint',
          args: [hex, stableHolderIds],
          account: wallet.account,
          pixels: chunks[index].pixels,
          signer: !andFrame && isLive ? 'burner' : 'wallet',
          action: andFrame
            ? `paint ${chunks[index].pixels} px and save frame`
            : `paint ${chunks[index].pixels} px`,
          regions: regionsFromRunList(chunks[index].runs),
          successSound: andFrame ? 'success-heavy' : 'success-light',
          quote: andFrame
            ? (quotes[quoteKey('paintAndMintFrame', patch.hex)] as ActionQuote | undefined)
            : index === 0 && initialPaintQuote
              ? initialPaintQuote
              : await quoteAction({
                  kind: 'corePaint',
                  address: config.paintAddress,
                  abi: R3OS_PAINT_ABI,
                  functionName: 'paint',
                  args: [hex, stableHolderIds],
                  account: wallet.account,
                  pixels: chunks[index].pixels,
                  signer: isLive ? 'burner' : 'wallet',
                }),
          confirmHigherCost,
          onState: setTxState,
        }
        if (!options.quote) throw new Error('quote unavailable')
        const inFlight = beginInFlight(bytes)
        try {
          const result = await sendAction(options)
          // Measured by the tx pipeline: from the RPC accepting the transaction to this app holding its receipt.
          setLastPaint({ block: result.blockNumber, hash: result.hash, receiptMs: result.receiptMs })
          regionRetriesRef.current = 0
          // The receipt already contains the exact Painted log. Apply it immediately so the local canvas
          // becomes canonical without waiting for another getLogs/catch-up round trip. Budget refresh is
          // informative, not part of visual confirmation, so let it happen in the background.
          const stopSettle = startPerf('ui-settle', andFrame ? 'paint + frame' : 'paint')
          await settleInFlightFromReceipt(inFlight, result.receipt.logs, result.blockNumber)
          stopSettle()
          if (liveQuoteRef.current?.hex === patch.hex) liveQuoteRef.current = undefined
          let corruptions = new Uint8Array()
          let frameId: bigint | undefined
          for (const log of result.receipt.logs) {
            try {
              const decoded = decodeCoreEventLog(log)
              if (decoded.eventName === 'Painted')
                corruptions = new Uint8Array(
                  hexToBytes((decoded.args as { corruptions: `0x${string}` }).corruptions),
                )
              if (decoded.eventName === 'FrameMinted') frameId = (decoded.args as { frameId: bigint }).frameId
            } catch {
              // Unrelated receipt log.
            }
          }
          if (frameId != null) {
            pushBalloon({
              title: 'Frame saved',
              body: `frame #${frameId} is saved onchain in block #${result.blockNumber}.`,
              href: `#/frames?frame=${frameId}`,
              hrefLabel: 'Open in My Frames',
            })
          }
          if (corruptions.length) {
            playSound('df1')
            pushBalloon({ title: 'DF1', body: `DF1 glitched ${corruptions.length / 3} of your pixels` })
          }
          setAssistantTip('nice. you can claim a painter pass now')
        } catch (error) {
          throw error
        }
      }
    } catch (error) {
      const friendly =
        (error as { friendly?: ReturnType<typeof friendlyError> }).friendly ?? friendlyError(error)
      // A quote primed at pointer-up that failed must not be reused: the next try has to ask the chain again.
      liveQuoteRef.current = undefined
      // Cancelling (in the wallet, or the "gas went up" confirm) is a choice, not a failure: nothing was sent and
      // the pipeline already played the cancel sound, so no red "Paint failed" box. A stroke you sent yourself
      // stays to retry; an auto-painted Live stroke comes off, so the canvas keeps showing only what's onchain.
      const failedPx = attempted?.size ?? patch.pixelWrites
      const why = `${friendly.name ? `${friendly.name}: ` : ''}${friendly.message}`
      if (friendly.rejected) {
        if (attempted) dropInFlight(attempted)
        noteStroke(attempted ? 'dropped' : 'failed', failedPx, `cancelled: ${why}`)
        return
      }
      if (attempted && friendly.name === 'RegionBusy' && regionRetriesRef.current < 3) {
        noteStroke('retrying', failedPx, why)
        regionRetriesRef.current++
        window.setTimeout(() => strokeQueueRef.current?.schedule(), 800)
        return
      }
      regionRetriesRef.current = 0
      if (attempted) dropInFlight(attempted)
      noteStroke(attempted ? 'dropped' : 'failed', failedPx, why)
      const dropped = attempted ? ", so that stroke was taken off your canvas" : ''
      if (friendly.name === 'TileTooHot')
        setAssistantTip(
          "it looks like you're trying to paint over someone's piece. heat's gonna stop you lol",
        )
      if (friendly.name === 'BurnerOutOfMon') {
        pushBalloon({
          id: 'burner-out-of-mon',
          title: 'Live mode',
          body: `the burner is out of MON${dropped}`,
          href: '#/pass?tab=Hardware%20Profiles',
          hrefLabel: 'Top up…',
        })
      } else if (friendly.name === 'SessionUnitsExceeded') {
        strokeQueueRef.current?.cancel()
        setAutoPaint(false)
        pushBalloon({
          id: 'session-units-used',
          title: 'Live mode',
          body: `session allowance used up${dropped}`,
          href: '#/live-wizard',
          hrefLabel: 'start a new one',
        })
      } else {
        setBox({
          title: 'Paint failed',
          message: attempted
            ? `${friendly.message}\n\nthat stroke didn't land, so it was taken off your canvas. draw it again to retry.`
            : friendly.message,
          kind: 'error',
          details: friendly.details,
        })
      }
    } finally {
      setBusy(false)
      setTxState(undefined)
      setProgress(null)
    }
  }

  paintChunksRef.current = paintChunks

  async function simpleWrite(
    functionName: string,
    args: readonly unknown[],
    quote: ActionQuote | undefined,
    heavy = false,
  ) {
    if (config.demo) {
      setBox({
        title: 'Demo mode',
        message: 'demo mode: add VITE_RPC_URL and VITE_PAINT_ADDRESS to go onchain',
      })
      return
    }
    if (!wallet.account) {
      setWalletIntent('paint')
      setWalletDialog(true)
      return
    }
    if (!config.paintAddress || !quote) return
    if (!walletOnCorrectChain()) {
      await switchToMonad()
      return
    }
    try {
      const result = await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName,
        args,
        account: wallet.account,
        quote,
        confirmHigherCost,
        successSound: heavy ? 'success-heavy' : 'success-light',
      })
      await applyReceiptActivity(result.receipt.logs, result.blockNumber)
      void refreshBudget()
      if (functionName === 'mintFrame') {
        let frameId: bigint | undefined
        for (const log of result.receipt.logs) {
          try {
            const decoded = decodeCoreEventLog(log)
            if (decoded.eventName === 'FrameMinted') frameId = (decoded.args as { frameId: bigint }).frameId
          } catch {
            // unrelated
          }
        }
        pushBalloon({
          title: 'Frame saved',
          body: frameId == null
            ? `your frame is saved onchain in block #${result.blockNumber}.`
            : `frame #${frameId} is saved onchain in block #${result.blockNumber}.`,
          href: frameId == null ? undefined : `#/frames?frame=${frameId}`,
          hrefLabel: frameId == null ? undefined : 'Open in My Frames',
        })
      }
    } catch (error) {
      const friendly =
        (error as { friendly?: ReturnType<typeof friendlyError> }).friendly ??
        friendlyError(error, functionName)
      if (friendly.rejected) return
      setBox({ title: 'Action failed', message: friendly.message, kind: 'error', details: friendly.details })
    }
  }

  const mintKey = quoteKey('mintFrame')
  const paintFrameKey = quoteKey('paintAndMintFrame', patch.hex)
  const blackKey = quoteKey('setFace', '1')
  const whiteKey = quoteKey('setFace', '7')
  const bgKey = quoteKey('setBackground', String(backgroundCandidate))
  const menuItems: Parameters<typeof MenuBar>[0]['menus'] = [
    {
      label: 'File',
      items: [
        {
          label:
            quotes[mintKey] && typeof quotes[mintKey] !== 'string'
              ? `Save frame… · ${quotes[mintKey].maxCost}`
              : 'Save frame…',
          disabled: !(quotes[mintKey] && typeof quotes[mintKey] !== 'string'),
          disabledReason: typeof quotes[mintKey] === 'string' ? (quotes[mintKey] as string) : 'quoting…',
          action: () => void simpleWrite('mintFrame', [], quotes[mintKey] as ActionQuote, true),
        },
        {
          label:
            quotes[paintFrameKey] && typeof quotes[paintFrameKey] !== 'string'
              ? `Paint and save frame… · ${quotes[paintFrameKey].maxCost}`
              : 'Paint and save frame…',
          disabled:
            isLive ||
            !guest ||
            patch.pixelWrites === 0 ||
            !(quotes[paintFrameKey] && typeof quotes[paintFrameKey] !== 'string'),
          disabledReason: isLive
            ? 'save frame from your main wallet'
            : !guest
              ? 'paint with Live Mode, then File › Save frame'
              : patch.pixelWrites === 0
                ? 'paint something first'
                : typeof quotes[paintFrameKey] === 'string'
                  ? (quotes[paintFrameKey] as string)
                  : 'quoting…',
          action: () => void paintChunks(true),
        },
        {
          label: 'Save canvas to floppy…',
          action: () => requestFloppy({ kind: 'canvas', withDraft: true }),
        },
        {
          label: 'Set canvas as wallpaper',
          action: () => applyWallpaperResource({ kind: 'canvas' }),
        },
        {
          label: isLive ? 'Live mode is on ✓' : 'Live mode setup / limits…',
          disabled: isLive,
          disabledReason: 'end the session in My Pass › Hardware Profiles',
          action: () => openProgram('live-wizard'),
        },
        {
          label: `Auto-paint strokes ${autoPaint ? '✓' : ''}`,
          disabled: !isLive,
          disabledReason: 'live mode only',
          action: () =>
            setAutoPaint((value) => {
              // Off means strokes stay on the canvas until Paint is pressed. On a phone that's easy to switch off
              // by accident (it sits under Save frame), so say it loudly instead of looking like Paint broke.
              if (value)
                pushBalloon({
                  id: 'auto-paint-off',
                  title: 'Auto-paint is off',
                  body: 'new strokes wait on your canvas until you press Paint. File › Auto-paint strokes turns it back on.',
                })
              return !value
            }),
        },
        { label: 'Exit', action: () => closeWindow('paint') },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          disabled: isLive || !undoStack.length,
          disabledReason: isLive
            ? 'Live Mode writes onchain immediately; paint over it instead'
            : 'nothing to undo',
          action: undo,
        },
        {
          label: 'Redo',
          disabled: isLive || !redoStack.length,
          disabledReason: isLive
            ? 'Live Mode writes onchain immediately; there is no redo history'
            : 'nothing to redo',
          action: redo,
        },
        {
          label: 'Clear pending',
          disabled: patch.pixelWrites === 0,
          disabledReason: 'nothing pending',
          action: clearPending,
        },
      ],
    },
    {
      label: 'View',
      items: [
        // On a phone the canvas always fills the screen width, so zoom (and the grid, drawn from 4×) do nothing.
        ...(isPhoneScreen()
          ? []
          : [
              { label: `Zoom to fit ${zoom === 0 ? '✓' : ''}`, action: () => setZoom(0) },
              ...[1, 2, 4, 8].map((value) => ({
                label: `Zoom ${value}× ${zoom === value ? '✓' : ''}`,
                action: () => setZoom(value),
              })),
              { label: `Grid ${grid ? '✓' : ''}`, action: () => setGrid(!grid) },
            ]),
        { label: `Show protected ${protectedView ? '✓' : ''}`, action: () => setProtected(!protectedView) },
        { label: `Wet paint & heat ${heatView ? '✓' : ''}`, action: () => setHeatView(!heatView) },
        { label: 'Monad X-ray…', action: () => openProgram('xray') },
        { label: 'Broadcast to a screen (TV)', action: () => void (location.hash = '#/tv') },
      ],
    },
    {
      label: 'DF1',
      items: [
        {
          label: block.storm ? 'STORM 200%' : 'DF1 info',
          action: () =>
            setBox({
              title: 'DF1',
              message:
                'DF1 responds to hand-offs between painters. crowd pressure raises the corruption amount; storms force 200% for 600 blocks. the exact onchain DF1 renderer lives on saved frames.',
            }),
        },
      ],
    },
    {
      label: 'Colors',
      items: [
        {
          label:
            canvas.face !== 1 && quotes[blackKey] && typeof quotes[blackKey] !== 'string'
              ? `Face: black · ${quotes[blackKey].maxCost}`
              : 'Face: black',
          disabled: canvas.face === 1 || !(quotes[blackKey] && typeof quotes[blackKey] !== 'string'),
          disabledReason:
            canvas.face === 1
              ? 'current face colour'
              : typeof quotes[blackKey] === 'string'
                ? (quotes[blackKey] as string)
                : 'quoting…',
          action: () => void simpleWrite('setFace', [1, stableHolderIds], quotes[blackKey] as ActionQuote),
        },
        {
          label:
            canvas.face !== 7 && quotes[whiteKey] && typeof quotes[whiteKey] !== 'string'
              ? `Face: white · ${quotes[whiteKey].maxCost}`
              : 'Face: white',
          disabled: canvas.face === 7 || !(quotes[whiteKey] && typeof quotes[whiteKey] !== 'string'),
          disabledReason:
            canvas.face === 7
              ? 'current face colour'
              : typeof quotes[whiteKey] === 'string'
                ? (quotes[whiteKey] as string)
                : 'quoting…',
          action: () => void simpleWrite('setFace', [7, stableHolderIds], quotes[whiteKey] as ActionQuote),
        },
        { label: 'Background colour…', action: () => setBackgroundPicker(true) },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Help Topics', action: () => openProgram('help', true, helpHash('paint')) },
        { label: 'Hide assistant', action: () => window.dispatchEvent(new Event('r3os-hide-assistant')) },
        {
          label: 'About Paint',
          action: () =>
            setBox({
              title: 'About Paint',
              message: `paint monad. pay gas. try not to ruin it.\n${config.paintAddress ?? 'demo mode'}`,
            }),
        },
      ],
    },
  ]

  return (
    <div className="paint-program">
      <MenuBar menus={menuItems} onOpen={quoteMenus} />
      <section className={`paint-live-hero ${isLive ? 'active' : liveStarting ? 'starting' : ''}`}>
        <div className="paint-live-state">
          <span className="paint-live-beacon" aria-hidden="true" />
          <div>
            <b>
              {guest
                ? 'GUEST WALLET'
                : isLive
                  ? 'LIVE · ONCHAIN'
                  : liveStarting
                    ? 'STARTING LIVE MODE'
                    : 'LIVE MODE'}
            </b>
            <small>
              {guest
                ? 'every stroke is signed right here: no popups, real Monad transactions'
                : isLive
                  ? `${liveTime} left · ${liveUnits.toLocaleString()} units · ${formatBurnerBalance(live.balance)}`
                  : liveStarting
                    ? liveQuick?.phase === 'sign'
                      ? 'confirm the session signature · it cannot move funds'
                      : liveQuick?.phase === 'fund'
                        ? `fund the browser key once · ${Number(MAX_BURNER_FUND / 10n ** 18n)} MON hard cap`
                        : 'authorizing the browser paint session…'
                    : 'authorize once · then paint without a wallet popup per stroke · no Undo'}
            </small>
          </div>
        </div>
        <div className="paint-live-proof">
          {lastPaint && (
            <div className="paint-proof-line">
              <b>YOU</b>
              <span>{paintedText(lastPaint)}</span>
              <span className="paint-proof-links">
                <button className="link-button" onClick={() => void openProgram('xray')}>
                  X-ray
                </button>
                {lastExplorer && (
                  <a href={lastExplorer} target="_blank" rel="noreferrer">
                    explorer
                  </a>
                )}
              </span>
            </div>
          )}
          {remoteNow && latestRemote && (
            <div className="paint-proof-line remote">
              <b>REMOTE</b>
              <span>
                {short(latestRemote.owner)} · {latestRemote.pixels.toLocaleString('en-US')} px · block #
                {latestRemote.block.toString()}
              </span>
              {remoteExplorer && (
                <a href={remoteExplorer} target="_blank" rel="noreferrer">
                  tx
                </a>
              )}
            </div>
          )}
          {!lastPaint && !(remoteNow && latestRemote) && (
            <>
              <b>
                {together.painters
                  ? `${together.painters} PAINTER${together.painters === 1 ? '' : 'S'} RECENTLY`
                  : 'SHARED CANVAS'}
              </b>
              <span>
                {together.painters
                  ? `${together.pixels.toLocaleString('en-US')} px in the last ${togetherWindow}`
                  : 'waiting for the next live stroke'}
              </span>
              <span>
                block #{block.block.toString()} · {block.mode === 'live' ? 'websocket live' : block.mode}
              </span>
            </>
          )}
        </div>
        {!guest && (
          <Button
            className={isLive ? 'paint-live-hero-button active' : 'paint-live-hero-button'}
            disabled={liveStarting}
            title={
              isLive
                ? 'manage or end the browser-held Live session'
                : 'Live Mode does not keep Undo history for sent strokes'
            }
            onClick={() =>
              void (isLive
                ? openProgram('pass', true, '#/pass?tab=Hardware%20Profiles')
                : startLiveFromPaint())
            }
          >
            {liveButtonLabel}
          </Button>
        )}
      </section>
      <div className="paint-main">
        <Toolbox
          tool={tool}
          onTool={setTool}
          size={strokeSize}
          onSize={tool === 'pencil' ? setPencilSize : setSize}
        />
        <CanvasView
          pixels={canvas.working}
          outline={canvas.outline}
          face={canvas.face}
          background={canvas.backgroundColor}
          zoom={zoom}
          grid={grid}
          protectedView={protectedView}
          showHeat={heatView}
          tileStates={tileStates}
          maxHeat={Number(constants.MAX_TILE_HEAT)}
          pings={presence.pings}
          focus={presence.focus}
          renderProbe={remoteRenderProbe}
          previewInputMode={previewInputMode}
          onRenderProbe={recordRemoteRender}
          onDown={onDown}
          onMove={onMove}
          onUp={onUp}
          onCancel={cancelStroke}
          onHover={(point) => {
            setHover(point)
          }}
        />
        <aside className="paint-info">
          <b>256 × 256</b>
          <span>16 colours</span>
          <span title="seasons last 30 days; when one ends its final canvas becomes the finale">
            season {Number(canvas.season) + 1} · day {day}
          </span>
          <br />
          <b
            className="paint-term"
            title="what painting the pixel under your cursor costs from your budget: blank or still-wet pixels are cheap, painting over dry art costs more"
          >
            wet paint
          </b>
          <span>
            under cursor: {hoverLabel} · {hoverCost} unit{hoverCost === 1 ? '' : 's'}
          </span>
          <br />
          <b
            className="paint-term"
            title="how hard this 16 × 16 area is being painted right now. if it gets too hot, paints there fail until it cools down; it cools a little every block"
          >
            tile heat
          </b>
          <span>
            {'▮'.repeat(heatBars)}
            {'▯'.repeat(5 - heatBars)} {heatLabel}
          </span>
          {!config.demo && (
            <>
              <br />
              <b
                className="paint-term"
                title={`different wallets that painted this canvas in the last ${togetherWindow}, read from the contract's Painted events. new strokes by others flash on the canvas.`}
              >
                active recently
              </b>
              <span className="paint-together">
                <b>
                  {together.painters
                    ? `${together.painters} painter${together.painters === 1 ? '' : 's'}`
                    : 'quiet right now'}
                </b>
                <small>
                  {together.painters ? `${together.pixels.toLocaleString('en-US')} px · ` : ''}last{' '}
                  {togetherWindow}
                </small>
              </span>
              {presence.season && presence.season.season === canvas.season && (
                <span
                  className="paint-together"
                  title="successful paints and saved frames this season, read from the contract"
                >
                  <small>this season</small>
                  {presence.season.paints.toLocaleString('en-US')} paints ·{' '}
                  {presence.season.frames.toLocaleString('en-US')} frames
                </span>
              )}
              {presence.strokes.length > 0 && (
                <ul className="paint-recent" aria-label="recent strokes">
                  {presence.strokes.slice(0, 3).map((stroke) => (
                    <li key={stroke.key}>
                      <button title="show this stroke on the canvas" onClick={() => focusPaint(stroke.box)}>
                        <span>{stroke.owner === me ? 'you' : painterName(stroke.owner)}</span>
                        <small>
                          {stroke.pixels.toLocaleString('en-US')} px ·{' '}
                          {agoLabel(stroke.block, block.block, block.blockTimeMs)} ago
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
      <div className="paint-bottom">
        <PaletteBar
          foreground={colour}
          backgroundIndex={bgColour}
          onForeground={setColour}
          onBackground={setBgColour}
          seasonBackground={canvas.backgroundColor}
        />
        <BudgetMeter
          budget={budget}
          cost={cost.units}
          reason={reason}
          connected={Boolean(wallet.account)}
          gas={
            wallet.account && !isLive
              ? gasHint({ balance: wallet.balance, strokeCost: lastStrokeCost, chainId: config.chainId })
              : undefined
          }
          onHolderQuota={() => setHolderDialog(true)}
        />
        <div className="paint-action">
          <small>
            {cost.pixels} px · cost {cost.units} ({cost.blank} blank, {cost.wet} wet, {cost.dry} dry×2)
          </small>
          <small>
            {wallet.account
              ? (paintQuote?.maxCost ?? (patch.pixelWrites ? 'quoting…' : '—'))
              : 'connect to quote'}
          </small>
          <div className="paint-action-buttons">
            <Button
              primary
              title={wallet.account && reason ? reason : undefined}
              disabled={
                wallet.account
                  ? needsLive
                    ? liveStarting
                    : busy || (!!reason && (isLive || walletOnCorrectChain()))
                  : false
              }
              onClick={() => {
                if (!wallet.account) {
                  setWalletIntent('paint')
                  setWalletDialog(true)
                } else if (!isLive && !walletOnCorrectChain()) void switchNetwork()
                else if (needsLive) void startLiveFor()
                else void paintChunks(false)
              }}
            >
              {!wallet.account
                ? 'Connect wallet'
                : !isLive && !walletOnCorrectChain()
                  ? 'Switch to Monad'
                  : needsLive
                    ? liveStarting
                      ? liveButtonLabel
                      : 'Start Live Mode to paint'
                    : `Paint ${cost.pixels} px`}
            </Button>
            {progress && progress.total > 1 && (
              <Button
                disabled={progress.stopping}
                title="finish the current transaction, then stop sending the remaining chunks"
                onClick={() => {
                  cancelRef.current = true
                  setProgress((current) => (current ? { ...current, stopping: true } : current))
                }}
              >
                {progress.stopping ? 'Stopping…' : 'Stop remaining'}
              </Button>
            )}
          </div>
          {isLive && !autoPaint && (
            <small className="paint-live-hint held">
              auto-paint is off{patch.pixelWrites ? ` · ${patch.pixelWrites} px waiting` : ''} ·{' '}
              <button
                className="link-button"
                onClick={() => {
                  setAutoPaint(true)
                  // send what's waiting right away (the queue runs the latest paintChunks after this render)
                  window.setTimeout(() => strokeQueueRef.current?.schedule(), 0)
                }}
              >
                turn it back on and send
              </button>
            </small>
          )}
          <small className={isLive || guest ? 'paint-live-hint active' : 'paint-live-hint'}>
            {guest
              ? 'guest wallet · onchain immediately · no popups · no undo'
              : isLive
                ? 'onchain immediately · no wallet popup per stroke · no undo'
                : liveStarting
                  ? liveQuick?.phase === 'sign'
                    ? 'confirm the session signature in your wallet'
                    : liveQuick?.phase === 'fund'
                      ? 'confirm burner gas funding once'
                      : 'finishing setup…'
                  : 'quick start: usually 2 wallet prompts once · then none per stroke · no undo'}
          </small>
        </div>
      </div>
      <footer className="paint-status">
        <span>
          {busy ? (
            progress && progress.total > 1 ? (
              progress.stopping ? (
                `stopping after chunk ${progress.current}/${progress.total}…`
              ) : (
                `sending chunk ${progress.current}/${progress.total}…`
              )
            ) : txState === 'signing' ? (
              isLive ? (
                'signing live paint…'
              ) : (
                'confirm in wallet…'
              )
            ) : txState === 'sent' ? (
              'sent · waiting for block…'
            ) : (
              'painting…'
            )
          ) : lastPaint ? (
            <>
              {paintedText(lastPaint)} ·{' '}
              <button
                className="link-button"
                title="follow this paint through receipt and Monad commit states in X-ray"
                onClick={() => void openProgram('xray')}
              >
                X-ray
              </button>
            </>
          ) : isLive && live.burner ? (
            `LIVE · ONCHAIN · NO UNDO · burner ${short(live.burner.address)} · ${formatBurnerBalance(live.balance)}${togetherText}`
          ) : !wallet.account ? (
            'PREVIEW MODE · local only · connect to commit onchain'
          ) : config.demo ? (
            'demo canvas'
          ) : (
            `ready · ${short(wallet.account)}${togetherText}`
          )}
        </span>
        <span>
          {hover.x}, {hover.y}
        </span>
        <span
          title={
            block.storm
              ? 'storm: fresh pixels glitch at 200% for 600 blocks'
              : 'no storm: fresh pixels only glitch where many painters crowd the same area'
          }
        >
          {block.storm ? 'STORM 200%' : 'calm / pressure'}
        </span>
        <span>block #{block.block}</span>
      </footer>
      {walletDialog && (
        <MessageBox
          title={walletIntent === 'live' ? 'Go live · connect wallet' : 'Connect wallet'}
          defaultLabel="Cancel"
          onClose={() => setWalletDialog(false)}
        >
          <WalletChooser
            onClose={() => setWalletDialog(false)}
            onConnected={(account) => {
              if (walletIntent === 'live') void startLiveFor(account)
            }}
          />
        </MessageBox>
      )}
      {holderDialog && (
        <div className="modal-shade">
          <div className="message-box window">
            <b>Holder quota</b>
            <p>
              Enter r3tard token ids if automatic discovery is unavailable. Mainnet Skrumpeys and Monad Cards
              are detected automatically.
            </p>
            <input
              value={manualIds}
              onChange={(event) => setManualIds(event.target.value)}
              placeholder="12, 44, 1033"
            />
            <div className="dialog-actions">
              <Button
                primary
                onClick={() => {
                  setHolderDialog(false)
                  void refreshHolderIds()
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
      {backgroundPicker && (
        <div className="modal-shade">
          <div className="message-box window">
            <b>Background colour</b>
            <p>Changing it costs 256 budget units and has a global cooldown.</p>
            <div className="background-picker" role="radiogroup" aria-label="background colour">
              {BACKGROUND_CHOICES.map((choice) => {
                const current = choice.index === canvas.backgroundColor
                return (
                  <button
                    key={choice.index}
                    role="radio"
                    aria-checked={backgroundCandidate === choice.index}
                    disabled={current}
                    className={backgroundCandidate === choice.index && !current ? 'selected' : ''}
                    title={current ? `${choice.name} (the background now)` : choice.name}
                    onClick={() => setBackgroundCandidate(choice.index)}
                  >
                    <span className="background-swatch" style={{ background: PALETTE[choice.index].hex }} />
                    <small>{choice.name}</small>
                    {current && <small className="background-now">now</small>}
                  </button>
                )
              })}
            </div>
            <p>
              max cost:{' '}
              {backgroundCandidate === canvas.backgroundColor ? 'pick a new colour' : quoteText(bgKey)}
            </p>
            <FeeNote />
            <div className="dialog-actions">
              <Button
                primary
                disabled={
                  backgroundCandidate === canvas.backgroundColor ||
                  !(quotes[bgKey] && typeof quotes[bgKey] !== 'string')
                }
                onClick={() => {
                  setBackgroundPicker(false)
                  void simpleWrite(
                    'setBackground',
                    [backgroundCandidate, stableHolderIds],
                    quotes[bgKey] as ActionQuote,
                  )
                }}
              >
                Set background
              </Button>
              <Button onClick={() => setBackgroundPicker(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      {box && <MessageBox {...box} onClose={() => setBox(undefined)} />}
      {gasConfirm && (
        <MessageBox
          title="Gas changed"
          kind="warning"
          message={`gas went up: new max ${gasConfirm.nextQuote.maxCost}`}
          defaultLabel="OK"
          onDefault={() => {
            gasConfirm.resolve(true)
            setGasConfirm(undefined)
          }}
          onCancel={() => {
            gasConfirm.resolve(false)
            setGasConfirm(undefined)
          }}
          onClose={() => {}}
        />
      )}
    </div>
  )
}
