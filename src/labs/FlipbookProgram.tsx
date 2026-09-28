import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { hexToBytes, parseAbiItem, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient, wsClient } from '../chain/clients'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { readMany } from '../chain/readMany'
import { R3TARDS_FLIPBOOK_ABI, R3TARDS_LABS_ABI } from '../lib/generated/abi'
import { encodeFlipRuns, reelTiming, unpackFrame } from '../lib/flipbook'
import { PALETTE } from '../lib/palette'
import { getLiveSnapshot, liveActive, subscribeLive } from '../live/liveStore'
import { closeWindow } from '../os/windows'
import { MenuBar } from '../os/ui/MenuBar'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { Icon } from '../os/ui/Icon'
import { LabCanvas } from './LabCanvas'
import { asHex, errorText, labAddress, shortAddress } from './labCommon'
import { readLabsToken, type LabsTokenData } from './labsToken'

const UINT64_MAX = (1n << 64n) - 1n
const RULES = [
  'the first paint in a block copies the previous frame and starts a new one. later paints in that block add to it. one paint per wallet per block, up to 64 px.',
  'ink refills every 200 blocks (~1 min): 256 px if you have painted the main canvas, 64 px for a fresh wallet.',
  'the first reel can use 8–32 available frames. after that, 32 new frames must exist since the last reel. you must have painted in the reel window. one reel per wallet per hour, main wallet only.',
  'paints use a fixed 240K gas limit. monad charges the limit, not the gas used, so it is kept tight.',
] as const

type FrameRow = {
  number: bigint
  pixels: Uint8Array
  block: bigint
  proposer: Address
  pixelCount: number
  painters: number
}

type State = {
  frames: FrameRow[]
  inkAvailable: bigint
  inkLimit: bigint
  inkReset: bigint
  lastPaintBlock: bigint
  lastFramePlusOne: bigint
  framesPainted: bigint
  lastReelBlock: bigint
  lastReelEnd: bigint
  tickMs: number
  labs?: Address
}

const EMPTY: State = {
  frames: [],
  inkAvailable: 0n,
  inkLimit: 0n,
  inkReset: 0n,
  lastPaintBlock: 0n,
  lastFramePlusOne: 0n,
  framesPainted: 0n,
  lastReelBlock: 0n,
  lastReelEnd: UINT64_MAX,
  tickMs: 300,
}

function unpackFrames(result: any): FrameRow[] {
  const first = BigInt(result?.[0] ?? 0)
  const bytes = hexToBytes((result?.[1] ?? '0x') as Hex)
  const blocks = (result?.[2] ?? []) as readonly bigint[]
  const proposers = (result?.[3] ?? []) as readonly Address[]
  const pixelCounts = (result?.[4] ?? []) as readonly (number | bigint)[]
  const painterCounts = (result?.[5] ?? []) as readonly (number | bigint)[]
  return blocks.map((block, index) => ({
    number: first + BigInt(index),
    pixels: unpackFrame(bytes.slice(index * 512, index * 512 + 512)),
    block: BigInt(block),
    proposer: proposers[index],
    pixelCount: Number(pixelCounts[index] ?? 0),
    painters: Number(painterCounts[index] ?? 0),
  }))
}

function MiniFrame({ pixels }: { pixels: Uint8Array }) {
  return <LabCanvas size={32} pixels={pixels} zoom={1} />
}

