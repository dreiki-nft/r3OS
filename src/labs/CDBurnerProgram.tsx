import { helpHash } from '../os/helpTopics'
import { friendlyError, screenSafeMessage } from '../chain/errors'
import './artifacts.css'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { hexToBytes, parseAbi, parseEventLogs, type Address, type Hex, type Log } from 'viem'
import { publicClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { markProgramDataReady } from '../chain/perf'
import { readMany } from '../chain/readMany'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { getFrameImage } from '../frames/frameImage'
import { getFrameInfoBatch, mineTokenIds, type FrameInfo } from '../frames/framesStore'
import {
  labsAddress,
  labsBucket,
  loadOwnedLabsTokensBySources,
  type LabsOwnedToken,
} from '../frames/labsStore'
import { R3OS_CD_BURNER_ABI, R3OS_LABS_ABI, R3OS_PAINT_ABI } from '../lib/generated/abi'
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

type FrameTrack = { kind: 'frame'; id: number; info: FrameInfo }
type PhotoTrack = { kind: 'block-photo'; id: number; data: LabsTokenData }
type Track = FrameTrack | PhotoTrack

const MIXED_CD_ABI = parseAbi([
  'function burnMixedCD(uint256[] trackIds,uint8[] trackKinds,string label) returns (uint256 tokenId)',
])
const BLOCK_CAMERA_CD_ABI = parseAbi([
  'function cdTrackData(uint256 tokenId) view returns (uint32 season,uint48 blockNumber,uint256 colourCounts)',
])

const PHOTO_SEED_BIT = 1n << 255n
const sampledPhotos = new Map<number, number[]>()

function trackKey(track: Track) {
  return `${track.kind}:${track.id}`
}

function trackLabel(track: Track) {
  return track.kind === 'frame' ? `frame #${track.id}` : `photo #${track.id}`
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
    abi: R3OS_PAINT_ABI,
    functionName: 'frameData',
    args: [BigInt(id)],
  })) as Hex
  const counts = sampleTrackCounts(new Uint8Array(hexToBytes(raw)), info.backgroundColor)
  sampled.set(id, counts)
  return counts
}

async function countsForPhoto(id: number) {
  const cached = sampledPhotos.get(id)
  if (cached) return cached
  if (!publicClient) throw new Error('block photo data unavailable')
  const camera = (await discoverContracts()).labs['block-camera']
  if (!camera) throw new Error('Block Camera is not deployed on this network')
  const [, , packed] = (await publicClient.readContract({
    address: camera,
    abi: BLOCK_CAMERA_CD_ABI,
    functionName: 'cdTrackData',
    args: [BigInt(id)],
  })) as readonly [number, number, bigint]
  const counts = Array.from({ length: 16 }, (_, index) =>
    Number((packed >> BigInt(index * 16)) & 0xffffn),
  )
  sampledPhotos.set(id, counts)
  return counts
}

async function countsForTrack(track: Track) {
  return track.kind === 'frame' ? countsForFrame(track.id, track.info) : countsForPhoto(track.id)
}

async function staleTrackKeys(owner: Address, tracks: readonly Track[]) {
  if (!tracks.length) return []
  const contracts = await discoverContracts()
  const needsFrames = tracks.some((track) => track.kind === 'frame')
  const needsLabs = tracks.some((track) => track.kind === 'block-photo')
  if (needsFrames && !contracts.paint) throw new Error('paint is not deployed on this network')
  const labs = needsLabs ? await labsAddress() : undefined
  const rows = await readMany(
    tracks.map((track) => ({
      address: track.kind === 'frame' ? contracts.paint! : labs!,
      abi: track.kind === 'frame' ? R3OS_PAINT_ABI : R3OS_LABS_ABI,
      functionName: 'ownerOf',
      args: [BigInt(track.id)],
    })),
    { allowFailure: true },
  )
  const failed = rows.find((row: any) => row?.status !== 'success') as any
  if (failed) throw failed.error ?? new Error('CD_OWNERSHIP_UNAVAILABLE')
  const account = owner.toLowerCase()
  return tracks
    .filter((_, index) => String((rows[index] as any).result).toLowerCase() !== account)
    .map(trackKey)
}

