import './sleepwalker.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react'
import { useRefreshTick } from '../chain/refreshTick'
import {
  decodeEventLog,
  formatEther,
  parseAbiItem,
  parseEther,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient, wsClient } from '../chain/clients'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { parseManualIds, resolveHolderIds } from '../chain/holders'
import { friendlyError } from '../chain/errors'
import { readMany } from '../chain/readMany'
import { getLogsWindow, scanBackward } from '../chain/logs'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_PAINT_ABI, R3TARDS_SLEEPWALKER_ABI } from '../lib/generated/abi'
import { PALETTE } from '../lib/palette'
import { idbGet, idbSet } from '../lib/idb'
import { readLabsToken, type LabsTokenData } from './labsToken'
import {
  buildSleepwalkerStencil,
  cursorPixels,
  estimateDreamSteps,
  dreamWindowBlocks,
  filterReadySleepers,
  nightShiftProfit,
  orderDreamt,
  reduceNightShiftCandidates,
  planSleepwalkerSessions,
  sleepwalkerTypedData,
  sleepwalkerStepMaxCost,
  suggestedSleepwalkerTip,
  untimedReplayOrder,
  stepCodeMessage,
  type DreamtLike,
  type SignedSession,
} from './sleepwalker'
import {
  getSleepwalkerDraft,
  markSleepwalkerDraftSubmitted,
  subscribeSleepwalkerDraft,
} from './sleepwalkerDraft'
import { getCanvasSnapshot, subscribeCanvas } from '../paint/canvasStore'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { MessageBox } from '../os/ui/MessageBox'
import { SafeImage } from '../os/ui/SafeImage'
import { closeWindow } from '../os/windows'

const DREAMT = parseAbiItem(
  'event Dreamt(address indexed owner,uint256 cursorFrom,uint256 cursorTo,uint256 pixels,uint256 blockNumber)',
)
const SLEPT = parseAbiItem(
  'event Slept(address indexed owner,address indexed key,address pointer,uint256 totalPixels,uint256 sessions,uint256 tipPerStep,uint256 deposit)',
)
const COMPLETE = parseAbiItem('event DreamComplete(address indexed owner,uint256 pixelsDreamt,uint256 steps)')
const RESUMED = parseAbiItem('event DreamResumed(address indexed owner,uint256 sessions)')
const WOKE = parseAbiItem('event Woke(address indexed owner,uint256 refund)')
const STALLED = parseAbiItem('event DreamStalled(address indexed owner,uint256 blockNumber)')
const MINTED = parseAbiItem(
  'event DreamMinted(address indexed owner,uint256 indexed tokenId,bool complete,uint256 survivalBps)',
)

type Tab = 'tonight' | 'morning' | 'night'

type DreamView = {
  pointer: Address
  cursor: bigint
  totalPixels: bigint
  deposit: bigint
  tip: bigint
  sessionsLeft: bigint
  nextStepBlock: bigint
  stalled: boolean
}

type AllowanceView = {
  humanPixels: bigint
  dreamPixels: bigint
  allowance: bigint
  gate: boolean
}

type Sleeper = {
  owner: Address
  tip: bigint
  deposit: bigint
  ready: boolean
  result?: string
}

type ConfirmState = {
  title: string
  message: string
  defaultLabel: string
  run: () => Promise<void>
}

const EMPTY_DREAM: DreamView = {
  pointer: zeroAddress,
  cursor: 0n,
  totalPixels: 0n,
  deposit: 0n,
  tip: 0n,
  sessionsLeft: 0n,
  nextStepBlock: 0n,
  stalled: false,
}
const EMPTY_ALLOWANCE: AllowanceView = { humanPixels: 0n, dreamPixels: 0n, allowance: 0n, gate: false }

function tabFromHash(): Tab {
  const tab = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab')
  return tab === 'morning' || tab === 'night' ? tab : 'tonight'
}

