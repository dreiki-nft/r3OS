import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { decodeEventLog, hexToString, zeroAddress, zeroHash, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { config } from '../chain/config'
import { useMonadCard } from '../chain/monadCard'
import { useMonadHardware } from '../chain/monadHardware'
import { readHeavy, readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { scanOwnedLabs } from '../frames/LabsFolder'
import { R3TARDS_BLOCK_CAMERA_ABI, R3TARDS_LABS_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { readLabsToken, type LabsTokenData } from '../labs/labsToken'
import { errorText, labAddress } from '../labs/labCommon'
import { playSound } from '../os/sound'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import { SafeImage } from '../os/ui/SafeImage'
import './monadhw.css'

const RULES = [
  'the viewfinder turns the current block context into a deterministic 32×32 portrait: validator glyph, epoch pattern, parent-hash stars, block barcode and your corner mark.',
  'capture reads epoch and proposer with CALL inside the capture transaction, then mints the result through the existing r3tards labs collection.',
  'proposer identity is provenance and art only. validators influence inclusion, so it is never treated as randomness.',
] as const

type RollItem = { id: bigint; data?: LabsTokenData }

function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function BlockCameraProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const refreshTick = useRefreshTick(10)
  // Viewfinder/quote follow refreshTick; registry basics, the roll and card quotes only change on
  // capture, so they poll on the slow tick (and loadRoll also runs right after a capture).
  const slowTick = useRefreshTick(30)
  const hw = useMonadHardware()
  const card = useMonadCard()
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [labs, setLabs] = useState<Address>()
  const [season, setSeason] = useState(0n)
  const [preview, setPreview] = useState('')
  const [quote, setQuote] = useState<ActionQuote>()
  const [cardQuote, setCardQuote] = useState<ActionQuote>()
  const [cardCanvasQuote, setCardCanvasQuote] = useState<ActionQuote>()
  const [useCard, setUseCard] = useState(false)
  const [withCanvas, setWithCanvas] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [captured, setCaptured] = useState<RollItem>()
  const [roll, setRoll] = useState<RollItem[]>([])

  useEffect(() => {
    void labAddress('block-camera')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  const refreshBasics = useCallback(async () => {
    if (!address) return
    try {
      const calls = [
        { address, abi: R3TARDS_BLOCK_CAMERA_ABI, functionName: 'LABS' },
        ...(config.paintAddress
          ? [{ address: config.paintAddress, abi: R3TARDS_PAINT_ABI, functionName: 'currentSeason' }]
          : []),
      ]
      const rows = await readMany(calls, { allowFailure: false })
      setLabs(rows[0] as Address)
      if (rows[1] != null) setSeason(BigInt(rows[1] as bigint))
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address])

  useEffect(() => {
    void refreshBasics()
  }, [refreshBasics, slowTick])

  const proposerKnown = hw.staking.proposerValId.value != null && hw.staking.status === 'present'
  const epochKnown = hw.staking.epoch.value != null && hw.staking.status === 'present'
  // Sample the head once per refresh tick: previewPortrait is a ~4.6M-gas eth_call, far too heavy per block.
  const frame = useMemo(() => {
    const head = getBlockSnapshot()
    return { block: head.block, hash: head.hash }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])
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

  useEffect(() => {
    if (!address) return
    let cancelled = false
    void readHeavy([
      {
        address,
        abi: R3TARDS_BLOCK_CAMERA_ABI,
        functionName: 'previewPortrait',
        args: previewArgs,
      },
    ])
      .then((rows) => {
        if (cancelled || rows[0]?.status !== 'success') return
        setPreview(hexToString(rows[0].result as Hex))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
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
      abi: R3TARDS_BLOCK_CAMERA_ABI,
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
        abi: R3TARDS_BLOCK_CAMERA_ABI,
        functionName: 'captureCard',
        args: [id, false],
        account,
        action: `capture block portrait + Card #${id}`,
      }),
      quoteAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_BLOCK_CAMERA_ABI,
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
    if (!wallet.account || !labs || !address) return
    try {
      const ids = await scanOwnedLabs(labs, wallet.account)
      if (!ids.length) {
        setRoll([])
        return
      }
      const sources = await readMany(
        ids.map((id) => ({
          address: labs,
          abi: R3TARDS_LABS_ABI,
          functionName: 'sourceOf',
          args: [id],
        })),
        { allowFailure: true },
      )
      const owned = ids.filter((_, index) => {
        const row = sources[index] as any
        return row?.status === 'success' && String(row.result).toLowerCase() === address.toLowerCase()
      })
      const shown = owned.slice(-6).reverse()
      const next: RollItem[] = []
      for (const id of shown) next.push({ id, data: await readLabsToken(id).catch(() => undefined) })
      setRoll(next)
    } catch {
      // The roll is secondary; capture stays usable if archival reads fail.
    }
  }, [wallet.account, labs, address])

  useEffect(() => {
    void loadRoll()
  }, [loadRoll, slowTick])

  async function capture() {
    if (!address || !wallet.account) return
    const cardMode = useCard && card.status === 'present' && card.cardId != null
    const selectedQuote = cardMode ? (withCanvas ? cardCanvasQuote : cardQuote) : quote
    if (!selectedQuote) return
    setPending(true)
    setMessage('')
    try {
      playSound('confirm')
      const result = await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_BLOCK_CAMERA_ABI,
        functionName: cardMode ? 'captureCard' : 'capture',
        args: cardMode ? [card.cardId!, withCanvas] : undefined,
        account: wallet.account,
        quote: selectedQuote,
        action: cardMode ? `capture block portrait + Card #${card.cardId}` : 'capture block portrait',
        successSound: 'success-heavy',
      })
      let tokenId: bigint | undefined
      for (const log of result.receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: R3TARDS_BLOCK_CAMERA_ABI,
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
        const data = await readLabsToken(tokenId, result.blockNumber).catch(() => undefined)
        setCaptured({ id: tokenId, data })
        setMessage(`captured labs #${tokenId}`)
      } else {
        setMessage('capture confirmed')
      }
      await loadRoll()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  if (missing)
    return (
      <div className="monadhw-program">
        <p>Block Camera is not deployed on this network.</p>
      </div>
    )

  return (
    <div className="monadhw-program block-camera-program">
      <IntroBar
        lead="photograph a block instead of a place."
        monad="the image is made from live consensus context captured inside the mint transaction."
        rules={RULES}
      />
      <HardwareBus highlight={['consensus', 'clock', 'card']} />
      {hw.staking.status === 'absent' && (
        <div className="hw-banner warning">
          this chain has no staking device: proposer and epoch record as unknown.
        </div>
      )}

      <div className="monadhw-scroll camera-layout">
        <GroupBox title="Live viewfinder">
          <div className="camera-viewfinder sunken">
            {preview ? (
              <img src={svgDataUri(preview)} alt="live block portrait preview" />
            ) : (
              <span>acquiring block…</span>
            )}
          </div>
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
          </div>
          {card.status === 'present' && card.cardId != null && (
            <div className="camera-card-options">
              <label>
                <input
                  type="checkbox"
                  checked={useCard}
                  onChange={(event) => setUseCard(event.target.checked)}
                />
                card slot: Card #{card.cardId.toString()}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={withCanvas}
                  disabled={!useCard}
                  onChange={(event) => setWithCanvas(event.target.checked)}
                />
                + canvas hash
              </label>
              {useCard && (
                <small>
                  card page {cardQuote?.maxCost ?? 'quoting…'} · + canvas{' '}
                  {cardCanvasQuote?.maxCost ?? 'quoting…'}
                </small>
              )}
            </div>
          )}
          <div className="hw-toolbar">
            <Button
              primary
              disabled={
                !wallet.account || pending || (useCard ? !(withCanvas ? cardCanvasQuote : cardQuote) : !quote)
              }
              onClick={() => void capture()}
            >
              {pending ? 'Capturing…' : 'Capture'}
            </Button>
            <span>
              {!wallet.account
                ? 'connect wallet'
                : useCard
                  ? ((withCanvas ? cardCanvasQuote?.maxCost : cardQuote?.maxCost) ?? 'quoting…')
                  : (quote?.maxCost ?? 'quoting…')}
            </span>
          </div>
          <small>
            the viewfinder uses the current head. the minted portrait is sealed from the block that actually
            includes your capture.
          </small>
        </GroupBox>

        {captured && (
          <GroupBox title={`Latest capture · Labs #${captured.id}`}>
            <div className="camera-latest">
              {captured.data?.image && (
                <SafeImage src={captured.data.image} alt={captured.data.name} width={128} height={128} />
              )}
              <div>
                <b>{captured.data?.name ?? `Labs #${captured.id}`}</b>
                <p>block {String(captured.data?.attributes.Block ?? '—')}</p>
                <p>{String(captured.data?.attributes.Proposer ?? '—')}</p>
                {captured.data?.attributes['Card slot'] != null && (
                  <>
                    <p>
                      card {String(captured.data.attributes['Card slot'])} · writes{' '}
                      {String(captured.data.attributes['Card writes'] ?? '—')}
                    </p>
                    <p>
                      page hash{' '}
                      <code>{String(captured.data.attributes['Card page hash']).slice(0, 18)}…</code>
                    </p>
                    <p>
                      canvas hash{' '}
                      <code>
                        {String(captured.data.attributes['Canvas hash']) === 'not captured'
                          ? 'not captured'
                          : `${String(captured.data.attributes['Canvas hash']).slice(0, 18)}…`}
                      </code>
                    </p>
                  </>
                )}
              </div>
            </div>
          </GroupBox>
        )}

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
        {message && <p className="hw-message">{message}</p>}
      </div>
    </div>
  )
}
