import { helpHash } from '../os/helpTopics'
import { screenSafeMessage } from '../chain/errors'
import './phase3c2c.css'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { hexToBytes, parseEventLogs, type Address, type Hex, type Log } from 'viem'
import { publicClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { getFrameImage } from '../frames/frameImage'
import { getFrameInfo, getFrameInfoBatch, mineTokenIds, type FrameInfo } from '../frames/framesStore'
import { labsAddress, labsBucket, loadOwnedLabsTokens, type LabsOwnedToken } from '../frames/LabsFolder'
import { R3TARDS_CD_BURNER_ABI, R3TARDS_LABS_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import {
  discMaskFromCounts,
  formatName,
  normalizeCdLabel,
  sampleTrackCounts,
  svg as cdSvg,
} from '../lib/cdArt'
import { loadBurner } from '../live/burner'
import { openProgram } from '../os/programs'
import { LabNotDeployedError } from './labCommon'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { Icon } from '../os/ui/Icon'
import { MenuBar } from '../os/ui/MenuBar'
import { SafeImage } from '../os/ui/SafeImage'
import { readLabsToken, type LabsTokenData } from './labsToken'
import { cdEligibleFrames } from './recycle'

interface Track {
  id: number
  info: FrameInfo
}

type TxState = 'idle' | 'signing' | 'sent' | 'confirmed'
const sampled = new Map<number, number[]>()

function displayFormat(count: number) {
  const value = formatName(count)
  return value === 'ep' ? 'EP' : value[0].toUpperCase() + value.slice(1)
}

function dataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

async function countsForFrame(id: number, info: FrameInfo) {
  const cached = sampled.get(id)
  if (cached) return cached
  if (!publicClient) throw new Error('frame data unavailable')
  const paint = (await discoverContracts()).paint
  if (!paint) throw new Error('paint is not deployed on this network')
  const raw = (await publicClient.readContract({
    address: paint,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'frameData',
    args: [BigInt(id)],
  })) as Hex
  const counts = sampleTrackCounts(new Uint8Array(hexToBytes(raw)), info.backgroundColor)
  sampled.set(id, counts)
  return counts
}

function FrameChoice({
  track,
  selected,
  onClick,
  onDoubleClick,
}: {
  track: Track
  selected: boolean
  onClick: () => void
  onDoubleClick: () => void
}) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let cancelled = false
    void getFrameImage(track.id)
      .then((image) => {
        if (cancelled) return
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0)
        setSrc(canvas.toDataURL())
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [track.id])
  return (
    <button
      className={`cd-frame-choice ${selected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <SafeImage src={src} alt={`frame #${track.id}`} width={72} height={72} />
      <span>frame #{track.id}</span>
      <small>
        season {track.info.season + 1}
        {track.info.finale ? ' · finale' : ''}
      </small>
    </button>
  )
}

export function CDBurnerProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [step, setStep] = useState(0)
  const [burner, setBurner] = useState<Address>()
  const [frames, setFrames] = useState<Track[]>([])
  const [framesFor, setFramesFor] = useState<string>()
  const [selected, setSelected] = useState<number>()
  const [tracks, setTracks] = useState<Track[]>([])
  const [label, setLabel] = useState('')
  const [previewToken, setPreviewToken] = useState(1n)
  const [discMask, setDiscMask] = useState(0)
  const [quote, setQuote] = useState<ActionQuote>()
  const [txState, setTxState] = useState<TxState>('idle')
  const burningRef = useRef(false)
  const [minted, setMinted] = useState<{ id: bigint; data: LabsTokenData }>()
  const [cds, setCds] = useState<LabsOwnedToken[]>([])
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!wallet.account || !publicClient) {
      setFrames([])
      setCds([])
      return
    }
    try {
      const contracts = await discoverContracts()
      const address = contracts.labs['cd-burner']
      if (!address) throw new LabNotDeployedError()
      setBurner(address)
      const ids = await mineTokenIds(wallet.account)
      const infos = await getFrameInfoBatch(ids.filter((id) => id > 0))
      const eligible = cdEligibleFrames(
        ids
          .filter((id) => id > 0)
          .map((id) => ({ id, info: infos.get(id)! }))
          .filter((item) => item.info),
      )
      setFrames(eligible)
      // Opened from My Frames with a frame selected (#/cd?frame=12): start with that frame as track 1.
      const rawRouteFrame = new URLSearchParams(location.hash.split('?')[1] ?? '').get('frame')
      if (rawRouteFrame && /^\d+$/.test(rawRouteFrame)) {
        const routed = eligible.find((track) => track.id === Number(rawRouteFrame))
        if (routed) setTracks((current) => (current.length ? current : [routed]))
      }
      setFramesFor(wallet.account)
      const labs = await labsAddress()
      const total = BigInt(
        await publicClient.readContract({
          address: labs,
          abi: R3TARDS_LABS_ABI,
          functionName: 'totalMinted',
        }),
      )
      setPreviewToken(total + 1n)
      const owned = await loadOwnedLabsTokens(wallet.account)
      const ownedCds = owned.filter((token) => labsBucket(token.data) === 'CDs')
      setCds(ownedCds)
      const rawRouteToken = new URLSearchParams(location.hash.split('?')[1] ?? '').get('token')
      if (rawRouteToken && /^\d+$/.test(rawRouteToken)) {
        const routeId = BigInt(rawRouteToken)
        const routed = ownedCds.find((token) => token.id === routeId)
        if (routed?.data) setMinted({ id: routed.id, data: routed.data })
      }
    } catch (error) {
      setMessage(screenSafeMessage(error))
    }
  }, [wallet.account])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!tracks.length) {
      setDiscMask(0)
      return
    }
    let cancelled = false
    void Promise.all(tracks.map((track) => countsForFrame(track.id, track.info)))
      .then((counts) => !cancelled && setDiscMask(discMaskFromCounts(counts)))
      .catch((error) => !cancelled && setMessage(screenSafeMessage(error)))
    return () => {
      cancelled = true
    }
  }, [tracks.map((track) => track.id).join(',')])

  const normalized = normalizeCdLabel(label)
  const preview = useMemo(() => {
    if (!tracks.length) return ''
    return dataUri(
      cdSvg({
        tokenId: previewToken,
        frameIds: tracks.map((track) => track.id),
        label: normalized.value || 'untitled',
        mask: discMask,
      }).svg,
    )
  }, [previewToken, tracks, normalized.value, discMask])

  useEffect(() => {
    if (step !== 2 || !wallet.account || !burner || !tracks.length || !normalized.valid) {
      setQuote(undefined)
      return
    }
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: burner,
      abi: R3TARDS_CD_BURNER_ABI,
      functionName: 'burnCD',
      args: [tracks.map((track) => BigInt(track.id)), normalized.value],
      account: wallet.account,
      action: 'burn mix CD-R',
    })
      .then((next) => !cancelled && setQuote(next))
      .catch((error) => !cancelled && setMessage(screenSafeMessage(error)))
    return () => {
      cancelled = true
    }
  }, [
    step,
    wallet.account,
    burner,
    tracks.map((track) => track.id).join(','),
    normalized.value,
    normalized.valid,
  ])

  const add = (id?: number) => {
    if (id == null || tracks.length >= 12 || tracks.some((track) => track.id === id)) return
    const frame = frames.find((item) => item.id === id)
    if (frame) setTracks((current) => [...current, frame])
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= tracks.length) return
    setTracks((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const burn = async () => {
    if (!wallet.account || !burner || !quote || !normalized.valid || burningRef.current || minted) return
    burningRef.current = true
    setMinted(undefined)
    try {
      const result = await sendAction({
        kind: 'estimate',
        address: burner,
        abi: R3TARDS_CD_BURNER_ABI,
        functionName: 'burnCD',
        args: [tracks.map((track) => BigInt(track.id)), normalized.value],
        account: wallet.account,
        quote,
        action: 'burn mix CD-R',
        successSound: 'success-heavy',
        onState: setTxState,
      })
      // the minted id comes from this tx's CDBurned event, not totalMinted(), which races other Labs mints
      const burned = parseEventLogs({
        abi: R3TARDS_CD_BURNER_ABI,
        eventName: 'CDBurned',
        logs: result.receipt.logs as Log[],
      })[0]
      const id = burned
        ? BigInt(burned.args.tokenId)
        : BigInt(
            await publicClient!.readContract({
              address: await labsAddress(),
              abi: R3TARDS_LABS_ABI,
              functionName: 'totalMinted',
            }),
          )
      const data = await readLabsToken(id)
      setMinted({ id, data })
      setPreviewToken(id + 1n)
      setCds((current) => [{ id, data }, ...current.filter((token) => token.id !== id)])
    } catch (error) {
      setMessage(screenSafeMessage(error))
      setTxState('idle')
    } finally {
      burningRef.current = false
    }
  }

  const burnAnother = () => {
    setMinted(undefined)
    setStep(0)
    setTracks([])
    setLabel('')
    setMessage('')
    setTxState('idle')
  }

  const routeTokenRaw = new URLSearchParams(location.hash.split('?')[1] ?? '').get('token')
  const routeToken = routeTokenRaw && /^\d+$/.test(routeTokenRaw) ? BigInt(routeTokenRaw) : 0n
  const live = Boolean(wallet.account && loadBurner(wallet.account))
  const writingTrack =
    txState === 'signing'
      ? Math.max(1, Math.ceil(tracks.length / 3))
      : txState === 'sent'
        ? Math.max(1, Math.ceil((tracks.length * 2) / 3))
        : tracks.length

  return (
    <div className="cd-program">
      <MenuBar
        menus={[
          {
            label: 'File',
            items: [
              {
                label: 'New CD',
                action: () => {
                  setStep(0)
                  setTracks([])
                  setLabel('')
                  setMinted(undefined)
                },
              },
            ],
          },
          {
            label: 'Help',
            items: [{ label: 'Help Topics', action: () => openProgram('help', true, helpHash('cd')) }],
          },
        ]}
      />
      <div className="cd-wizard">
        <aside className="cd-banner">
          <Icon name="music" size={72} colour="#5FEDDF" />
          <h2>Burn a CD</h2>
          <p>write 1–12 of your saved frames onto one onchain mix CD-R.</p>
          <ol>
            <li className={step === 0 ? 'active' : ''}>Select tracks</li>
            <li className={step === 1 ? 'active' : ''}>Label</li>
            <li className={step === 2 ? 'active' : ''}>Burn</li>
          </ol>
          {live && <small>Live Mode is on. CDs always use your main wallet.</small>}
        </aside>
        <main className="cd-main">
          {step === 0 && (
            <>
              <h2>Select tracks</h2>
              <p>finales are allowed. token #0 isn't.</p>
              <div className="cd-select-layout">
                <section className="cd-source sunken">
                  {!wallet.account ? (
                    <p className="cd-empty">connect a wallet to see your saved frames.</p>
                  ) : framesFor === wallet.account && !frames.length ? (
                    <div className="cd-empty">
                      <p>you have no saved frames to burn yet.</p>
                      <p>paint something, then in Paint choose File › Save frame….</p>
                      <Button onClick={() => openProgram('paint')}>Open Paint</Button>
                    </div>
                  ) : null}
                  {frames.map((track) => (
                    <FrameChoice
                      key={track.id}
                      track={track}
                      selected={selected === track.id}
                      onClick={() => setSelected(track.id)}
                      onDoubleClick={() => add(track.id)}
                    />
                  ))}
                </section>
                <div className="cd-add">
                  <Button
                    onClick={() => add(selected)}
                    disabled={selected == null || tracks.length >= 12}
                    title={
                      tracks.length >= 12
                        ? 'a CD holds 12 tracks at most'
                        : selected == null
                          ? 'pick a frame on the left first'
                          : 'add this frame to the CD'
                    }
                  >
                    Add ›
                  </Button>
                </div>
                <section className="cd-tracklist sunken">
                  {tracks.map((track, index) => (
                    <div key={track.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <b>frame #{track.id}</b>
                      <button onClick={() => move(index, -1)} disabled={index === 0}>
                        ↑
                      </button>
                      <button onClick={() => move(index, 1)} disabled={index === tracks.length - 1}>
                        ↓
                      </button>
                      <button
                        onClick={() => setTracks((current) => current.filter((item) => item.id !== track.id))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </section>
              </div>
              <div className="cd-capacity">
                <span style={{ width: `${(tracks.length / 12) * 100}%` }} />
                <b>
                  {tracks.length} / 12 tracks{tracks.length ? ` · ${displayFormat(tracks.length)}` : ''}
                </b>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h2>Label</h2>
              <div className="cd-label-layout">
                <div>
                  <label>
                    CD label
                    <input
                      value={label}
                      maxLength={24}
                      onChange={(event) => setLabel(event.target.value.toLowerCase())}
                      autoFocus
                    />
                  </label>
                  <p className={normalized.valid ? 'ok' : 'bad'}>
                    {normalized.valid
                      ? `${normalized.value.length} / 24 characters`
                      : "1–24 characters: a–z 0–9 space ! ? . , ' & - #"}
                  </p>
                  <p>
                    Colours are exact. <b>preview · final swirl is set at mint</b>
                  </p>
                </div>
                <div className="cd-preview sunken">
                  <SafeImage src={preview} alt="CD preview" width={360} height={360} />
                </div>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h2>Burn</h2>
              <div className="cd-burn-summary">
                <div className="cd-preview sunken">
                  <SafeImage src={preview} alt="CD preview" width={320} height={320} />
                </div>
                <div>
                  <p>
                    <b>{normalized.value}</b>
                  </p>
                  <p>
                    {tracks.length} tracks · {displayFormat(tracks.length)}
                  </p>
                  <p>
                    max cost: <b>{quote?.maxCost ?? 'quoting…'}</b>
                  </p>
                  <Button
                    primary
                    disabled={!quote || txState === 'signing' || txState === 'sent' || !!minted}
                    onClick={() => void burn()}
                  >
                    Burn CD
                  </Button>
                  {minted && <Button onClick={burnAnother}>Burn another CD</Button>}
                </div>
              </div>
              {minted && (
                <div className="cd-minted raised">
                  <SafeImage src={minted.data.image} alt={minted.data.name} width={180} height={180} />
                  <div>
                    <h3>{minted.data.name}</h3>
                    <dl>
                      {Object.entries(minted.data.attributes).map(([name, value]) => (
                        <span key={name}>
                          <dt>{name}</dt>
                          <dd>{String(value)}</dd>
                        </span>
                      ))}
                    </dl>
                    <Button onClick={() => openProgram('frames', true, `#/frames?labs=1&token=${minted.id}`)}>
                      Open in My Frames › Labs
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          <section className="cd-yours">
            <h3>Your CDs</h3>
            <div>
              {cds.slice(0, 6).map((token) => (
                <button
                  key={String(token.id)}
                  className={routeToken === token.id ? 'selected' : ''}
                  onClick={() => setMinted(token.data ? { id: token.id, data: token.data } : undefined)}
                >
                  <SafeImage
                    src={token.data?.image ?? ''}
                    alt={token.data?.name ?? ''}
                    width={72}
                    height={72}
                  />
                  <span>{token.data?.name ?? `CD #${token.id}`}</span>
                </button>
              ))}
            </div>
          </section>
          {message && <div className="cd-message">{message}</div>}
        </main>
      </div>
      <footer className="cd-wizard-actions">
        <Button
          onClick={() => setStep((value) => Math.max(0, value - 1))}
          disabled={step === 0}
          title={step === 0 ? 'this is the first step' : 'go back a step'}
        >
          ‹ Back
        </Button>
        <Button
          primary
          onClick={() => setStep((value) => Math.min(2, value + 1))}
          disabled={(step === 0 && tracks.length === 0) || (step === 1 && !normalized.valid) || step === 2}
          title={
            step === 0 && tracks.length === 0
              ? 'add at least one track first'
              : step === 1 && !normalized.valid
                ? 'write a label first (1–24 characters)'
                : step === 2
                  ? 'last step: press Burn'
                  : 'next step'
          }
        >
          Next ›
        </Button>
        <Button
          onClick={() => {
            setStep(0)
            setTracks([])
            setLabel('')
            closeWindow('cd')
          }}
        >
          Cancel
        </Button>
      </footer>
      {(txState === 'signing' || txState === 'sent') && (
        <div className="cd-progress-shade">
          <div className="cd-progress-dialog window">
            <div className="cd-spin">
              <Icon name="music" size={72} colour="#5FEDDF" />
            </div>
            <b>
              Writing track {writingTrack} of {tracks.length}…
            </b>
            <small>
              {txState === 'signing'
                ? 'waiting for your wallet signature'
                : 'transaction sent · waiting for confirmation'}
            </small>
          </div>
        </div>
      )}
    </div>
  )
}