function TrackChoice({
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
  const [src, setSrc] = useState(track.kind === 'block-photo' ? track.data.image : '')
  useEffect(() => {
    if (track.kind === 'block-photo') {
      setSrc(track.data.image)
      return
    }
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
  }, [track])

  const season =
    track.kind === 'frame'
      ? track.info.season + 1
      : Number(track.data.attributes.Season ?? 0) || undefined
  return (
    <button
      className={`cd-frame-choice ${selected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <SafeImage src={src} alt={trackLabel(track)} width={72} height={72} />
      <span>{trackLabel(track)}</span>
      <small>
        {track.kind === 'block-photo' ? 'Block Camera' : 'Paint'}
        {season != null ? ` · season ${season}` : ''}
        {track.kind === 'frame' && track.info.finale ? ' · finale' : ''}
      </small>
    </button>
  )
}

export function CDBurnerProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [step, setStep] = useState(0)
  const [burner, setBurner] = useState<Address>()
  const [sources, setSources] = useState<Track[]>([])
  const [sourcesFor, setSourcesFor] = useState<string>()
  const [selected, setSelected] = useState<string>()
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
      setSources([])
      setCds([])
      markProgramDataReady('cd')
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
      // Labs tokens are already owned by this wallet; only Block Camera portraits are valid photo tracks.
      const relevantSources = [address, contracts.labs['block-camera']].filter(
        (value): value is Address => Boolean(value),
      )
      const owned = await loadOwnedLabsTokensBySources(wallet.account, relevantSources)
      const photos: PhotoTrack[] = owned
        .filter(
          (token) =>
            token.data &&
            labsBucket(token.data) === 'Portraits' &&
            String(token.data.attributes.Lab ?? '').toLowerCase() === 'block camera',
        )
        .map((token) => ({ kind: 'block-photo' as const, id: Number(token.id), data: token.data! }))
      const frameTracks: FrameTrack[] = eligible.map((item) => ({ kind: 'frame', ...item }))
      const allSources: Track[] = [...frameTracks, ...photos]
      setSources(allSources)
      // Opened from My Frames with a frame selected (#/cd?frame=12): start with that frame as track 1.
      const rawRouteFrame = new URLSearchParams(location.hash.split('?')[1] ?? '').get('frame')
      if (rawRouteFrame && /^\d+$/.test(rawRouteFrame)) {
        const routed = frameTracks.find((track) => track.id === Number(rawRouteFrame))
        if (routed) setTracks((current) => (current.length ? current : [routed]))
      }
      const rawRoutePhoto = new URLSearchParams(location.hash.split('?')[1] ?? '').get('photo')
      if (rawRoutePhoto && /^\d+$/.test(rawRoutePhoto)) {
        const routed = photos.find((track) => track.id === Number(rawRoutePhoto))
        if (routed) setTracks((current) => (current.length ? current : [routed]))
      }
      setSourcesFor(wallet.account)
      const labs = await labsAddress()
      const total = BigInt(
        await publicClient.readContract({
          address: labs,
          abi: R3OS_LABS_ABI,
          functionName: 'totalMinted',
        }),
      )
      setPreviewToken(total + 1n)
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
    } finally {
      markProgramDataReady('cd')
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
    void Promise.all(tracks.map(countsForTrack))
      .then((counts) => !cancelled && setDiscMask(discMaskFromCounts(counts)))
      .catch((error) => !cancelled && setMessage(screenSafeMessage(error)))
    return () => {
      cancelled = true
    }
  }, [tracks.map(trackKey).join(',')])

  const normalized = normalizeCdLabel(label)
  const preview = useMemo(() => {
    if (!tracks.length) return ''
    return dataUri(
      cdSvg({
        tokenId: previewToken,
        frameIds: tracks.map((track) =>
          track.kind === 'block-photo' ? PHOTO_SEED_BIT | BigInt(track.id) : BigInt(track.id),
        ),
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
    const hasPhotos = tracks.some((track) => track.kind === 'block-photo')
    const functionName = hasPhotos ? 'burnMixedCD' : 'burnCD'
    void (async () => {
      const stale = await staleTrackKeys(wallet.account!, tracks)
      if (cancelled) return
      if (stale.length) {
        const staleSet = new Set(stale)
        const removed = tracks.filter((track) => staleSet.has(trackKey(track))).map(trackLabel)
        setTracks((current) => current.filter((track) => !staleSet.has(trackKey(track))))
        setQuote(undefined)
        setMessage(`${removed.join(', ')} ${removed.length === 1 ? 'is' : 'are'} no longer in this wallet and ${removed.length === 1 ? 'was' : 'were'} removed from the mix.`)
        void load()
        return
      }
      const next = await quoteAction({
        kind: 'estimate',
        address: burner,
        abi: hasPhotos ? MIXED_CD_ABI : R3OS_CD_BURNER_ABI,
        functionName,
        args: hasPhotos
          ? [
              tracks.map((track) => BigInt(track.id)),
              tracks.map((track) => (track.kind === 'block-photo' ? 1 : 0)),
              normalized.value,
            ]
          : [tracks.map((track) => BigInt(track.id)), normalized.value],
        account: wallet.account!,
        action: 'burn mix CD-R',
      })
      if (!cancelled) {
        setMessage('')
        setQuote(next)
      }
    })().catch((error) => {
      if (cancelled) return
      setQuote(undefined)
      const friendly = friendlyError(error, functionName)
      setMessage(
        hasPhotos && (friendly.name === 'Unknown' || friendly.name === 'ContractRevert')
          ? `mixed-photo CDs require the legacy testnet CD Burner on this network · ${friendly.message}`
          : friendly.message,
      )
    })
    return () => {
      cancelled = true
    }
  }, [
    step,
    wallet.account,
    burner,
    tracks.map(trackKey).join(','),
    normalized.value,
    normalized.valid,
    load,
  ])

  const add = (key?: string) => {
    if (!key || tracks.length >= 12 || tracks.some((track) => trackKey(track) === key)) return
    const source = sources.find((item) => trackKey(item) === key)
    if (source) setTracks((current) => [...current, source])
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
      const stale = await staleTrackKeys(wallet.account, tracks)
      if (stale.length) {
        const staleSet = new Set(stale)
        const removed = tracks.filter((track) => staleSet.has(trackKey(track))).map(trackLabel)
        setTracks((current) => current.filter((track) => !staleSet.has(trackKey(track))))
        setQuote(undefined)
        setMessage(`${removed.join(', ')} ${removed.length === 1 ? 'is' : 'are'} no longer in this wallet and ${removed.length === 1 ? 'was' : 'were'} removed from the mix.`)
        void load()
        setTxState('idle')
        return
      }
      const hasPhotos = tracks.some((track) => track.kind === 'block-photo')
      const result = await sendAction({
        kind: 'estimate',
        address: burner,
        abi: hasPhotos ? MIXED_CD_ABI : R3OS_CD_BURNER_ABI,
        functionName: hasPhotos ? 'burnMixedCD' : 'burnCD',
        args: hasPhotos
          ? [
              tracks.map((track) => BigInt(track.id)),
              tracks.map((track) => (track.kind === 'block-photo' ? 1 : 0)),
              normalized.value,
            ]
          : [tracks.map((track) => BigInt(track.id)), normalized.value],
        account: wallet.account,
        quote,
        action: 'burn mix CD-R',
        successSound: 'success-heavy',
        onState: setTxState,
      })
      // the minted id comes from this tx's CDBurned event, not totalMinted(), which races other Labs mints
      const burned = parseEventLogs({
        abi: R3OS_CD_BURNER_ABI,
        eventName: 'CDBurned',
        logs: result.receipt.logs as Log[],
      })[0]
      const id = burned
        ? BigInt(burned.args.tokenId)
        : BigInt(
            await publicClient!.readContract({
              address: await labsAddress(),
              abi: R3OS_LABS_ABI,
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
          <p>write 1–12 saved Paint frames or Block Camera photos onto one onchain mix CD-R.</p>
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
                    <p className="cd-empty">connect a wallet to see your saved frames and block photos.</p>
                  ) : sourcesFor === wallet.account && !sources.length ? (
                    <div className="cd-empty">
                      <p>you have no saved frames or Block Camera photos to burn yet.</p>
                      <p>save a Paint frame or capture a Block Camera photo first.</p>
                      <Button onClick={() => openProgram('paint')}>Open Paint</Button>
                    </div>
                  ) : null}
                  {sources.map((track) => (
                    <TrackChoice
                      key={trackKey(track)}
                      track={track}
                      selected={selected === trackKey(track)}
                      onClick={() => setSelected(trackKey(track))}
                      onDoubleClick={() => add(trackKey(track))}
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
                          ? 'pick a frame or photo on the left first'
                          : 'add this item to the CD'
                    }
                  >
                    Add ›
                  </Button>
                </div>
                <section className="cd-tracklist sunken">
                  {tracks.map((track, index) => (
                    <div key={trackKey(track)}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <b>{trackLabel(track)}</b>
                      <button onClick={() => move(index, -1)} disabled={index === 0}>
                        ↑
                      </button>
                      <button onClick={() => move(index, 1)} disabled={index === tracks.length - 1}>
                        ↓
                      </button>
                      <button
                        onClick={() =>
                          setTracks((current) => current.filter((item) => trackKey(item) !== trackKey(track)))
                        }
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
                : 'transaction sent · waiting for receipt'}
            </small>
          </div>
        </div>
      )}
    </div>
  )
}
