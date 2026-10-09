import { useCallback, useEffect, useRef, useMemo, useState, useSyncExternalStore } from 'react'
import { decodeEventLog, hexToString, zeroAddress, zeroHash, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { config } from '../chain/config'
import { useMonadCard } from '../chain/monadCard'
import { useMonadHardware } from '../chain/monadHardware'
import { readHeavy, readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { markProgramDataReady } from '../chain/perf'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { loadOwnedLabsSources, scanOwnedLabs } from '../frames/labsStore'
import { R3OS_BLOCK_CAMERA_ABI, R3OS_PAINT_ABI } from '../lib/generated/abi'
import { readLabsToken, type LabsTokenData } from '../labs/labsToken'
import { errorText, labAddress, labLoadError, LabNotDeployedError, shortAddress } from '../labs/labCommon'
import { WalletChooser } from '../os/WalletChooser'
import { requestFloppy } from '../os/floppy'
import { openProgram } from '../os/programs'
import { applyWallpaperResource, rememberSessionPhoto } from '../os/wallpaper'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import { SafeImage } from '../os/ui/SafeImage'
import './monadhw.css'

const RULES = [
  'the viewfinder turns the current block context into a deterministic 32×32 portrait: validator glyph, epoch pattern, parent-hash stars, block barcode and your corner mark.',
  'capture reads epoch and proposer with CALL inside the capture transaction, then mints the result through the existing r3OS Labs collection.',
  'proposer identity is provenance and art only. validators influence inclusion, so it is never treated as randomness.',
] as const

type RollItem = { id: bigint; data?: LabsTokenData; blockNumber?: bigint }

function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function BlockCameraProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const refreshTick = useRefreshTick(10)
  // The viewfinder samples the head every 3 blocks (~1 s on Monad). Every block is impossible: a portrait is a
  // ~4.6M-gas eth_call that takes longer than a 0.4 s block, and only one is ever in flight.
  const viewfinderTick = useRefreshTick(3)
  // Viewfinder/quote follow refreshTick; registry basics, the roll and card quotes only change on
  // capture, so they poll on the slow tick (and loadRoll also runs right after a capture).
  const slowTick = useRefreshTick(30)
  const hw = useMonadHardware()
  const card = useMonadCard()
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState<{ text: string; offline: boolean }>()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [labs, setLabs] = useState<Address>()
  const [season, setSeason] = useState(0n)
  const [preview, setPreview] = useState('')
  // The block the picture on screen was drawn from (it trails the live head by a block or two).
  const [previewBlock, setPreviewBlock] = useState<bigint>()
  const [quote, setQuote] = useState<ActionQuote>()
  const [cardQuote, setCardQuote] = useState<ActionQuote>()
  const [cardCanvasQuote, setCardCanvasQuote] = useState<ActionQuote>()
  const [useCard, setUseCard] = useState(false)
  const [withCanvas, setWithCanvas] = useState(false)
  const [pending, setPending] = useState(false)
  const [shutter, setShutter] = useState(false)
  const [developing, setDeveloping] = useState(false)
  const [imageUnavailable, setImageUnavailable] = useState(false)
  const [flash, setFlash] = useState(false)
  const [choosingWallet, setChoosingWallet] = useState(false)
  const [message, setMessage] = useState('')
  const [captured, setCaptured] = useState<RollItem>()
  const [roll, setRoll] = useState<RollItem[]>([])
  const [basicsLoaded, setBasicsLoaded] = useState(false)
  const [rollLoaded, setRollLoaded] = useState(false)

  useEffect(() => {
    void labAddress('block-camera')
      .then(setAddress)
      .catch((error) =>
        setMissing({ text: labLoadError(error), offline: !(error instanceof LabNotDeployedError) }),
      )
  }, [loadAttempt])

  const refreshBasics = useCallback(async () => {
    if (!address) return
    try {
      const calls = [
        { address, abi: R3OS_BLOCK_CAMERA_ABI, functionName: 'LABS' },
        ...(config.paintAddress
          ? [{ address: config.paintAddress, abi: R3OS_PAINT_ABI, functionName: 'currentSeason' }]
          : []),
      ]
      const rows = await readMany(calls, { allowFailure: false })
      setLabs(rows[0] as Address)
      if (rows[1] != null) setSeason(BigInt(rows[1] as bigint))
      setBasicsLoaded(true)
    } catch (error) {
      setMessage(errorText(error))
      setBasicsLoaded(true)
    }
  }, [address])

  useEffect(() => {
    void refreshBasics()
  }, [refreshBasics, slowTick])

  const proposerKnown = hw.staking.proposerValId.value != null && hw.staking.status === 'present'
  const epochKnown = hw.staking.epoch.value != null && hw.staking.status === 'present'
  // Sample the head on the viewfinder tick: previewPortrait is a ~4.6M-gas eth_call, far too heavy per block.
  const frame = useMemo(() => {
    const head = getBlockSnapshot()
    return { block: head.block, hash: head.hash }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewfinderTick])
  const previewArgs = useMemo(
    () =>
      [
        frame.block,
        frame.hash ?? zeroHash,
        hw.staking.epoch.value ?? 0n,
        hw.staking.inDelay.value ?? false,
        epochKnown,
        hw.staking.proposerValId.value ?? 0n,
        proposerKnown,
        Number(season & 0xffffffffn),
        wallet.account ?? zeroAddress,
      ] as const,
    [
      frame,
      hw.staking.epoch.value,
      hw.staking.inDelay.value,
      hw.staking.proposerValId.value,
      epochKnown,
      proposerKnown,
      season,
      wallet.account,
    ],
  )

  // Viewfinder: blocks arrive every ~0.3 s, faster than a preview eth_call returns. Keep exactly one preview
  // read in flight, always show the newest finished picture, then read again with the latest block. (Dropping
  // every answer that arrived after the next block left the viewfinder on "acquiring block…" forever.)
  const latestPreviewArgs = useRef(previewArgs)
  const previewBusy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    latestPreviewArgs.current = previewArgs
    if (!address || previewBusy.current) return
    previewBusy.current = true
    void (async () => {
      let sent: typeof previewArgs | undefined
      while (mounted.current && sent !== latestPreviewArgs.current) {
        sent = latestPreviewArgs.current
        try {
          const rows = await readHeavy([
            {
              address,
              abi: R3OS_BLOCK_CAMERA_ABI,
              functionName: 'previewPortrait',
              args: sent,
            },
          ])
          if (mounted.current && rows[0]?.status === 'success') {
            setPreview(hexToString(rows[0].result as Hex))
            setPreviewBlock(sent[0])
          }
        } catch {
          break
        }
      }
      previewBusy.current = false
    })()
  }, [address, previewArgs])

  useEffect(() => {
    if (!address || !wallet.account) {
      setQuote(undefined)
      return
    }
    let cancelled = false
    // Re-quote on the refresh tick, not every block: a 300 ms re-quote never finished and cost 3+ calls/block.
    // The last quote stays usable meanwhile; sendAction re-quotes stale quotes itself.
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3OS_BLOCK_CAMERA_ABI,
      functionName: 'capture',
      account: wallet.account,
      action: 'capture block portrait',
    })
      .then((next) => !cancelled && setQuote(next))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, refreshTick])

  useEffect(() => {
    if (card.status === 'present' && card.cardId != null) return
    setUseCard(false)
    setWithCanvas(false)
  }, [card.status, card.cardId])

  useEffect(() => {
    // Quote card captures only while the card slot is ticked, on the slow card tick, and keep the
    // previous quote on screen until the new one lands (no "quoting…" flicker every refresh).
    if (!useCard || !address || !wallet.account || card.status !== 'present' || card.cardId == null) {
      setCardQuote(undefined)
      setCardCanvasQuote(undefined)
      return
    }
    let cancelled = false
    const account = wallet.account
    const id = card.cardId
    void Promise.allSettled([
      quoteAction({
        kind: 'estimate',
        address,
        abi: R3OS_BLOCK_CAMERA_ABI,
        functionName: 'captureCard',
        args: [id, false],
        account,
        action: `capture block portrait + Card #${id}`,
      }),
      quoteAction({
        kind: 'estimate',
        address,
        abi: R3OS_BLOCK_CAMERA_ABI,
        functionName: 'captureCard',
        args: [id, true],
        account,
        action: `capture block portrait + Card #${id} + canvas hash`,
      }),
    ]).then(([pageOnly, canvas]) => {
      if (cancelled) return
      if (pageOnly.status === 'fulfilled') setCardQuote(pageOnly.value)
      if (canvas.status === 'fulfilled') setCardCanvasQuote(canvas.value)
    })
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, card.status, card.cardId, useCard, slowTick])

  const loadRoll = useCallback(async () => {
    if (!wallet.account) {
      setRoll([])
      setRollLoaded(true)
      return
    }
    if (!labs || !address) return
    setRollLoaded(false)
    try {
      const [ids, sources] = await Promise.all([
        scanOwnedLabs(labs, wallet.account),
        loadOwnedLabsSources(labs, wallet.account),
      ])
      if (!ids.length) {
        setRoll([])
        return
      }
      const owned = ids.filter(
        (id) => sources.get(id.toString())?.toLowerCase() === address.toLowerCase(),
      )
      const shown = owned.slice(-6).reverse()
      const next = await Promise.all(
        shown.map(async (id): Promise<RollItem> => ({
          id,
          data: await readLabsToken(id).catch(() => undefined),
        })),
      )
      setRoll(next)
    } catch {
      // The roll is secondary; capture stays usable if archival reads fail.
    } finally {
      setRollLoaded(true)
    }
  }, [wallet.account, labs, address])

  useEffect(() => {
    void loadRoll()
  }, [loadRoll, slowTick])

  useEffect(() => {
    if (basicsLoaded && (!wallet.account || !labs || rollLoaded)) markProgramDataReady('block-camera')
  }, [basicsLoaded, wallet.account, labs, rollLoaded])

  async function capture() {
    if (!address || !wallet.account) return
    const cardMode = useCard && card.status === 'present' && card.cardId != null
    const selectedQuote = cardMode ? (withCanvas ? cardCanvasQuote : cardQuote) : quote
    if (!selectedQuote) return
    setPending(true)
    setShutter(false)
    setDeveloping(false)
    setImageUnavailable(false)
    setMessage('')
    try {
      const result = await sendAction({
        kind: 'estimate',
        address,
        abi: R3OS_BLOCK_CAMERA_ABI,
        functionName: cardMode ? 'captureCard' : 'capture',
        args: cardMode ? [card.cardId!, withCanvas] : undefined,
        account: wallet.account,
        quote: selectedQuote,
        action: cardMode ? `capture block portrait + Card #${card.cardId}` : 'capture block portrait',
        successSound: 'success-heavy',
        onState(state) {
          // Keep the Photo Booth honest: the shutter only opens after the wallet has signed
          // and the transaction has actually been submitted.
          if (state === 'sent') setShutter(true)
        },
      })
      let tokenId: bigint | undefined
      for (const log of result.receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: R3OS_BLOCK_CAMERA_ABI,
            data: log.data,
            topics: log.topics,
          })
          if (decoded.eventName === 'Captured') {
            tokenId = BigInt((decoded.args as { tokenId: bigint }).tokenId)
            break
          }
        } catch {
          // Labs also emits logs in the same receipt.
        }
      }
      if (tokenId != null) {
        // The receipt is the photographic moment. Close the shutter immediately and let the image
        // develop separately; metadata reads can lag without pretending the transaction is still waiting.
        setShutter(false)
        setDeveloping(true)
        setCaptured({ id: tokenId, blockNumber: result.blockNumber })
        rememberSessionPhoto(tokenId)
        setMessage(`caught block #${result.blockNumber}`)
        const reduce =
          typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
        if (!reduce) {
          setFlash(true)
          window.setTimeout(() => setFlash(false), 150)
        }
        const data = await readLabsToken(tokenId, result.blockNumber).catch(() => undefined)
        setImageUnavailable(!data)
        setCaptured({ id: tokenId, data, blockNumber: result.blockNumber })
        setDeveloping(false)
      } else {
        setShutter(false)
        setMessage('capture receipt included')
      }
      await loadRoll()
    } catch (error) {
      // Drop the previous photo card so the error is visible instead of the old "caught block" line.
      setCaptured(undefined)
      setMessage(errorText(error))
    } finally {
      setPending(false)
      setShutter(false)
      setDeveloping(false)
    }
  }

  if (missing)
    return (
      <div className="monadhw-program">
        <p>{missing.offline ? missing.text : 'Block Camera is not installed on this network.'}</p>
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
    <div className="monadhw-program block-camera-program">
      <IntroBar
        lead="turn the block you're standing on into a picture."
        monad="the photo is made onchain from the block that includes your capture."
        rules={RULES}
      />
      {hw.staking.status === 'absent' && (
        <div className="hw-banner warning">
          this chain has no staking device: proposer and epoch record as unknown.
        </div>
      )}

      <div className="monadhw-scroll camera-layout photo-booth">
        <GroupBox title="Block Camera">
          <div className={`camera-viewfinder sunken ${shutter ? 'shutter-open' : ''}`}>
            {preview ? (
              <img src={svgDataUri(preview)} alt="live block portrait preview" />
            ) : (
              <span>acquiring block…</span>
            )}
            {shutter && <div className="camera-shutter">shutter open · waiting for the next block…</div>}
            {flash && <div className="camera-flash" aria-hidden="true" />}
          </div>
          <div className="camera-live-caption">
            <b>
              {previewBlock
                ? `PORTRAIT OF BLOCK #${previewBlock}`
                : block.block
                  ? 'DEVELOPING…'
                  : 'WAITING FOR A BLOCK'}
            </b>
            <span>
              {block.block
                ? `live head #${block.block} · ${
                    block.miner !== zeroAddress ? `made by ${shortAddress(block.miner)}` : 'producer unknown'
                  }`
                : 'connect to Monad to see the live block'}
            </span>
          </div>

          {card.status === 'present' && card.cardId != null && (
            <div className="camera-card-options">
              <label>
                <input
                  type="checkbox"
                  checked={useCard}
                  onChange={(event) => setUseCard(event.target.checked)}
                />
                include my Monad Card #{card.cardId.toString()}
              </label>
              {useCard && (
                <label className="camera-card-nested">
                  <input
                    type="checkbox"
                    checked={withCanvas}
                    onChange={(event) => setWithCanvas(event.target.checked)}
                  />
                  include the current canvas hash too
                </label>
              )}
            </div>
          )}

          <div className="camera-photo-action">
            <Button
              primary
              disabled={
                pending ||
                Boolean(wallet.account && (useCard ? !(withCanvas ? cardCanvasQuote : cardQuote) : !quote))
              }
              title={
                !wallet.account
                  ? 'choose a wallet to take the photo'
                  : pending
                    ? shutter
                      ? 'the shutter is open · waiting for inclusion'
                      : developing
                        ? 'the photo is developing'
                        : 'approve the photo in your wallet'
                    : `mint a photo of the inclusion block · ${
                        useCard
                          ? ((withCanvas ? cardCanvasQuote?.maxCost : cardQuote?.maxCost) ?? 'quoting…')
                          : (quote?.maxCost ?? 'quoting…')
                      } max cost`
              }
              onClick={() => {
                if (!wallet.account) setChoosingWallet(true)
                else void capture()
              }}
            >
              {pending
                ? shutter
                  ? 'SHUTTER OPEN…'
                  : developing
                    ? 'DEVELOPING…'
                    : 'SIGN PHOTO…'
                : wallet.account
                  ? 'TAKE PHOTO'
                  : 'Connect wallet to take a photo'}
            </Button>
            <small>
              {!wallet.account
                ? 'a wallet is only needed when you decide to mint the photo'
                : useCard
                  ? ((withCanvas ? cardCanvasQuote?.maxCost : cardQuote?.maxCost) ?? 'quoting…')
                  : (quote?.maxCost ?? 'quoting…')}
            </small>
          </div>
          {choosingWallet && !wallet.account && <WalletChooser onClose={() => setChoosingWallet(false)} />}
          <small>
            Monad makes a block every ~0.4 s, faster than a portrait can be drawn, so the viewfinder develops a
            new one every ~1 s. your photo is sealed from the block that actually includes the capture.
          </small>
        </GroupBox>

        {captured && (
          <GroupBox
            title={developing ? 'Developing photo' : imageUnavailable ? 'Photo captured' : 'Photo developed'}
          >
            <div className="camera-polaroid">
              <div className="camera-polaroid-image">
                {captured.data?.image ? (
                  <SafeImage src={captured.data.image} alt={captured.data.name} width={256} height={256} />
                ) : (
                  <span>{imageUnavailable ? 'image unavailable right now' : 'developing image…'}</span>
                )}
              </div>
              <b>photo #{captured.id.toString()}</b>
              <span>{captured.blockNumber ? `caught block #${captured.blockNumber}` : message}</span>
            </div>
            <div className="camera-result-actions">
              <Button onClick={() => applyWallpaperResource({ kind: 'photo', labsId: captured.id })}>
                Set as Wallpaper
              </Button>
              <Button onClick={() => requestFloppy({ kind: 'photo', labsId: captured.id })}>
                Save to Floppy…
              </Button>
              <Button onClick={() => openProgram('cd', true, `#/cd?photo=${captured.id}`)}>
                Burn to CD…
              </Button>
              <Button
                onClick={() => {
                  setCaptured(undefined)
                  setImageUnavailable(false)
                  setMessage('')
                }}
              >
                Take another
              </Button>
            </div>
          </GroupBox>
        )}

        <details className="camera-technical raised">
          <summary>Technical details</summary>
          <div className="camera-technical-body">
            <HardwareBus highlight={['consensus', 'clock', 'card']} />
            <div className="hw-stat-grid">
              <span>head</span>
              <b>{block.block.toString()}</b>
              <span>parent hash candidate</span>
              <code>{block.hash ? `${block.hash.slice(0, 12)}…${block.hash.slice(-6)}` : '—'}</code>
              <span>epoch</span>
              <b>{epochKnown ? hw.staking.epoch.value?.toString() : 'unknown'}</b>
              <span>proposer</span>
              <b>{proposerKnown ? `validator ${hw.staking.proposerValId.value}` : 'unknown'}</b>
              <span>season</span>
              <b>{(season + 1n).toString()}</b>
              <span>normal capture</span>
              <b>{quote?.maxCost ?? (wallet.account ? 'quoting…' : 'connect wallet')}</b>
              {card.status === 'present' && card.cardId != null && (
                <>
                  <span>Monad Card</span>
                  <b>#{card.cardId.toString()}</b>
                  <span>card page quote</span>
                  <b>{cardQuote?.maxCost ?? (useCard ? 'quoting…' : 'not selected')}</b>
                  <span>card + canvas quote</span>
                  <b>{cardCanvasQuote?.maxCost ?? (useCard ? 'quoting…' : 'not selected')}</b>
                </>
              )}
            </div>
            {captured?.data && (
              <div className="camera-captured-details">
                <b>{captured.data.name ?? `photo #${captured.id}`}</b>
                <p>block {String(captured.data.attributes.Block ?? captured.blockNumber ?? '—')}</p>
                <p>proposer {String(captured.data.attributes.Proposer ?? '—')}</p>
                {captured.data.attributes['Card slot'] != null && (
                  <>
                    <p>
                      card {String(captured.data.attributes['Card slot'])} · writes{' '}
                      {String(captured.data.attributes['Card writes'] ?? '—')}
                    </p>
                    <p>
                      page hash <code>{String(captured.data.attributes['Card page hash'] ?? '—')}</code>
                    </p>
                    <p>
                      canvas hash{' '}
                      <code>{String(captured.data.attributes['Canvas hash'] ?? 'not captured')}</code>
                    </p>
                  </>
                )}
              </div>
            )}
            <ul className="camera-rules">
              {RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </details>

        <GroupBox title="Your roll">
          {!wallet.account ? (
            <p>connect a wallet to load your captures.</p>
          ) : !roll.length ? (
            <p>no Block Camera captures yet.</p>
          ) : (
            <div className="camera-roll">
              {roll.map((item) => (
                <article key={item.id.toString()}>
                  {item.data?.image && (
                    <SafeImage src={item.data.image} alt={item.data.name} width={64} height={64} />
                  )}
                  <b>#{item.id.toString()}</b>
                  <span>block {String(item.data?.attributes.Block ?? '—')}</span>
                  {item.data?.attributes['Card slot'] != null && (
                    <span>{String(item.data.attributes['Card slot'])}</span>
                  )}
                  {item.data?.attributes['Card page hash'] != null && (
                    <code>{String(item.data.attributes['Card page hash']).slice(0, 14)}…</code>
                  )}
                </article>
              ))}
            </div>
          )}
        </GroupBox>
        {message && !captured && <p className="hw-message">{message}</p>}
      </div>
    </div>
  )
}