function short(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function asTuple(value: unknown) {
  return value as readonly unknown[]
}

function stateFromRows(rows: readonly any[]) {
  const read = (index: number) => (rows[index]?.status === 'success' ? rows[index].result : undefined)
  const allowance = asTuple(read(0) ?? [0n, 0n, 0n, false])
  const dream = asTuple(read(1) ?? [zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false])
  return {
    allowance: {
      humanPixels: BigInt(allowance[0] as bigint),
      dreamPixels: BigInt(allowance[1] as bigint),
      allowance: BigInt(allowance[2] as bigint),
      gate: Boolean(allowance[3]),
    } as AllowanceView,
    dream: {
      pointer: String(dream[0]) as Address,
      cursor: BigInt(dream[1] as bigint),
      totalPixels: BigInt(dream[2] as bigint),
      deposit: BigInt(dream[3] as bigint),
      tip: BigInt(dream[4] as bigint),
      sessionsLeft: BigInt(dream[5] as bigint),
      nextStepBlock: BigInt(dream[6] as bigint),
      stalled: Boolean(dream[7]),
    } as DreamView,
    dreamingDays: BigInt((read(2) as bigint | undefined) ?? 0n),
    refund: BigInt((read(3) as bigint | undefined) ?? 0n),
    key: String(read(4) ?? zeroAddress) as Address,
    nonce: BigInt((read(5) as bigint | undefined) ?? 0n),
    maxSessionBlocks: BigInt((read(6) as bigint | undefined) ?? 24_000n),
  }
}

async function pointerBytes(pointer: Address) {
  if (!publicClient || pointer === zeroAddress) return '0x' as Hex
  const code = await publicClient.getCode({ address: pointer })
  if (!code || code === '0x' || code.length <= 4) return '0x' as Hex
  return `0x${code.slice(4)}` as Hex
}

function sleptStorageKey(owner: Address) {
  return `r3os.sleepwalker.slept.${config.chainId}.${owner.toLowerCase()}`
}

function readStoredSleptBlock(owner: Address) {
  try {
    const value = localStorage.getItem(sleptStorageKey(owner))
    return value && /^\d+$/.test(value) ? BigInt(value) : undefined
  } catch {
    return undefined
  }
}

function writeStoredSleptBlock(owner: Address, blockNumber: bigint) {
  try {
    localStorage.setItem(sleptStorageKey(owner), blockNumber.toString())
  } catch {
    // Replay still works through bounded log discovery when storage is unavailable.
  }
}

type CachedOwnerEvent = {
  kind: 'Dreamt' | 'DreamComplete' | 'DreamStalled' | 'DreamMinted'
  blockNumber: bigint
  cursorFrom?: bigint
  cursorTo?: bigint
  pixels?: bigint
}

type OwnerEventCache = { scannedTo: bigint; events: CachedOwnerEvent[] }
type NightCache = { scannedTo: bigint; owners: Address[] }

export function survivalPercent(stencil: Hex, cursor: number, live: Uint8Array) {
  const points = cursorPixels(stencil, cursor)
  if (!points.length) return 0
  let survived = 0
  for (const point of points) if (live[point.y * 256 + point.x] === point.colour) survived++
  return Math.round((survived * 1000) / points.length) / 10
}

function StencilPreview({
  runs,
  cursor,
  background,
  backgroundColor = 0,
}: {
  runs: Hex
  cursor?: number
  background?: Uint8Array
  backgroundColor?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pixels = useMemo(() => cursorPixels(runs, cursor ?? Number.MAX_SAFE_INTEGER), [runs, cursor])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.imageSmoothingEnabled = false
    const image = context.createImageData(256, 256)
    const rgba = image.data
    for (let index = 0; index < 65_536; index++) {
      const raw = background?.[index] ?? backgroundColor
      const colourIndex = raw === 0 ? backgroundColor : raw
      const [r, g, b] = PALETTE[colourIndex]?.rgb ?? [0, 0, 0]
      const offset = index * 4
      rgba[offset] = r
      rgba[offset + 1] = g
      rgba[offset + 2] = b
      rgba[offset + 3] = 255
    }
    for (const pixel of pixels) {
      const [r, g, b] = PALETTE[pixel.colour]?.rgb ?? [255, 255, 255]
      const offset = (pixel.y * 256 + pixel.x) * 4
      rgba[offset] = r
      rgba[offset + 1] = g
      rgba[offset + 2] = b
      rgba[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [pixels, background, backgroundColor])

  return (
    <div className="sleep-stencil sunken">
      <canvas ref={ref} width={256} height={256} aria-label="dream stencil preview" />
    </div>
  )
}

export function SleepwalkerProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const refreshTick = useRefreshTick()
  const canvas = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const draft = useSyncExternalStore(subscribeSleepwalkerDraft, getSleepwalkerDraft)
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [address, setAddress] = useState<Address>()
  const [allowance, setAllowance] = useState<AllowanceView>(EMPTY_ALLOWANCE)
  const [dream, setDream] = useState<DreamView>(EMPTY_DREAM)
  const [dreamingDays, setDreamingDays] = useState(0n)
  const [refund, setRefund] = useState(0n)
  const [key, setKey] = useState<Address>(zeroAddress)
  const [nonce, setNonce] = useState(0n)
  const [maxSessionBlocks, setMaxSessionBlocks] = useState(24_000n)
  const [sessionCount, setSessionCount] = useState(4)
  const [holderIds, setHolderIds] = useState<bigint[]>([])
  const [manualHolderIds, setManualHolderIds] = useState('')
  const [holderDialog, setHolderDialog] = useState(false)
  const [tip, setTip] = useState('0.01')
  const [tipEdited, setTipEdited] = useState(false)
  const [maxFeePerGas, setMaxFeePerGas] = useState(0n)
  const [deposit, setDeposit] = useState('0.50')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState>()
  const [stencil, setStencil] = useState<Hex>('0x')
  const [dreamt, setDreamt] = useState<DreamtLike[]>([])
  const [replayCursor, setReplayCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lastSleepBlock, setLastSleepBlock] = useState<bigint>()
  const [lastCompleteBlock, setLastCompleteBlock] = useState<bigint>()
  const [stalledAt, setStalledAt] = useState<bigint>()
  const [lastMintBlock, setLastMintBlock] = useState<bigint>()
  const [minted, setMinted] = useState<LabsTokenData>()
  const [sleepers, setSleepers] = useState<Sleeper[]>([])
  const [ownerProgress, setOwnerProgress] = useState('')
  const [nightProgress, setNightProgress] = useState('')
  const [untimedReplay, setUntimedReplay] = useState(false)
  const [refundTo, setRefundTo] = useState('')
  const ownerScanRef = useRef({ key: '', missing: false, running: false })
  const nightAbortRef = useRef<AbortController | null>(null)
  const DREAM_WINDOW_BLOCKS = dreamWindowBlocks(maxSessionBlocks)

  useEffect(() => {
    void discoverContracts().then((contracts) => setAddress(contracts.labs.sleepwalker))
  }, [])

  const refresh = useCallback(async () => {
    if (!publicClient || !wallet.account || !address || !config.paintAddress) return
    const rows = await readMany(
      [
        { address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'allowanceOf', args: [wallet.account] },
        { address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'dreamOf', args: [wallet.account] },
        { address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'dreamingDays', args: [wallet.account] },
        { address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'refunds', args: [wallet.account] },
        { address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'keyOf', args: [wallet.account] },
        {
          address: config.paintAddress,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'sessionNonces',
          args: [wallet.account],
        },
        { address: config.paintAddress, abi: R3TARDS_PAINT_ABI, functionName: 'MAX_SESSION_BLOCKS' },
      ],
      { allowFailure: true },
    )
    const next = stateFromRows(rows as any[])
    setAllowance(next.allowance)
    setDream(next.dream)
    setDreamingDays(next.dreamingDays)
    setRefund(next.refund)
    setKey(next.key)
    setNonce(next.nonce)
    setMaxSessionBlocks(next.maxSessionBlocks)
  }, [wallet.account, address])

  useEffect(() => {
    void refresh().catch((caught) => setError(friendlyError(caught, 'sleepwalker').message))
  }, [refresh, refreshTick])

  const loadOwnerEvents = useCallback(async () => {
    if (!wallet.account || !address || !publicClient) return
    const owner = wallet.account
    // No stored dream: nothing to replay, so no log reads at all.
    if (dream.pointer === zeroAddress) {
      setUntimedReplay(false)
      setDreamt([])
      setLastSleepBlock(undefined)
      setLastCompleteBlock(undefined)
      setStalledAt(undefined)
      setLastMintBlock(undefined)
      setOwnerProgress('')
      return
    }
    const scanKey = `${owner.toLowerCase()}:${dream.pointer.toLowerCase()}`
    const scan = ownerScanRef.current
    // One scan at a time, and a dream whose Slept block is outside the window is scanned once, not every tick.
    if (scan.running || (scan.key === scanKey && scan.missing)) return
    ownerScanRef.current = { key: scanKey, missing: false, running: true }
    try {
      const head = await publicClient.getBlockNumber({ cacheTime: 0 })
      let sleptBlock = readStoredSleptBlock(owner)
      if (sleptBlock == null || sleptBlock > head || head - sleptBlock + 1n > DREAM_WINDOW_BLOCKS) {
        const slept = await scanBackward({
          address,
          event: SLEPT,
          args: { owner },
          maxBlocks: DREAM_WINDOW_BLOCKS,
          until: (logs) => logs.length > 0,
          onProgress: (done, total) =>
            setOwnerProgress(
              `reading your dream… ${Math.min(100, Math.round((Number(done) / Number(total || 1n)) * 100))}%`,
            ),
        })
        sleptBlock = slept.at(-1)?.blockNumber
        if (sleptBlock != null) writeStoredSleptBlock(owner, sleptBlock)
      }
      if (sleptBlock == null || sleptBlock > head || head - sleptBlock + 1n > DREAM_WINDOW_BLOCKS) {
        ownerScanRef.current = { key: scanKey, missing: true, running: false }
        setUntimedReplay(true)
        setDreamt([])
        setLastSleepBlock(undefined)
        setLastCompleteBlock(undefined)
        setStalledAt(undefined)
        setLastMintBlock(undefined)
        setOwnerProgress('untimed replay')
        return
      }

      setUntimedReplay(false)
      setLastSleepBlock(sleptBlock)
      const pointer = dream.pointer === zeroAddress ? 'none' : dream.pointer.toLowerCase()
      const cacheKey = `sleep:${config.chainId}:${owner.toLowerCase()}:${pointer}`
      const cached = await idbGet<OwnerEventCache>('logCache', cacheKey)
      let events = cached?.events?.filter((event) => event.blockNumber >= sleptBlock!) ?? []
      let fromBlock = sleptBlock
      if (cached && cached.scannedTo >= sleptBlock) fromBlock = cached.scannedTo + 1n
      if (fromBlock <= head) {
        const rows = await getLogsWindow({
          address,
          events: [DREAMT, COMPLETE, STALLED, MINTED],
          args: { owner },
          fromBlock,
          toBlock: head,
          maxBlocks: DREAM_WINDOW_BLOCKS,
          onProgress: (done, total) =>
            setOwnerProgress(
              `reading your dream… ${Math.min(100, Math.round((Number(done) / Number(total || 1n)) * 100))}%`,
            ),
        })
        for (const log of rows as any[]) {
          const kind = String(log.eventName ?? '') as CachedOwnerEvent['kind']
          if (
            kind !== 'Dreamt' &&
            kind !== 'DreamComplete' &&
            kind !== 'DreamStalled' &&
            kind !== 'DreamMinted'
          )
            continue
          const args = log.args ?? {}
          events.push({
            kind,
            blockNumber: BigInt(log.blockNumber ?? args.blockNumber ?? 0n),
            cursorFrom: kind === 'Dreamt' ? BigInt(args.cursorFrom ?? 0n) : undefined,
            cursorTo: kind === 'Dreamt' ? BigInt(args.cursorTo ?? 0n) : undefined,
            pixels: kind === 'Dreamt' ? BigInt(args.pixels ?? 0n) : undefined,
          })
        }
        events.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1))
        await idbSet('logCache', cacheKey, { scannedTo: head, events } satisfies OwnerEventCache)
      }

      const dreamEvents = events
        .filter((event) => event.kind === 'Dreamt')
        .map((event) => ({
          cursorFrom: event.cursorFrom ?? 0n,
          cursorTo: event.cursorTo ?? 0n,
          pixels: event.pixels ?? 0n,
          blockNumber: event.blockNumber,
        }))
      setDreamt(orderDreamt(dreamEvents))
      setLastCompleteBlock(events.filter((event) => event.kind === 'DreamComplete').at(-1)?.blockNumber)
      setStalledAt(events.filter((event) => event.kind === 'DreamStalled').at(-1)?.blockNumber)
      setLastMintBlock(events.filter((event) => event.kind === 'DreamMinted').at(-1)?.blockNumber)
      setOwnerProgress('')
    } catch (caught) {
      setOwnerProgress('')
      setError(friendlyError(caught, 'Dreamt').message)
    } finally {
      ownerScanRef.current = { ...ownerScanRef.current, running: false }
    }
  }, [wallet.account, address, dream.pointer, DREAM_WINDOW_BLOCKS])

  useEffect(() => {
    if (wallet.account && address) void loadOwnerEvents()
  }, [wallet.account, address, loadOwnerEvents, refreshTick])

  useEffect(() => {
    if (!dream.pointer || dream.pointer === zeroAddress) {
      if (draft?.runs) setStencil(draft.runs)
      return
    }
    void pointerBytes(dream.pointer).then((value) => {
      setStencil(value)
      setReplayCursor(Number(dream.cursor))
    })
  }, [dream.pointer, dream.cursor, draft?.runs])

  useEffect(() => {
    if (!playing) return
    if (untimedReplay) {
      const order = untimedReplayOrder(Number(dream.cursor))
      const next = order.find((value) => value > replayCursor)
      if (next == null) return setPlaying(false)
      const timer = window.setTimeout(() => setReplayCursor(next), 140)
      return () => window.clearTimeout(timer)
    }
    if (!dreamt.length) return setPlaying(false)
    let index = dreamt.findIndex((event) => Number(event.cursorTo) > replayCursor)
    if (index < 0) index = dreamt.length
    if (index >= dreamt.length) return setPlaying(false)
    const gap = index === 0 ? 1n : BigInt(dreamt[index].blockNumber) - BigInt(dreamt[index - 1].blockNumber)
    const timer = window.setTimeout(
      () => setReplayCursor(Number(dreamt[index].cursorTo)),
      Math.max(90, Math.min(1_500, Number(gap) * Math.max(100, block.blockTimeMs))),
    )
    return () => window.clearTimeout(timer)
  }, [playing, replayCursor, dreamt, dream.cursor, untimedReplay, block.blockTimeMs])

  useEffect(() => {
    if (!publicClient || (tab !== 'tonight' && tab !== 'night')) return
    let cancelled = false
    void publicClient
      .estimateFeesPerGas()
      .then((rawFees) => {
        if (cancelled) return
        const fees = rawFees as { maxFeePerGas?: bigint; gasPrice?: bigint }
        const value = fees.maxFeePerGas ?? fees.gasPrice ?? 0n
        setMaxFeePerGas(value)
        if (!tipEdited && value > 0n) setTip(formatEther(suggestedSleepwalkerTip(value)))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tab, tipEdited, block.block / 20n])

  const refreshReadiness = useCallback(
    async (current: readonly Sleeper[]) => {
      if (!address || !current.length) return
      try {
        const owners = current.map((item) => item.owner)
        const rows = await readMany(
          [
            { address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'stepReady', args: [owners] },
            ...owners.map((owner) => ({
              address,
              abi: R3TARDS_SLEEPWALKER_ABI,
              functionName: 'dreamOf',
              args: [owner],
            })),
          ],
          { allowFailure: true },
        )
        const ready = rows[0]?.status === 'success' ? (rows[0].result as boolean[]) : []
        setSleepers((existing) =>
          existing.map((item) => {
            const index = owners.findIndex((owner) => owner.toLowerCase() === item.owner.toLowerCase())
            if (index < 0) return item
            const dreamRow = rows[index + 1] as any
            const dreamTuple = dreamRow?.status === 'success' ? asTuple(dreamRow.result) : undefined
            return {
              ...item,
              ready: ready[index] === true,
              deposit: dreamTuple ? BigInt(dreamTuple[3] as bigint) : item.deposit,
              tip: dreamTuple ? BigInt(dreamTuple[4] as bigint) : item.tip,
            }
          }),
        )
      } catch {
        // Keep the last readiness snapshot; the next block tries again.
      }
    },
    [address],
  )

  const discoverSleepers = useCallback(async () => {
    if (!address || !publicClient) return
    nightAbortRef.current?.abort()
    const controller = new AbortController()
    nightAbortRef.current = controller
    setBusy('finding sleepers…')
    setNightProgress('reading Night Shift…')
    try {
      const head = await publicClient.getBlockNumber({ cacheTime: 0 })
      const floor = head >= DREAM_WINDOW_BLOCKS - 1n ? head - DREAM_WINDOW_BLOCKS + 1n : 0n
      const cacheKey = `sleep-night:${config.chainId}:${address.toLowerCase()}`
      const cached = await idbGet<NightCache>('logCache', cacheKey)
      let owners = cached?.owners ?? []
      let fromBlock = floor
      if (cached && cached.scannedTo >= floor) fromBlock = cached.scannedTo + 1n
      if (fromBlock <= head) {
        const logs = await getLogsWindow({
          address,
          events: [SLEPT, RESUMED],
          fromBlock,
          toBlock: head,
          maxBlocks: DREAM_WINDOW_BLOCKS,
          signal: controller.signal,
          onProgress: (done, total) =>
            setNightProgress(
              `reading Night Shift… ${Math.min(100, Math.round((Number(done) / Number(total || 1n)) * 100))}%`,
            ),
        })
        const additions = reduceNightShiftCandidates(
          (logs as any[]).flatMap((log) =>
            log.args?.owner
              ? [{ owner: log.args.owner as Address, tip: log.args?.tipPerStep as bigint | undefined }]
              : [],
          ),
        ).map((item) => item.owner)
        const merged = new Map<string, Address>()
        for (const owner of [...owners, ...additions]) merged.set(owner.toLowerCase(), owner)
        owners = [...merged.values()]
        await idbSet('logCache', cacheKey, { scannedTo: head, owners } satisfies NightCache)
      }
      if (controller.signal.aborted) return
      if (!owners.length) {
        setSleepers([])
        return
      }
      const rows = await readMany(
        [
          { address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'stepReady', args: [owners] },
          ...owners.map((owner) => ({
            address,
            abi: R3TARDS_SLEEPWALKER_ABI,
            functionName: 'dreamOf',
            args: [owner],
          })),
        ],
        { allowFailure: true },
      )
      const ready = rows[0]?.status === 'success' ? (rows[0].result as boolean[]) : []
      const next = owners.flatMap((owner, index) => {
        const row = rows[index + 1] as any
        if (row?.status !== 'success') return []
        const tuple = asTuple(row.result)
        const pointer = String(tuple[0] ?? zeroAddress) as Address
        const deposit = BigInt(tuple[3] as bigint)
        const tip = BigInt(tuple[4] as bigint)
        const stalled = Boolean(tuple[7])
        if (pointer === zeroAddress || stalled) return []
        return [{ owner, tip, deposit, ready: ready[index] === true }]
      })
      setSleepers(next)
    } catch (caught) {
      if ((caught as Error)?.name !== 'AbortError') setError(friendlyError(caught, 'stepReady').message)
    } finally {
      if (nightAbortRef.current === controller) nightAbortRef.current = null
      setNightProgress('')
      setBusy('')
    }
  }, [address, DREAM_WINDOW_BLOCKS])

  useEffect(() => {
    if (tab === 'night') void discoverSleepers()
  }, [tab, discoverSleepers])

  useEffect(() => {
    if (tab === 'night') return
    nightAbortRef.current?.abort()
    nightAbortRef.current = null
    setNightProgress('')
  }, [tab])

  useEffect(() => {
    if (tab === 'night' && sleepers.length) void refreshReadiness(sleepers)
  }, [tab, refreshTick, refreshReadiness])

  useEffect(() => {
    if (tab !== 'night' || !wsClient || !address) return
    const stopSlept = wsClient.watchContractEvent({
      address,
      abi: R3TARDS_SLEEPWALKER_ABI,
      eventName: 'Slept',
      onLogs: (logs) => {
        setSleepers((current) => {
          const next = [...current]
          for (const log of logs) {
            const args = log.args as { owner?: Address; tipPerStep?: bigint }
            if (!args.owner) continue
            const index = next.findIndex((item) => item.owner.toLowerCase() === args.owner!.toLowerCase())
            const item: Sleeper = { owner: args.owner, tip: args.tipPerStep ?? 0n, deposit: 0n, ready: false }
            if (index < 0) next.push(item)
            else next[index] = { ...next[index], ...item }
          }
          return next
        })
      },
    })
    const remove = (logs: readonly any[]) => {
      const owners = new Set(logs.map((log) => String(log.args?.owner ?? '').toLowerCase()))
      setSleepers((current) => current.filter((item) => !owners.has(item.owner.toLowerCase())))
    }
    const stopResumed = wsClient.watchContractEvent({
      address,
      abi: R3TARDS_SLEEPWALKER_ABI,
      eventName: 'DreamResumed',
      onLogs: () => void discoverSleepers(),
    })
    const stopComplete = wsClient.watchContractEvent({
      address,
      abi: R3TARDS_SLEEPWALKER_ABI,
      eventName: 'DreamComplete',
      onLogs: remove,
    })
    const stopWoke = wsClient.watchContractEvent({
      address,
      abi: R3TARDS_SLEEPWALKER_ABI,
      eventName: 'Woke',
      onLogs: remove,
    })
    return () => {
      stopSlept()
      stopResumed()
      stopComplete()
      stopWoke()
    }
  }, [tab, address, discoverSleepers])

  useEffect(() => {
    if (draft) setHolderIds([...draft.holderIds])
  }, [draft?.version])

  async function refreshHolderIds() {
    if (!wallet.account || !publicClient) return
    try {
      const contracts = await discoverContracts()
      if (!contracts.r3tards) return
      const ids = await resolveHolderIds(
        publicClient,
        contracts.r3tards,
        wallet.account,
        parseManualIds(manualHolderIds),
      )
      setHolderIds(ids)
    } catch (caught) {
      setError(friendlyError(caught, 'holder ids').message)
    }
  }

  const currentDreamMinted = Boolean(lastSleepBlock && lastMintBlock && lastMintBlock >= lastSleepBlock)
  const completedUnminted = Boolean(
    lastCompleteBlock && lastSleepBlock && lastCompleteBlock >= lastSleepBlock && !currentDreamMinted,
  )
  const draftStencil = useMemo(() => {
    try {
      return draft ? buildSleepwalkerStencil(draft.runs) : undefined
    } catch {
      return undefined
    }
  }, [draft])
  const survival = useMemo(
    () => (stencil !== '0x' ? survivalPercent(stencil, Number(dream.cursor), canvas.background) : 0),
    [stencil, dream.cursor, canvas.background],
  )

  async function signSessions(count = sessionCount) {
    if (!wallet.account || !wallet.client || key === zeroAddress) throw new Error('connect your wallet first')
    const pixels = draftStencil?.pixels || Number(dream.totalPixels) || 1
    const maxUnits = BigInt(Math.max(2, pixels * 2))
    const deadline = BigInt(Math.floor(Date.now() / 1_000) + (count + 1) * 3 * 60 * 60)
    const plans = planSleepwalkerSessions({
      owner: wallet.account,
      sessionKey: key,
      block: block.block,
      nonce,
      count,
      maxSessionBlocks,
      maxUnits,
      deadline,
    })
    const signed: SignedSession[] = []
    for (let index = 0; index < plans.length; index++) {
      setBusy(`signing session ${index + 1} of ${plans.length}…`)
      const plan = plans[index]
      const sig = (await wallet.client.signTypedData({
        account: wallet.account,
        ...sleepwalkerTypedData(plan),
      })) as Hex
      signed.push({
        expiryBlock: plan.expiryBlock,
        maxUnits: plan.maxUnits,
        nonce: plan.nonce,
        deadline: plan.deadline,
        sig,
      })
    }
    return signed
  }

  async function goToSleep() {
    if (!wallet.account || !address || !draft || !draftStencil) return
    let tipWei: bigint
    let depositWei: bigint
    try {
      tipWei = parseEther(tip)
      depositWei = parseEther(deposit)
      if (tipWei <= 0n) throw new Error('tip per step must be above zero')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'enter valid MON amounts')
      return
    }
    setBusy('signing…')
    try {
      const sessions = await signSessions()
      setBusy('quoting sleep…')
      const action = {
        kind: 'estimate' as const,
        address,
        abi: R3TARDS_SLEEPWALKER_ABI,
        functionName: 'sleep',
        args: [draft.runs, holderIds, sessions, tipWei],
        account: wallet.account,
        value: depositWei,
        action: 'go to sleep',
      }
      const quote = await quoteAction(action)
      setConfirm({
        title: 'Go to sleep',
        message: `${quote.maxCost} for the transaction, plus ${deposit} MON tip deposit. ${completedUnminted ? 'sleeping again discards the mint option for your last dream. ' : ''}Submit the dream?`,
        defaultLabel: 'Go to sleep',
        run: async () => {
          const result = await sendAction({ ...action, quote })
          writeStoredSleptBlock(wallet.account!, result.blockNumber)
          markSleepwalkerDraftSubmitted(draft.version)
          setTab('morning')
          await refresh()
          await loadOwnerEvents()
        },
      })
    } catch (caught) {
      setError(friendlyError(caught, 'sleep').message)
    } finally {
      setBusy('')
    }
  }

  async function resume() {
    if (!wallet.account || !address) return
    setBusy('signing…')
    try {
      const sessions = await signSessions()
      const action = {
        kind: 'estimate' as const,
        address,
        abi: R3TARDS_SLEEPWALKER_ABI,
        functionName: 'resume',
        args: [sessions],
        account: wallet.account,
        action: 'resume dream',
      }
      const quote = await quoteAction(action)
      setConfirm({
        title: 'Resume dream',
        message: `${quote.maxCost}. Start with fresh consecutive session signatures and keep the current stencil progress?`,
        defaultLabel: 'Resume',
        run: async () => {
          const result = await sendAction({ ...action, quote })
          writeStoredSleptBlock(wallet.account!, result.blockNumber)
          await refresh()
        },
      })
    } catch (caught) {
      setError(friendlyError(caught, 'resume').message)
    } finally {
      setBusy('')
    }
  }

  async function wake() {
    if (!wallet.account || !address || !config.paintAddress) return
    try {
      let revokeQuote: ActionQuote | undefined
      if (key !== zeroAddress && publicClient) {
        const session = (await publicClient.readContract({
          address: config.paintAddress,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'sessionInfo',
          args: [key],
        })) as readonly [Address, bigint, bigint, bigint, boolean, boolean]
        if (session[0].toLowerCase() === wallet.account.toLowerCase() && session[5]) {
          revokeQuote = await quoteAction({
            kind: 'estimate',
            address: config.paintAddress,
            abi: R3TARDS_PAINT_ABI,
            functionName: 'revokeSession',
            args: [key],
            account: wallet.account,
            action: 'revoke Sleepwalker session',
          })
        }
      }
      const wakeAction = {
        kind: 'estimate' as const,
        address,
        abi: R3TARDS_SLEEPWALKER_ABI,
        functionName: 'wake',
        account: wallet.account,
        action: 'wake up',
      }
      const wakeQuote = await quoteAction(wakeAction)
      const cost = revokeQuote
        ? `${revokeQuote.maxCost} to revoke, then ${wakeQuote.maxCost} to wake`
        : wakeQuote.maxCost
      setConfirm({
        title: 'Wake up',
        message: `${cost}. Revoking the session key alone doesn't stop the dream: the next signed night starts by itself. Wake up deletes unused signatures and refunds your deposit.`,
        defaultLabel: 'Wake up',
        run: async () => {
          if (revokeQuote) {
            await sendAction({
              kind: 'estimate',
              address: config.paintAddress!,
              abi: R3TARDS_PAINT_ABI,
              functionName: 'revokeSession',
              args: [key],
              account: wallet.account!,
              quote: revokeQuote,
              action: 'revoke Sleepwalker session',
            })
          }
          await sendAction({ ...wakeAction, quote: wakeQuote })
          await refresh()
        },
      })
    } catch (caught) {
      setError(friendlyError(caught, 'wake').message)
    }
  }

  async function simpleAction(functionName: 'withdrawRefund' | 'mintDream') {
    if (!wallet.account || !address) return
    try {
      const action = {
        kind: 'estimate' as const,
        address,
        abi: R3TARDS_SLEEPWALKER_ABI,
        functionName,
        account: wallet.account,
        action: functionName === 'mintDream' ? 'mint dream' : 'withdraw Sleepwalker refund',
      }
      const quote = await quoteAction(action)
      setConfirm({
        title: functionName === 'mintDream' ? 'Mint dream' : 'Withdraw refund',
        message: quote.maxCost,
        defaultLabel: functionName === 'mintDream' ? 'Mint dream' : 'Withdraw',
        run: async () => {
          const result = await sendAction({ ...action, quote })
          if (functionName === 'mintDream') {
            for (const log of result.receipt.logs) {
              try {
                const decoded = decodeEventLog({
                  abi: R3TARDS_SLEEPWALKER_ABI,
                  data: log.data,
                  topics: log.topics,
                })
                if (decoded.eventName === 'DreamMinted') {
                  const id = BigInt((decoded.args as { tokenId: bigint }).tokenId)
                  setMinted(await readLabsToken(id))
                }
              } catch {
                // Other receipt logs are unrelated.
              }
            }
          }
          await refresh()
          await loadOwnerEvents()
        },
      })
    } catch (caught) {
      setError(friendlyError(caught, functionName).message)
    }
  }

  async function withdrawRefundTo() {
    if (!wallet.account || !address) return
    if (!isAddress(refundTo)) {
      setError('enter a valid refund address')
      return
    }
    try {
      const action = {
        kind: 'estimate' as const,
        address,
        abi: R3TARDS_SLEEPWALKER_ABI,
        functionName: 'withdrawRefundTo',
        args: [refundTo as Address],
        account: wallet.account,
        action: 'withdraw Sleepwalker refund to another address',
      }
      const quote = await quoteAction(action)
      setConfirm({
        title: 'Send refund',
        message: `${quote.maxCost}. Send the whole pending refund to ${refundTo}?`,
        defaultLabel: 'Send',
        run: async () => {
          await sendAction({ ...action, quote })
          setRefundTo('')
          await refresh()
        },
      })
    } catch (caught) {
      setError(friendlyError(caught, 'withdrawRefundTo').message)
    }
  }

  async function quoteStep(owner: Address) {
    if (!wallet.account || !address) throw new Error('connect a wallet')
    const action = {
      kind: 'sleepwalkerStep' as const,
      address,
      abi: R3TARDS_SLEEPWALKER_ABI,
      functionName: 'step',
      args: [owner],
      account: wallet.account,
      action: `step ${short(owner)}`,
    }
    const quote = await quoteAction(action)
    return { action, quote }
  }

  async function stepOne(owner: Address) {
    try {
      const { action, quote } = await quoteStep(owner)
      setConfirm({
        title: 'Night Shift',
        message: `${quote.maxCost}. A not-ready step still costs gas and pays nothing; this sleeper currently passes stepReady.`,
        defaultLabel: 'Step',
        run: async () => {
          const result = await sendAction({ ...action, quote })
          let message = 'step sent'
          for (const log of result.receipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: R3TARDS_SLEEPWALKER_ABI,
                data: log.data,
                topics: log.topics,
              })
              if (decoded.eventName === 'StepResult') {
                const code = Number((decoded.args as { code: number }).code)
                const wait =
                  code === 7 && dream.nextStepBlock > result.blockNumber
                    ? dream.nextStepBlock - result.blockNumber
                    : undefined
                message = stepCodeMessage(code, wait)
              }
            } catch {
              // Ignore unrelated logs.
            }
          }
          setSleepers((current) =>
            current.map((item) => (item.owner === owner ? { ...item, result: message } : item)),
          )
          await discoverSleepers()
        },
      })
    } catch (caught) {
      setError(friendlyError(caught, 'step').message)
    }
  }

  async function stepAll() {
    const ready = filterReadySleepers(
      sleepers,
      sleepers.map((s) => s.ready && maxFeePerGas > 0n && nightShiftProfit(s.tip, maxFeePerGas).profitable),
    )
    if (!ready.length) return
    try {
      const quoted = [] as Awaited<ReturnType<typeof quoteStep>>[]
      for (const sleeper of ready) quoted.push(await quoteStep(sleeper.owner))
      const totalWei = quoted.reduce((sum, item) => sum + item.quote.gasLimit * item.quote.maxFeePerGas, 0n)
      setConfirm({
        title: 'Step all',
        message: `${formatEther(totalWei)} MON max across ${quoted.length} separate transactions. Confirm once here; your wallet will still receive one transaction request per sleeper.`,
        defaultLabel: `Step all (${quoted.length})`,
        run: async () => {
          for (const item of quoted) await sendAction({ ...item.action, quote: item.quote })
          await discoverSleepers()
        },
      })
    } catch (caught) {
      setError(friendlyError(caught, 'step').message)
    }
  }

  if (!address) {
    return <div className="program-pad">this Lab isn't deployed on this network</div>
  }

  return (
    <div className="sleepwalker-program">
      <MenuBar
        menus={[
          { label: 'File', items: [{ label: 'Close', action: () => closeWindow('sleepwalker') }] },
          { label: 'View', items: [{ label: 'Refresh', action: () => void refresh() }] },
          { label: 'Help', items: [{ label: 'How it works', disabled: true }] },
        ]}
      />
      <IntroBar
        lead="Your drawing paints itself while you sleep. You have to paint to dream: every pixel you paint by hand earns 2 dream pixels."
        monad="every step is a real transaction, cranked by other players for tips; 3 blocks a second makes the replay look drawn, not stepped."
        rules={[
          'paint enough by hand today to open the day gate;',
          'every human pixel earns two dream pixels for that UTC day;',
          'pre-sign 1–4 roughly two-hour sessions before bed;',
          'crankers earn the configured tip only when a step actually paints.',
        ]}
      />
      <div className="sleep-tabs" role="tablist">
        {(['tonight', 'morning', 'night'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'active' : ''}
            onClick={() => setTab(value)}
          >
            {value === 'night' ? 'Night Shift' : value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      <main className="sleep-body">
        {tab === 'tonight' && (
          <div className="sleep-tonight">
            <section className="sleep-stats">
              <div className="sunken">
                <small>human pixels today</small>
                <b>{allowance.humanPixels.toString()}</b>
              </div>
              <div className="sunken">
                <small>dream allowance left</small>
                <b>{allowance.allowance.toString()} px</b>
              </div>
              <div className="sunken">
                <small>day gate</small>
                <b>{allowance.gate ? 'open ✓' : 'closed'}</b>
              </div>
              <div className="sunken">
                <small>dreaming days</small>
                <b>{dreamingDays.toString()}</b>
              </div>
            </section>
            <div className="sleep-columns">
              <GroupBox title="Stencil">
                {draftStencil ? (
                  <>
                    <StencilPreview runs={draft!.runs} />
                    <p>
                      {draftStencil.pixels.toLocaleString()} px · about{' '}
                      {estimateDreamSteps(draftStencil.pixels)} successful steps
                    </p>
                    <p className="muted">
                      holder ids: {holderIds.length ? holderIds.map(String).join(', ') : 'none'}{' '}
                      <Button onClick={() => setHolderDialog(true)}>Choose…</Button>
                    </p>
                  </>
                ) : (
                  <p>
                    Paint something, then choose <b>File → Dream this…</b> in Paint.
                  </p>
                )}
              </GroupBox>
              <GroupBox title="Before bed">
                <label>
                  Sessions
                  <select
                    value={sessionCount}
                    onChange={(event) => setSessionCount(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4].map((count) => {
                      const hours =
                        (Number(maxSessionBlocks) * Math.max(block.blockTimeMs, 300) * count) / 3_600_000
                      return (
                        <option key={count} value={count}>
                          {count} · about {hours.toFixed(hours < 10 ? 1 : 0)} h
                        </option>
                      )
                    })}
                  </select>
                </label>
                <label>
                  Tip per step
                  <span className="sleep-money">
                    <input
                      value={tip}
                      onChange={(event) => {
                        setTipEdited(true)
                        setTip(event.target.value)
                      }}
                    />{' '}
                    MON
                  </span>
                </label>
                {maxFeePerGas > 0n &&
                  (() => {
                    let entered = 0n
                    try {
                      entered = parseEther(tip || '0')
                    } catch {
                      /* live validation below */
                    }
                    const cost = sleepwalkerStepMaxCost(maxFeePerGas)
                    return (
                      <p className={entered < cost ? 'sleep-tip-warning' : 'muted'}>
                        crankers pay up to {Number(formatEther(cost)).toPrecision(3)} MON per step. tips below
                        that probably won't get cranked.
                      </p>
                    )
                  })()}
                <label>
                  Tip deposit
                  <span className="sleep-money">
                    <input value={deposit} onChange={(event) => setDeposit(event.target.value)} /> MON
                  </span>
                </label>
                {completedUnminted && (
                  <p className="warning-line">sleeping again discards the mint option for your last dream</p>
                )}
                <Button
                  primary
                  disabled={!wallet.account || !draftStencil || Boolean(busy)}
                  onClick={() => void goToSleep()}
                >
                  {busy || 'Go to sleep'}
                </Button>
              </GroupBox>
            </div>
          </div>
        )}

        {tab === 'morning' && (
          <div className="sleep-morning">
            <div className="sleep-columns morning">
              <GroupBox title="Replay">
                {stencil !== '0x' ? (
                  <StencilPreview
                    runs={stencil}
                    cursor={replayCursor}
                    background={canvas.background}
                    backgroundColor={canvas.backgroundColor}
                  />
                ) : (
                  <p>no dream stencil yet.</p>
                )}
                <div className="sleep-replay-controls">
                  <Button onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'}</Button>
                  <input
                    type="range"
                    min={0}
                    max={Number(dream.totalPixels || 0n)}
                    value={Math.min(replayCursor, Number(dream.totalPixels))}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      setPlaying(false)
                      setReplayCursor(Number(event.target.value))
                    }}
                  />
                  <span>
                    {replayCursor} / {dream.totalPixels.toString()}
                  </span>
                </div>
              </GroupBox>
              <div className="sleep-morning-side">
                <GroupBox title="This dream">
                  <dl className="sleep-dl">
                    <dt>cursor progress</dt>
                    <dd>
                      {dream.cursor.toString()} / {dream.totalPixels.toString()}
                    </dd>
                    <dt>survived</dt>
                    <dd>{survival}% of your dream survived</dd>
                    <dt>dreaming days</dt>
                    <dd>{dreamingDays.toString()}</dd>
                    <dt>deposit left</dt>
                    <dd>{formatEther(dream.deposit)} MON</dd>
                    <dt>sessions left</dt>
                    <dd>{dream.sessionsLeft.toString()}</dd>
                  </dl>
                  {dream.stalled && (
                    <p className="warning-line">
                      {dream.sessionsLeft === 0n
                        ? 'Dream stalled: no signed nights left. Resume with new signatures or wake up.'
                        : `Dream stalled at block ${(stalledAt ?? dream.nextStepBlock).toString()}. Resume with new signatures or wake up.`}
                    </p>
                  )}
                  <div className="sleep-actions">
                    {dream.stalled && <Button onClick={() => void resume()}>Resume</Button>}
                    <Button
                      disabled={dream.pointer === zeroAddress || currentDreamMinted}
                      onClick={() => void simpleAction('mintDream')}
                    >
                      {currentDreamMinted ? 'Dream minted ✓' : 'Mint dream'}
                    </Button>
                    <Button disabled={dream.pointer === zeroAddress} onClick={() => void wake()}>
                      Wake up
                    </Button>
                  </div>
                </GroupBox>
                {refund > 0n && (
                  <GroupBox title="Refund">
                    <p>{formatEther(refund)} MON waiting</p>
                    <div className="sleep-actions">
                      <Button onClick={() => void simpleAction('withdrawRefund')}>Withdraw</Button>
                    </div>
                    <label>
                      Send to another address
                      <input
                        value={refundTo}
                        onChange={(event) => setRefundTo(event.target.value.trim())}
                        placeholder="0x…"
                      />
                    </label>
                    <Button disabled={!isAddress(refundTo)} onClick={() => void withdrawRefundTo()}>
                      Send
                    </Button>
                  </GroupBox>
                )}
                {minted && (
                  <GroupBox title="Dream NFT">
                    <div className="dream-nft-preview">
                      <SafeImage src={minted.image} alt={minted.name} width={180} height={180} />
                    </div>
                    <b>{minted.name}</b>
                  </GroupBox>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'night' && (
          <div className="sleep-night">
            <div className="night-head">
              <div>
                <b>Night Shift</b>
                <p>crank someone else's dream. tips pay only when a step actually paints.</p>
              </div>
              <Button onClick={() => void discoverSleepers()}>{busy || 'Refresh'}</Button>
              <Button
                primary
                disabled={
                  !sleepers.some(
                    (s) =>
                      s.ready &&
                      s.deposit >= s.tip &&
                      maxFeePerGas > 0n &&
                      nightShiftProfit(s.tip, maxFeePerGas).profitable,
                  )
                }
                onClick={() => void stepAll()}
              >
                Step all (
                {
                  sleepers.filter(
                    (s) =>
                      s.ready &&
                      s.deposit >= s.tip &&
                      maxFeePerGas > 0n &&
                      nightShiftProfit(s.tip, maxFeePerGas).profitable,
                  ).length
                }
                )
              </Button>
            </div>
            <div className="night-list sunken">
              {sleepers.map((sleeper) => {
                const economics = nightShiftProfit(sleeper.tip, maxFeePerGas)
                const actionable =
                  sleeper.ready && sleeper.deposit >= sleeper.tip && maxFeePerGas > 0n && economics.profitable
                return (
                  <div
                    className={`night-row ${actionable ? 'ready' : ''} ${!economics.profitable ? 'unprofitable' : ''}`}
                    key={sleeper.owner}
                  >
                    <span>
                      <b>{short(sleeper.owner)}</b>
                      <small>{sleeper.ready ? 'ready now' : 'not ready'}</small>
                    </span>
                    <span>
                      {formatEther(sleeper.tip)} MON tip
                      <small>
                        tip − max cost: {economics.profit < 0n ? '−' : '+'}
                        {Number(
                          formatEther(economics.profit < 0n ? -economics.profit : economics.profit),
                        ).toFixed(6)}{' '}
                        MON
                      </small>
                    </span>
                    <span className="muted">
                      {sleeper.result ??
                        (sleeper.deposit < sleeper.tip
                          ? 'out of deposit'
                          : !economics.profitable
                            ? 'tip is below crank max cost'
                            : sleeper.ready
                              ? 'stepReady ✓'
                              : 'gray until ready')}
                    </span>
                    <Button disabled={!actionable} onClick={() => void stepOne(sleeper.owner)}>
                      Step
                    </Button>
                  </div>
                )
              })}
              {!sleepers.length && <p>no sleepers found right now.</p>}
            </div>
          </div>
        )}
      </main>

      <footer className="sleep-status sunken">
        <span>
          {error ||
            ownerProgress ||
            nightProgress ||
            (wallet.account ? `key ${short(key)}` : 'connect wallet')}
        </span>
        <span>block #{block.block.toString()}</span>
      </footer>

      {holderDialog && (
        <div className="modal-shade">
          <div className="message-box window">
            <b>Holder quota</b>
            <p>Optional r3tard token ids whose daily holder quota the dream may use.</p>
            <input
              value={manualHolderIds}
              onChange={(event) => setManualHolderIds(event.target.value)}
              placeholder="12, 44, 1033"
            />
            <div className="dialog-actions">
              <Button
                onClick={() => {
                  setHolderIds([])
                  setHolderDialog(false)
                }}
              >
                None
              </Button>
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
      {confirm && (
        <MessageBox
          title={confirm.title}
          message={confirm.message}
          defaultLabel={confirm.defaultLabel}
          cancelLabel="Cancel"
          onClose={() => setConfirm(undefined)}
          onCancel={() => setConfirm(undefined)}
          onDefault={() => {
            const run = confirm.run
            setConfirm(undefined)
            setBusy('working…')
            void run()
              .catch((caught) => setError(friendlyError(caught, 'sleepwalker').message))
              .finally(() => setBusy(''))
          }}
        />
      )}
      {error && <MessageBox title="Sleepwalker" kind="error" message={error} onClose={() => setError('')} />}
    </div>
  )
}