export function FlipbookProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [state, setState] = useState<State>(EMPTY)
  const [working, setWorking] = useState(new Uint8Array(1024))
  const [colour, setColour] = useState(1)
  const [eraser, setEraser] = useState(false)
  const [paintQuote, setPaintQuote] = useState<ActionQuote>()
  const [mintQuote, setMintQuote] = useState<ActionQuote>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [playerIndex, setPlayerIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showPrevious, setShowPrevious] = useState(true)
  const [reels, setReels] = useState<{ id: bigint; data?: LabsTokenData }[]>([])
  const baseRef = useRef<Uint8Array | undefined>(undefined)

  useEffect(() => {
    void labAddress('flipbook')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  const refresh = useCallback(async () => {
    if (!publicClient || !address) return
    const account = wallet.account
    try {
      const contracts: any[] = [
        { address, abi: R3TARDS_FLIPBOOK_ABI, functionName: 'recentFrames', args: [32n] },
        { address, abi: R3TARDS_FLIPBOOK_ABI, functionName: 'lastReelEndFrame' },
        { address, abi: R3TARDS_FLIPBOOK_ABI, functionName: 'TICK_MS' },
        { address, abi: R3TARDS_FLIPBOOK_ABI, functionName: 'LABS' },
      ]
      if (account) {
        contracts.push(
          { address, abi: R3TARDS_FLIPBOOK_ABI, functionName: 'inkAvailable', args: [account] },
          { address, abi: R3TARDS_FLIPBOOK_ABI, functionName: 'painterInfo', args: [account] },
        )
      }
      const reads = await readMany(contracts as any, { allowFailure: false })
      const frames = unpackFrames(reads[0])
      const next: State = {
        frames,
        lastReelEnd: BigInt(reads[1] as bigint),
        tickMs: Number(reads[2] as bigint),
        labs: reads[3] as Address,
        inkAvailable: 0n,
        inkLimit: 0n,
        inkReset: 0n,
        lastPaintBlock: 0n,
        lastFramePlusOne: 0n,
        framesPainted: 0n,
        lastReelBlock: 0n,
      }
      if (account) {
        const ink = reads[4] as any
        const painter = reads[5] as any
        next.inkAvailable = BigInt(ink[0])
        next.inkLimit = BigInt(ink[1])
        next.inkReset = BigInt(ink[2])
        next.lastPaintBlock = BigInt(painter[0])
        next.lastFramePlusOne = BigInt(painter[3])
        next.framesPainted = BigInt(painter[4])
        next.lastReelBlock = BigInt(painter[5])
      }
      const latestPixels = frames.at(-1)?.pixels
      const previousBase = baseRef.current
      setWorking((current) => {
        if (!latestPixels) return current
        const merged = latestPixels.slice()
        if (previousBase?.length === current.length) {
          for (let index = 0; index < current.length; index++) {
            if (current[index] !== previousBase[index]) merged[index] = current[index]
          }
        }
        return merged
      })
      baseRef.current = latestPixels?.slice()
      setState(next)
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, wallet.account])

  useEffect(() => {
    void refresh()
  }, [refresh, block.block])

  useEffect(() => {
    if (!wsClient || !address) return
    return wsClient.watchContractEvent({
      address,
      abi: R3TARDS_FLIPBOOK_ABI,
      onLogs: () => void refresh(),
    })
  }, [address, refresh])

  const latest = state.frames.at(-1)

  const encoded = useMemo(
    () => (latest ? encodeFlipRuns(latest.pixels, working) : undefined),
    [latest, working],
  )
  const paintBlocked = !wallet.account
    ? 'connect a wallet'
    : state.lastPaintBlock === block.block
      ? 'already painted this block'
      : !encoded?.pixelWrites
        ? 'draw something first'
        : encoded.tooManyPixels
          ? '64 px max per paint'
          : encoded.tooManyRuns
            ? '32 runs max per paint'
            : BigInt(encoded.pixelWrites) > state.inkAvailable
              ? 'not enough ink'
              : ''

  useEffect(() => {
    setPaintQuote(undefined)
    if (!address || !wallet.account || paintBlocked || !encoded) return
    let cancelled = false
    void quoteAction({
      kind: 'flipbookPaint',
      address,
      abi: R3TARDS_FLIPBOOK_ABI,
      functionName: 'paint',
      args: [asHex(encoded.runs)],
      account: wallet.account,
      signer: liveActive(live) ? 'burner' : 'wallet',
      pixels: encoded.pixelWrites,
      action: 'paint Flipbook frame',
    })
      .then((quote) => !cancelled && setPaintQuote(quote))
      .catch(() => !cancelled && setPaintQuote(undefined))
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, paintBlocked, encoded?.pixelWrites, encoded?.runCount, working, live.version])

  const firstFrame = state.frames[0]?.number ?? 0n
  const endFrame = state.frames.at(-1)?.number ?? 0n
  const firstReel = state.lastReelEnd === UINT64_MAX
  const reelReason = !wallet.account
    ? 'connect a wallet'
    : state.frames.length < 8
      ? `needs ${8 - state.frames.length} more frames`
      : !firstReel && endFrame < state.lastReelEnd + 32n
        ? `needs ${(state.lastReelEnd + 32n - endFrame).toString()} more new frames since the last reel`
        : state.lastFramePlusOne === 0n || state.lastFramePlusOne - 1n < firstFrame
          ? 'you did not paint in these frames'
          : state.lastReelBlock !== 0n && block.block < state.lastReelBlock + 12_000n
            ? `cooldown until block ${(state.lastReelBlock + 12_000n).toString()}`
            : ''

  useEffect(() => {
    setMintQuote(undefined)
    if (!address || !wallet.account || reelReason) return
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_FLIPBOOK_ABI,
      functionName: 'mintReel',
      account: wallet.account,
      action: 'mint Flipbook reel',
    })
      .then((quote) => !cancelled && setMintQuote(quote))
      .catch(() => !cancelled && setMintQuote(undefined))
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, reelReason, block.block])

  const loadReels = useCallback(async () => {
    if (!publicClient || !wallet.account || !address || !state.labs) return
    try {
      const transfer = parseAbiItem(
        'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
      )
      const logs = await publicClient.getLogs({
        address: state.labs,
        event: transfer,
        args: { to: wallet.account },
        fromBlock: 0n,
        toBlock: 'latest',
      })
      const receivedIds: bigint[] = logs
        .map((log) => (log.args as { tokenId?: bigint }).tokenId)
        .filter((id): id is bigint => id != null)
      const ids: bigint[] = [...new Set<bigint>(receivedIds)]
      if (!ids.length) return setReels([])
      const calls = ids.flatMap((id) => [
        { address: state.labs!, abi: R3TARDS_LABS_ABI, functionName: 'ownerOf', args: [id] },
        { address: state.labs!, abi: R3TARDS_LABS_ABI, functionName: 'sourceOf', args: [id] },
      ]) as any
      const values = await readMany(calls as any, { allowFailure: true })
      const owned = ids.filter((id, index) => {
        const owner = values[index * 2] as any
        const source = values[index * 2 + 1] as any
        return (
          owner.status === 'success' &&
          source.status === 'success' &&
          String(owner.result).toLowerCase() === wallet.account!.toLowerCase() &&
          String(source.result).toLowerCase() === address.toLowerCase()
        )
      })
      const shown = owned.slice(-4).reverse()
      const next = await Promise.all(
        shown.map(async (id) => ({ id, data: await readLabsToken(id).catch(() => undefined) })),
      )
      setReels(next)
    } catch {
      // Ownership list is secondary UI. Keep the editor live if an archival RPC rejects a genesis scan.
    }
  }, [wallet.account, address, state.labs])

  useEffect(() => {
    void loadReels()
  }, [loadReels])

  useEffect(() => {
    if (!wsClient || !state.labs || !wallet.account) return
    return wsClient.watchContractEvent({
      address: state.labs,
      abi: R3TARDS_LABS_ABI,
      eventName: 'Transfer',
      onLogs: () => void loadReels(),
    })
  }, [state.labs, wallet.account, loadReels])

  useEffect(() => {
    if (!playing || state.frames.length < 2) return
    const timing = reelTiming(
      state.frames.map((frame) => frame.block),
      state.tickMs,
    )
    const delay = timing.ticks[playerIndex % timing.ticks.length] * state.tickMs
    const timer = window.setTimeout(() => setPlayerIndex((value) => (value + 1) % state.frames.length), delay)
    return () => window.clearTimeout(timer)
  }, [playing, playerIndex, state.frames, state.tickMs])

  async function paint() {
    if (!address || !wallet.account || !paintQuote || !encoded) return
    setPending(true)
    setMessage('')
    try {
      await sendAction({
        kind: 'flipbookPaint',
        address,
        abi: R3TARDS_FLIPBOOK_ABI,
        functionName: 'paint',
        args: [asHex(encoded.runs)],
        account: wallet.account,
        signer: liveActive(live) ? 'burner' : 'wallet',
        pixels: encoded.pixelWrites,
        quote: paintQuote,
        action: 'paint Flipbook frame',
        successSound: 'success-light',
        confirmHigherCost: async (_old, next) =>
          window.confirm(`gas went up. continue with ${next.maxCost}?`),
      })
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function mint() {
    if (!address || !wallet.account || !mintQuote) return
    setPending(true)
    try {
      await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FLIPBOOK_ABI,
        functionName: 'mintReel',
        account: wallet.account,
        quote: mintQuote,
        action: 'mint Flipbook reel',
        successSound: 'success-heavy',
        confirmHigherCost: async (_old, next) =>
          window.confirm(`gas went up. continue with ${next.maxCost}?`),
      })
      await refresh()
      await loadReels()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  const current = state.frames[playerIndex % Math.max(1, state.frames.length)] ?? latest
  const menu = [
    { label: 'File', items: [{ label: 'Close', action: () => closeWindow('flipbook') }] },
    {
      label: 'Edit',
      items: [{ label: 'Clear pending pixels', action: () => latest && setWorking(latest.pixels.slice()) }],
    },
    {
      label: 'View',
      items: [{ label: 'Latest frame', action: () => setPlayerIndex(Math.max(0, state.frames.length - 1)) }],
    },
    {
      label: 'Reel',
      items: [
        { label: 'Mint this reel', disabled: Boolean(reelReason), disabledReason: reelReason, action: mint },
      ],
    },
    { label: 'Help', items: [{ label: 'How it works', disabled: true }] },
  ]

  if (missing) return <div className="lab-missing">this Lab isn't deployed on this network</div>

  return (
    <div className="lab-program flipbook-program">
      <MenuBar menus={menu} />
      <IntroBar
        lead="one shared 32 × 32 animation, drawn by everyone. each block that gets paint becomes the next frame."
        monad="a new block every 0.3 s, so the reel plays back at chain speed and every frame is stamped with its block and validator."
        rules={RULES}
        finalLine="paint 10 frames to earn the FLIPBOOK stamp on your Pass."
      />
      <div className="flipbook-main">
        <section className="flip-editor">
          <div className="lab-tools">
            <Button className={!eraser ? 'pressed' : ''} onClick={() => setEraser(false)}>
              <Icon name="pencil" size={20} />
            </Button>
            <Button className={eraser ? 'pressed' : ''} onClick={() => setEraser(true)}>
              <Icon name="eraser" size={20} />
            </Button>
            <div className="lab-palette">
              {PALETTE.map((entry) => (
                <button
                  key={entry.index}
                  className={colour === entry.index ? 'selected' : ''}
                  style={{ background: entry.hex }}
                  title={entry.name}
                  onClick={() => {
                    setColour(entry.index)
                    setEraser(entry.index === 0)
                  }}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="lab-canvas-well sunken">
              <LabCanvas
                size={32}
                pixels={working}
                ghost={showPrevious ? state.frames.at(-2)?.pixels : undefined}
                ghostOpacity={0.3}
                zoom={12}
                onPixel={(x, y) =>
                  setWorking((current) => {
                    const next = current.slice()
                    next[y * 32 + x] = eraser ? 0 : colour
                    return next
                  })
                }
              />
            </div>
            <div className="lab-editor-line flip-editor-meta">
              <label>
                <input
                  type="checkbox"
                  checked={showPrevious}
                  onChange={(event) => setShowPrevious(event.target.checked)}
                />{' '}
                show previous frame
              </label>
              <span>
                {encoded?.pixelWrites ?? 0} / 64 px this paint · {encoded?.runCount ?? 0} / 32 runs
              </span>
            </div>
            <div className="lab-action-row">
              <Button
                primary
                disabled={pending || Boolean(paintBlocked) || !paintQuote}
                title={paintBlocked || 'paint frame'}
                onClick={paint}
              >
                Paint frame
              </Button>
              <small>
                {paintBlocked === 'draw something first'
                  ? 'draw something first'
                  : (paintQuote?.maxCost ?? 'quoting…')}
                <br />
                240K gas limit
              </small>
            </div>
          </div>
        </section>
        <section className="flip-right">
          <div className="flip-top">
            <GroupBox title="Player">
              <div className="flip-player sunken">
                {current ? <LabCanvas size={32} pixels={current.pixels} zoom={5.6} /> : null}
              </div>
              <div className="player-controls">
                <Button onClick={() => setPlaying((value) => !value)}>{playing ? 'Ⅱ' : '▶'}</Button>
                <span>
                  {state.frames.length
                    ? `${(playerIndex % state.frames.length) + 1} / ${state.frames.length}`
                    : '0 / 0'}{' '}
                  · real block timing
                </span>
              </div>
            </GroupBox>
            <GroupBox title={current ? `Frame #${current.number}` : 'Frame'}>
              <dl className="lab-dl">
                <dt>block</dt>
                <dd>{current?.block.toString() ?? '—'}</dd>
                <dt>validator</dt>
                <dd>{shortAddress(current?.proposer)}</dd>
                <dt>pixels</dt>
                <dd>{current?.pixelCount ?? 0}</dd>
                <dt>painters</dt>
                <dd>{current?.painters ?? 0}</dd>
              </dl>
            </GroupBox>
          </div>
          <GroupBox title="Ink">
            <div>
              {state.inkAvailable.toString()} of {state.inkLimit.toString()} ink left ·{' '}
              {state.inkLimit === 256n ? 'painter tier' : 'fresh wallet'}
            </div>
            <progress max={Number(state.inkLimit || 1n)} value={Number(state.inkAvailable)} />
            <small>
              refills in ~
              {Math.max(0, Math.ceil((Number(state.inkReset - block.block) * block.blockTimeMs) / 1000))} s
              (block {state.inkReset.toString()})
            </small>
          </GroupBox>
          <GroupBox title="Mint this reel">
            <div className="reel-checks">
              <span>✓ {state.frames.length} frames available (8 needed)</span>
              <span>
                {firstReel || endFrame >= state.lastReelEnd + 32n ? '✓' : '✗'}{' '}
                {firstReel
                  ? 'first reel window'
                  : `${Math.max(0, Number(endFrame - state.lastReelEnd))} of 32 new frames since the last reel`}
              </span>
              <span>
                {state.lastFramePlusOne > 0n && state.lastFramePlusOne - 1n >= firstFrame ? '✓' : '✗'} you
                painted in these frames
              </span>
              <span>
                {state.lastReelBlock === 0n || block.block >= state.lastReelBlock + 12_000n ? '✓' : '✗'} no
                reel cooldown on this wallet
              </span>
              <span>✓ main wallet, not live mode</span>
            </div>
            <div className="lab-action-row">
              <Button
                disabled={pending || Boolean(reelReason) || !mintQuote}
                title={reelReason}
                onClick={mint}
              >
                Mint this reel
              </Button>
              <small>{reelReason || mintQuote?.maxCost}</small>
            </div>
            <small>live mode can paint here but can't mint reels</small>
          </GroupBox>
          {reels.length > 0 && (
            <GroupBox title="Your reels">
              <div className="your-reels">
                {reels.map((reel) => (
                  <div key={reel.id.toString()}>
                    <b>#{reel.id.toString()}</b>
                    <span>{reel.data?.name ?? 'reel'}</span>
                  </div>
                ))}
              </div>
            </GroupBox>
          )}
        </section>
      </div>
      <GroupBox title="Latest 32 frames">
        <div className="frame-strip">
          {state.frames.map((frame, index) => (
            <button
              key={frame.number.toString()}
              className={current?.number === frame.number ? 'selected' : ''}
              title={`#${frame.number} · block ${frame.block} · ${frame.painters} painters`}
              onClick={() => setPlayerIndex(index)}
            >
              <MiniFrame pixels={frame.pixels} />
            </button>
          ))}
        </div>
        <div className="frame-strip-caption">
          <span>{state.frames[0] ? `#${state.frames[0].number} · block ${state.frames[0].block}` : '—'}</span>
          <span>{latest ? `newest · #${latest.number} · block ${latest.block}` : '—'}</span>
        </div>
      </GroupBox>
      <footer className="lab-status">
        <span>{message || 'one frame per block that gets paint · updates live'}</span>
        <span>{latest ? `frame #${latest.number}` : '—'}</span>
        <span>#{block.block.toString()}</span>
      </footer>
    </div>
  )
}
