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
import {
  decodeEventLog,
  formatEther,
  parseAbiItem,
  parseEther,
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
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_PAINT_ABI, R3TARDS_SLEEPWALKER_ABI } from '../lib/generated/abi'
import { PALETTE } from '../lib/palette'
import { readLabsToken, type LabsTokenData } from './labsToken'
import {
  buildSleepwalkerStencil,
  cursorPixels,
  estimateDreamSteps,
  filterReadySleepers,
  nightShiftProfit,
  orderDreamt,
  planSleepwalkerSessions,
  sleepwalkerTypedData,
  sleepwalkerStepMaxCost,
  suggestedSleepwalkerTip,
  stepCodeMessage,
  type DreamtLike,
  type SignedSession,
} from './sleepwalker'
import {
  getSleepwalkerDraft,
  markSleepwalkerDraftSubmitted,
  subscribeSleepwalkerDraft,
} from './sleepwalkerDraft'
import { chunkBlockRanges, getCanvasSnapshot, subscribeCanvas } from '../paint/canvasStore'
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

async function eventChunks(address: Address, event: any, args?: Record<string, unknown>) {
  if (!publicClient) return []
  const head = await publicClient.getBlockNumber({ cacheTime: 0 })
  const out: any[] = []
  for (const range of chunkBlockRanges(0n, head, 25_000n)) {
    const rows = await publicClient.getLogs({ address, event, args, ...range } as any)
    out.push(...rows)
  }
  return out
}

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
  }, [refresh, block.block])

  const loadOwnerEvents = useCallback(async () => {
    if (!wallet.account || !address) return
    try {
      const [dreamLogs, sleptLogs, completeLogs, stalledLogs, mintedLogs] = await Promise.all([
        eventChunks(address, DREAMT, { owner: wallet.account }),
        eventChunks(address, SLEPT, { owner: wallet.account }),
        eventChunks(address, COMPLETE, { owner: wallet.account }),
        eventChunks(address, STALLED, { owner: wallet.account }),
        eventChunks(address, MINTED, { owner: wallet.account }),
      ])
      const events = dreamLogs.map((log) => ({
        cursorFrom: BigInt(log.args.cursorFrom ?? 0),
        cursorTo: BigInt(log.args.cursorTo ?? 0),
        pixels: BigInt(log.args.pixels ?? 0),
        blockNumber: BigInt(log.args.blockNumber ?? log.blockNumber ?? 0),
      }))
      setDreamt(orderDreamt(events))
      setLastSleepBlock(sleptLogs.at(-1)?.blockNumber ?? undefined)
      setLastCompleteBlock(completeLogs.at(-1)?.blockNumber ?? undefined)
      setStalledAt(stalledLogs.at(-1)?.blockNumber ?? undefined)
      setLastMintBlock(mintedLogs.at(-1)?.blockNumber ?? undefined)
    } catch (caught) {
      setError(friendlyError(caught, 'Dreamt').message)
    }
  }, [wallet.account, address])

  useEffect(() => {
    if (wallet.account && address) void loadOwnerEvents()
  }, [wallet.account, address, loadOwnerEvents])

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
    if (!playing || !dreamt.length) return
    let index = dreamt.findIndex((event) => Number(event.cursorTo) > replayCursor)
    if (index < 0) index = dreamt.length
    if (index >= dreamt.length) return setPlaying(false)
    const gap = index === 0 ? 1n : BigInt(dreamt[index].blockNumber) - BigInt(dreamt[index - 1].blockNumber)
    const timer = window.setTimeout(
      () => setReplayCursor(Number(dreamt[index].cursorTo)),
      Math.max(90, Math.min(1_500, Number(gap) * Math.max(100, block.blockTimeMs))),
    )
    return () => window.clearTimeout(timer)
  }, [playing, replayCursor, dreamt, block.blockTimeMs])

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
          [{ address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'stepReady', args: [owners] }],
          { allowFailure: false },
        )
        const ready = rows[0] as boolean[]
        setSleepers((existing) =>
          existing.map((item) => {
            const index = owners.findIndex((owner) => owner.toLowerCase() === item.owner.toLowerCase())
            return index < 0 ? item : { ...item, ready: ready[index] === true }
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
    setBusy('finding sleepers…')
    try {
      const [sleptLogs, completeLogs, wokeLogs] = await Promise.all([
        eventChunks(address, SLEPT),
        eventChunks(address, COMPLETE),
        eventChunks(address, WOKE),
      ])
      const active = new Set<string>()
      const tips = new Map<string, bigint>()
      const timeline = [
        ...sleptLogs.map((log) => ({ kind: 'sleep', log })),
        ...completeLogs.map((log) => ({ kind: 'done', log })),
        ...wokeLogs.map((log) => ({ kind: 'done', log })),
      ].sort((a, b) => Number((a.log.blockNumber ?? 0n) - (b.log.blockNumber ?? 0n)))
      for (const item of timeline) {
        const owner = String(item.log.args.owner ?? '').toLowerCase()
        if (!owner) continue
        if (item.kind === 'sleep') {
          active.add(owner)
          tips.set(owner, BigInt(item.log.args.tipPerStep ?? 0))
        } else active.delete(owner)
      }
      const owners = [...active] as Address[]
      if (!owners.length) return setSleepers([])
      const readyRows = await readMany(
        [{ address, abi: R3TARDS_SLEEPWALKER_ABI, functionName: 'stepReady', args: [owners] }],
        { allowFailure: false },
      )
      const ready = readyRows[0] as boolean[]
      setSleepers(owners.map((owner, index) => ({ owner, tip: tips.get(owner) ?? 0n, ready: ready[index] })))
    } catch (caught) {
      setError(friendlyError(caught, 'stepReady').message)
    } finally {
      setBusy('')
    }
  }, [address])

  useEffect(() => {
    if (tab === 'night') void discoverSleepers()
  }, [tab, discoverSleepers])

  useEffect(() => {
    if (tab === 'night' && sleepers.length) void refreshReadiness(sleepers)
  }, [tab, block.block, refreshReadiness])

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
            const item: Sleeper = { owner: args.owner, tip: args.tipPerStep ?? 0n, ready: false }
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
      stopComplete()
      stopWoke()
    }
  }, [tab, address])

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
        message: `${quote.maxCost} transaction max, plus ${deposit} MON tip deposit. ${completedUnminted ? 'sleeping again discards the mint option for your last dream. ' : ''}Submit the dream?`,
        defaultLabel: 'Go to sleep',
        run: async () => {
          await sendAction({ ...action, quote })
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
          await sendAction({ ...action, quote })
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
        message: `${cost}. First revoke the active Sleepwalker session key from your wallet, then wake to delete unused signatures and refund the remaining deposit.`,
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
                      Your dream stopped at block {(stalledAt ?? dream.nextStepBlock).toString()}: nobody
                      stepped for 2 hours. Resume with new signatures, or wake up
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
                    <Button onClick={() => void simpleAction('withdrawRefund')}>Withdraw</Button>
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
                    (s) => s.ready && maxFeePerGas > 0n && nightShiftProfit(s.tip, maxFeePerGas).profitable,
                  )
                }
                onClick={() => void stepAll()}
              >
                Step all (
                {
                  sleepers.filter(
                    (s) => s.ready && maxFeePerGas > 0n && nightShiftProfit(s.tip, maxFeePerGas).profitable,
                  ).length
                }
                )
              </Button>
            </div>
            <div className="night-list sunken">
              {sleepers.map((sleeper) => {
                const economics = nightShiftProfit(sleeper.tip, maxFeePerGas)
                const actionable = sleeper.ready && maxFeePerGas > 0n && economics.profitable
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
                        {formatEther(economics.profit < 0n ? -economics.profit : economics.profit)} MON
                      </small>
                    </span>
                    <span className="muted">
                      {sleeper.result ??
                        (!economics.profitable
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
        <span>{error || (wallet.account ? `key ${short(key)}` : 'connect wallet')}</span>
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
