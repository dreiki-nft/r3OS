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
import { readMany } from '../chain/readMany'
import { startPerf } from '../chain/perf'
import { quoteAction, sendAction, type ActionOptions, type ActionQuote } from '../chain/tx'
import {
  connectWallet,
  getWalletSnapshot,
  subscribeWallet,
  switchToMonad,
  walletOnCorrectChain,
} from '../chain/wallet'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import {
  formatBurnerBalance,
  getLiveSnapshot,
  liveActive,
  setLiveOwner,
  subscribeLive,
} from '../live/liveStore'
import { createStrokeQueue } from '../live/paintQueue'
import { startLiveQuick, type QuickProgress } from '../live/quickStart'
import { drawEllipse, drawLine, drawRect, floodFill, type Point } from '../lib/paintEngine'
import { PALETTE } from '../lib/palette'
import { encodeChangedRuns } from '../lib/patch'
import { setSleepwalkerDraft } from '../labs/sleepwalkerDraft'
import { clearAssistantTip, setAssistantTip } from '../os/assistantStore'
import { pushBalloon } from '../os/balloons'
import { openProgram } from '../os/programs'
import { playSound } from '../os/sound'
import { requestFloppy } from '../os/floppy'
import { applyWallpaperResource } from '../os/wallpaper'
import { Button } from '../os/ui/Button'
import { MenuBar } from '../os/ui/MenuBar'
import { MessageBox } from '../os/ui/MessageBox'
import { WalletChooser } from '../os/WalletChooser'
import { useWindowActive } from '../os/Window'
import { closeWindow } from '../os/windows'
import { regionsFromRunList } from '../xray/regions'
import { BudgetMeter, type BudgetState } from './BudgetMeter'
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
  beginInFlight,
  clearPending,
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
import { PaletteBar } from './PaletteBar'
import { SaveProgress } from './SaveProgress'
import { bytesToRuns, runsToBytes, splitPaintRuns } from './split'
import { drawStrokeSegment, protectOutline } from './strokes'
import { Toolbox, type Tool } from './Toolbox'

const EMPTY_BUDGET: BudgetState = { hourly: 0, hourlyLimit: 0, holder: 0, total: 0, activeDays: 0 }
const ALLOWED_BACKGROUNDS = new Set([0, 5, 6, 8, 9, 10, 11])

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
  const together = summarize(presence.strokes, block.block)
  const togetherWindow = windowLabel(PRESENCE_WINDOW_BLOCKS, block.blockTimeMs)
  const me = wallet.account?.toLowerCase()
  const togetherText = together.painters ? ` · ${together.painters} active recently` : ''
  useEffect(() => setPresenceAccount(wallet.account), [wallet.account])

  const [tool, setTool] = useState<Tool>('pencil')
  const [colour, setColour] = useState(1)
  const [bgColour, setBgColour] = useState(0)
  const [size, setSize] = useState(1)
  const [zoom, setZoom] = useState(2)
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
  const [backgroundPicker, setBackgroundPicker] = useState(false)
  const [backgroundCandidate, setBackgroundCandidate] = useState(canvas.backgroundColor)
  const [budget, setBudget] = useState<BudgetState>(EMPTY_BUDGET)
  const [constants, setConstants] = useState(demoConstants)
  const [paintQuote, setPaintQuote] = useState<ActionQuote>()
  const [quotes, setQuotes] = useState<Record<string, ActionQuote | string>>({})
  const [busy, setBusy] = useState(false)
  const [txState, setTxState] = useState<'signing' | 'sent' | 'confirmed'>()
  const [liveStarting, setLiveStarting] = useState(false)
  const [liveQuick, setLiveQuick] = useState<QuickProgress>()
  const [lastPaint, setLastPaint] = useState<LastPaint>()
  // The "painted in block" line stays for a few seconds, then the status bar goes back to normal.
  useEffect(() => {
    if (!lastPaint) return
    const timer = window.setTimeout(() => setLastPaint(undefined), 12_000)
    return () => window.clearTimeout(timer)
  }, [lastPaint])
  const [autoPaint, setAutoPaint] = useState(true)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
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
  if (!strokeQueueRef.current) {
    strokeQueueRef.current = createStrokeQueue(() => paintChunksRef.current(false))
  }
  const lastHeatFullRefresh = useRef<bigint>(-100n)
  const undoStackRef = useRef<Uint8Array[]>([])
  const redoStackRef = useRef<Uint8Array[]>([])
  const holderKey = useMemo(() => holderIds.map(String).join(','), [holderIds])
  const stableHolderIds = useMemo(() => holderKey.split(',').filter(Boolean).map(BigInt), [holderKey])
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

  useEffect(() => {
    if (isLive) {
      setAutoPaint(true)
      setLiveStarting(false)
    }
  }, [isLive])

  const startLiveFromPaint = useCallback(async () => {
    if (!wallet.account) {
      setWalletDialog(true)
      return
    }
    if (isLive || liveStarting) return
    setLiveStarting(true)
    setLiveQuick({ phase: 'prepare', prompts: 2 })
    try {
      await startLiveQuick(wallet.account, setLiveQuick)
      setAssistantTip('Live Mode is on. Strokes now land onchain without wallet popups. No Undo.')
    } catch (caught) {
      const friendly =
        (caught as { friendly?: ReturnType<typeof friendlyError> }).friendly ?? friendlyError(caught, 'startSession')
      setBox({
        title: 'Live Mode',
        message: friendly.message,
        kind: friendly.rejected ? 'info' : 'error',
      })
      setLiveQuick(undefined)
    } finally {
      setLiveStarting(false)
    }
  }, [wallet.account, isLive, liveStarting])

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

  const refreshBudget = useCallback(async () => {
    if (!wallet.account || !publicClient || !config.paintAddress) return
    try {
      const values = (await publicClient.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'budgetOf',
        args: [wallet.account, stableHolderIds],
      })) as readonly bigint[]
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
  }, [wallet.account, holderKey])

  useEffect(() => {
    void refreshBudget()
  }, [refreshBudget])

  useEffect(
    () =>
      subscribeCanvasActivity((activity) => {
        if (!wallet.account) return
        const account = wallet.account.toLowerCase()
        if (activity.owner?.toLowerCase() === account || activity.minter?.toLowerCase() === account) {
          void refreshBudget()
        }
      }),
    [wallet.account, refreshBudget],
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

  useEffect(() => {
    const tile = tileFor(hover)
    void readTileState(tile, block.block)
  }, [tileFor(hover), block.block])

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
    if (!wallet.account || !config.paintAddress || patch.pixelWrites === 0 || config.demo) {
      setPaintQuote(undefined)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void quoteAction({
        kind: 'corePaint',
        address: config.paintAddress!,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'paint',
        args: [patch.hex, stableHolderIds],
        account: wallet.account!,
        pixels: patch.pixelWrites,
        signer: isLive ? 'burner' : 'wallet',
      })
        .then((quote) => {
          if (!cancelled) setPaintQuote(quote)
        })
        .catch(() => {
          if (!cancelled) setPaintQuote(undefined)
        })
    }, 100)
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
          setAssistantTip('Live Mode has no Undo. Confirmed strokes are already onchain.')
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
        abi: R3TARDS_PAINT_ABI,
        functionName: 'mintFrame',
        account: wallet.account,
      })
      if (patch.pixelWrites > 0) {
        void lazyQuote(quoteKey('paintAndMintFrame', patch.hex), {
          kind: 'paintAndMintFrame',
          address: config.paintAddress,
          abi: R3TARDS_PAINT_ABI,
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
          abi: R3TARDS_PAINT_ABI,
          functionName: 'setFace',
          args: [1, stableHolderIds],
          account: wallet.account,
        })
      if (canvas.face !== 7)
        void lazyQuote(quoteKey('setFace', '7'), {
          kind: 'estimate',
          address: config.paintAddress,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'setFace',
          args: [7, stableHolderIds],
          account: wallet.account,
        })
    }
  }

  useEffect(() => {
    if (!backgroundPicker || !wallet.account || !config.paintAddress || config.demo) return
    void lazyQuote(quoteKey('setBackground', String(backgroundCandidate)), {
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'setBackground',
      args: [backgroundCandidate, stableHolderIds],
      account: wallet.account,
    })
  }, [backgroundPicker, backgroundCandidate, wallet.account, holderKey])

  function commit(mutator: (buffer: Uint8Array) => void) {
    pushUndo()
    const next = canvas.working.slice()
    mutator(next)
    protectOutline(next, canvas.outline, canvas.working)
    recordPendingTiles(tilesFromDiff(canvas.working, next))
    setWorking(next)
  }

  const startStroke = (point: Point) => {
    pushUndo()
    const next = canvas.working.slice()
    drawStrokeSegment(next, point, point, tool as 'pencil' | 'brush' | 'eraser', colour, size)
    protectOutline(next, canvas.outline, canvas.working)
    strokeLast.current = point
    strokeBuffer.current = next
    recordPendingTiles([tileFor(point)])
    scheduleWorking(next)
  }

  const continueStroke = (point: Point) => {
    if (!strokeLast.current || !strokeBuffer.current) return
    const before = strokeBuffer.current.slice()
    drawStrokeSegment(
      strokeBuffer.current,
      strokeLast.current,
      point,
      tool as 'pencil' | 'brush' | 'eraser',
      colour,
      size,
    )
    protectOutline(strokeBuffer.current, canvas.outline, before)
    recordPendingTiles(tilesFromDiff(before, strokeBuffer.current))
    strokeLast.current = point
    scheduleWorking(strokeBuffer.current)
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

  const scheduleAutoPaint = () => {
    if (!isLive || !autoPaint) return
    strokeQueueRef.current?.schedule()
  }

  const onDown = (point: Point, event: PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'picker') {
      const index = point.y * 256 + point.x
      setColour(canvas.outline[index] ? canvas.face : canvas.working[index])
      return
    }
    if (tool === 'zoom') {
      setZoom((current) => (current >= 8 ? 1 : current * 2))
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

  async function regionUsage() {
    if (!publicClient || !config.paintAddress) return new Map<number, { block: bigint; pixels: number }>()
    // One Multicall3 eth_call instead of sixteen independent reads on every paint.
    const values = (await readMany(
      Array.from({ length: 16 }, (_, region) => ({
        address: config.paintAddress!,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'regionState',
        args: [canvas.season, region],
      })),
      { allowFailure: false },
    )) as readonly (readonly bigint[])[]
    const map = new Map<number, { block: bigint; pixels: number }>()
    values.forEach((value, region) => map.set(region, { block: value[0], pixels: Number(value[1]) }))
    return map
  }

  async function paintChunks(andFrame = false) {
    if (andFrame && isLive) return
    if (config.demo) {
      setBox({
        title: 'Demo mode',
        message: 'demo mode: add VITE_RPC_URL and VITE_PAINT_ADDRESS to go onchain',
      })
      return
    }
    if (!wallet.account) {
      setWalletDialog(true)
      return
    }
    if (!config.paintAddress) return
    if ((!isLive || andFrame) && !walletOnCorrectChain()) {
      await switchToMonad()
      return
    }
    if (patch.pixelWrites === 0) return

    setBusy(true)
    cancelRef.current = false
    try {
      const initialQuotePromise =
        !andFrame && !paintQuote
          ? quoteAction({
              kind: 'corePaint',
              address: config.paintAddress,
              abi: R3TARDS_PAINT_ABI,
              functionName: 'paint',
              args: [patch.hex, stableHolderIds],
              account: wallet.account,
              pixels: patch.pixelWrites,
              signer: isLive ? 'burner' : 'wallet',
            })
          : Promise.resolve(paintQuote)
      // Quote and region-cap reads are independent. Start them together so clicking Paint
      // pays one wall-clock RPC round trip instead of a serial quote -> region waterfall.
      // A human wallet confirmation usually spans several Monad blocks, so a current-block region
      // usage read is stale before the transaction can land. Skip that RTT for wallet-signed paints;
      // split against the patch's own region usage and let the fresh quote protect execution. Live
      // Mode can land inside the same block, so it keeps the exact region-state preflight.
      const usagePromise = isLive
        ? regionUsage()
        : Promise.resolve(new Map<number, { block: bigint; pixels: number }>())
      const [initialPaintQuote, usage] = await Promise.all([initialQuotePromise, usagePromise])
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
          abi: R3TARDS_PAINT_ABI,
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
            : index === 0
              ? initialPaintQuote
              : await quoteAction({
                  kind: 'corePaint',
                  address: config.paintAddress,
                  abi: R3TARDS_PAINT_ABI,
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
          setLastPaint({ block: result.blockNumber, receiptMs: result.receiptMs })
          // The receipt already contains the exact Painted log. Apply it immediately so the local canvas
          // becomes canonical without waiting for another getLogs/catch-up round trip. Budget refresh is
          // informative, not part of visual confirmation, so let it happen in the background.
          const stopSettle = startPerf('ui-settle', andFrame ? 'paint + frame' : 'paint')
          await settleInFlightFromReceipt(inFlight, result.receipt.logs, result.blockNumber)
          stopSettle()
          void refreshBudget()
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
              body: `frame #${frameId} saved · block #${result.blockNumber} · sealed by block.coinbase`,
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
      if (friendly.name === 'TileTooHot')
        setAssistantTip(
          "it looks like you're trying to paint over someone's piece. heat's gonna stop you lol",
        )
      if (friendly.name === 'BurnerOutOfMon') {
        pushBalloon({
          id: 'burner-out-of-mon',
          title: 'Live mode',
          body: 'the burner is out of MON',
          href: '#/pass?tab=Hardware%20Profiles',
          hrefLabel: 'Top up…',
        })
      } else if (friendly.name === 'SessionUnitsExceeded') {
        strokeQueueRef.current?.cancel()
        setAutoPaint(false)
        pushBalloon({
          id: 'session-units-used',
          title: 'Live mode',
          body: 'session allowance used up',
          href: '#/live-wizard',
          hrefLabel: 'start a new one',
        })
      } else {
        setBox({ title: 'Paint failed', message: friendly.message, kind: 'error', details: friendly.details })
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
        abi: R3TARDS_PAINT_ABI,
        functionName,
        args,
        account: wallet.account,
        quote,
        confirmHigherCost,
        successSound: heavy ? 'success-heavy' : 'success-light',
      })
      await refreshBudget()
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
          body: `frame #${frameId ?? '?'} saved · block #${result.blockNumber} · sealed by block.coinbase`,
          href: frameId == null ? undefined : `#/frames?frame=${frameId}`,
          hrefLabel: frameId == null ? undefined : 'Open in My Frames',
        })
      }
    } catch (error) {
      const friendly =
        (error as { friendly?: ReturnType<typeof friendlyError> }).friendly ??
        friendlyError(error, functionName)
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
            patch.pixelWrites === 0 ||
            !(quotes[paintFrameKey] && typeof quotes[paintFrameKey] !== 'string'),
          disabledReason: isLive
            ? 'save frame from your main wallet'
            : patch.pixelWrites === 0
              ? 'paint something first'
              : typeof quotes[paintFrameKey] === 'string'
                ? (quotes[paintFrameKey] as string)
                : 'quoting…',
          action: () => void paintChunks(true),
        },
        {
          label: 'Save canvas to floppy…',
          action: () => requestFloppy({ kind: 'canvas' }),
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
          action: () => setAutoPaint((value) => !value),
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
          disabledReason: isLive ? 'Live Mode writes onchain immediately; paint over it instead' : 'nothing to undo',
          action: undo,
        },
        {
          label: 'Redo',
          disabled: isLive || !redoStack.length,
          disabledReason: isLive ? 'Live Mode writes onchain immediately; there is no redo history' : 'nothing to redo',
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
        ...[1, 2, 4, 8].map((value) => ({ label: `Zoom ${value}×`, action: () => setZoom(value) })),
        { label: `Grid ${grid ? '✓' : ''}`, action: () => setGrid(!grid) },
        { label: `Show protected ${protectedView ? '✓' : ''}`, action: () => setProtected(!protectedView) },
        { label: `Wet paint & heat ${heatView ? '✓' : ''}`, action: () => setHeatView(!heatView) },
        { label: 'Monad X-ray…', action: () => openProgram('xray') },
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
      <div className="paint-main">
        <Toolbox tool={tool} onTool={setTool} size={size} onSize={setSize} />
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
          onDown={onDown}
          onMove={onMove}
          onUp={onUp}
          onHover={(point) => {
            if (tileFor(point) !== tileFor(hover)) void readTileState(tileFor(point), block.block)
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
                        <span>{stroke.owner === me ? 'you' : short(stroke.owner)}</span>
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
          noGas={
            wallet.account && wallet.balance === 0n
              ? config.chainId === 10143
                ? 'testnet'
                : 'mainnet'
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
              className={isLive ? 'paint-live-button active' : 'paint-live-button'}
              title={
                isLive
                  ? 'Live Mode is active: strokes write onchain without wallet popups and cannot be undone'
                  : 'Quick-start Live Mode with the default 2-hour / 5,000-unit session. Usually two wallet prompts once, then none per stroke. No Undo.'
              }
              disabled={liveStarting}
              onClick={() =>
                void (isLive
                  ? openProgram('pass', true, '#/pass?tab=Hardware%20Profiles')
                  : startLiveFromPaint())
              }
            >
              {liveButtonLabel}
            </Button>
            <Button
              primary
              title={wallet.account && reason ? reason : undefined}
              disabled={wallet.account ? busy || (!!reason && (isLive || walletOnCorrectChain())) : false}
              onClick={() => {
                if (!wallet.account) setWalletDialog(true)
                else if (!isLive && !walletOnCorrectChain()) void switchToMonad()
                else void paintChunks(false)
              }}
            >
              {!wallet.account
                ? 'Connect wallet'
                : !isLive && !walletOnCorrectChain()
                  ? 'Switch to Monad'
                  : `Paint ${cost.pixels} px`}
            </Button>
          </div>
          <small className={isLive ? 'paint-live-hint active' : 'paint-live-hint'}>
            {isLive
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
            txState === 'signing'
              ? isLive
                ? 'signing live paint…'
                : 'confirm in wallet…'
              : txState === 'sent'
                ? 'sent · waiting for block…'
                : 'painting…'
          ) : lastPaint ? (
            <>
              {paintedText(lastPaint)} ·{' '}
              <button
                className="link-button"
                title="follow this paint from click to finality in Monad X-ray"
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
      {progress && (
        <SaveProgress
          current={progress.current}
          total={progress.total}
          onCancel={() => {
            cancelRef.current = true
          }}
        />
      )}
      {walletDialog && (
        <MessageBox title="Connect wallet" defaultLabel="Cancel" onClose={() => setWalletDialog(false)}>
          <WalletChooser onClose={() => setWalletDialog(false)} />
        </MessageBox>
      )}
      {holderDialog && (
        <div className="modal-shade">
          <div className="message-box window">
            <b>Holder quota</b>
            <p>Enter r3tard token ids if automatic discovery is unavailable.</p>
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
            <div className="background-picker">
              {PALETTE.map((entry) => (
                <button
                  key={entry.index}
                  disabled={!ALLOWED_BACKGROUNDS.has(entry.index)}
                  className={backgroundCandidate === entry.index ? 'selected' : ''}
                  style={{ background: entry.hex }}
                  title={entry.name}
                  onClick={() => setBackgroundCandidate(entry.index)}
                />
              ))}
            </div>
            <p>max cost: {quoteText(bgKey)}</p>
            <div className="dialog-actions">
              <Button
                primary
                disabled={!(quotes[bgKey] && typeof quotes[bgKey] !== 'string')}
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
