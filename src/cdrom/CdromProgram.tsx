import { helpHash } from '../os/helpTopics'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { getFrameImage, type PixelImage } from '../frames/frameImage'
import { PixelPreview } from '../frames/PixelPreview'
import { openProgram } from '../os/programs'
import { playSound } from '../os/sound'
import { Button } from '../os/ui/Button'
import { Icon } from '../os/ui/Icon'
import { MenuBar } from '../os/ui/MenuBar'
import { MessageBox } from '../os/ui/MessageBox'
import { SafeImage } from '../os/ui/SafeImage'
import { closeWindow } from '../os/windows'
import {
  cdInfoText,
  cdOwner,
  cdromIdFromHash,
  explorerSize,
  explorerTotal,
  loadCd,
  loadCdSummary,
  loadOwnedCds,
  shortAddress,
  trackFileName,
  trackStatuses,
  TRACK_BMP_BYTES,
  volumeLabel,
  win98Date,
  type CdSummary,
  type LoadedCd,
  type TrackStatus,
} from './cdrom'
import {
  currentDisc,
  ejectDisc,
  getCdromVersion,
  insertDisc,
  setImagingTarget,
  subscribeCdrom,
} from './cdromStore'
import './cdrom.css'

type View = 'details' | 'icons'

interface DriveFile {
  key: string
  name: string
  kind: 'txt' | 'image'
  size: number
  type: string
  modified?: number
  track?: number
}

function filesFor(cd: LoadedCd, infoText: string): DriveFile[] {
  return [
    {
      key: 'info',
      name: 'CDINFO.TXT',
      kind: 'txt',
      size: new TextEncoder().encode(infoText).length,
      type: 'Text Document',
      modified: cd.mintTimestamp,
    },
    ...cd.snapshot.tracks.map((track) => {
      const photo = track.kind === 'block-photo' ? cd.photos.get(track.sourceId) : undefined
      const photoTimestamp = Number(photo?.attributes.Timestamp ?? 0) || undefined
      return {
        key: `track-${track.index}`,
        name: trackFileName(track.index, track.kind),
        kind: 'image' as const,
        size:
          track.kind === 'frame'
            ? TRACK_BMP_BYTES
            : new TextEncoder().encode(photo?.image ?? '').length,
        type: track.kind === 'frame' ? 'Bitmap Image' : 'Onchain SVG Image',
        modified: track.kind === 'frame' ? cd.frameTimestamps.get(track.sourceId) : photoTimestamp,
        track: track.index,
      }
    }),
  ]
}

function TrackThumb({ cd, trackIndex, size }: { cd: LoadedCd; trackIndex: number; size: number }) {
  const track = cd.snapshot.tracks[trackIndex]
  const [image, setImage] = useState<PixelImage>()
  useEffect(() => {
    let cancelled = false
    setImage(undefined)
    if (!track || track.kind !== 'frame') return
    getFrameImage(track.sourceId)
      .then((next) => !cancelled && setImage(next))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [track?.kind, track?.sourceId])
  if (!track) return null
  if (track.kind === 'block-photo') {
    const photo = cd.photos.get(track.sourceId)
    return <SafeImage src={photo?.image ?? ''} alt={photo?.name ?? `block photo #${track.sourceId}`} width={size} height={size} />
  }
  return <PixelPreview image={image} size={size} className="cdrom-thumb" />
}

export function CdromProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  useSyncExternalStore(subscribeCdrom, getCdromVersion)
  const [routeCdId, setRouteCdId] = useState(() =>
    cdromIdFromHash(typeof location === 'undefined' ? '' : location.hash),
  )
  const publicDisc = routeCdId ? { tokenId: routeCdId, label: `cd #${routeCdId}` } : undefined
  const disc = publicDisc ?? currentDisc(wallet.account)
  const publicMode = Boolean(publicDisc)

  useEffect(() => {
    const route = () => {
      if (location.hash === '#/cdrom' || location.hash.startsWith('#/cdrom?')) {
        setRouteCdId(cdromIdFromHash(location.hash))
      }
    }
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])

  const [cd, setCd] = useState<LoadedCd>()
  const [statuses, setStatuses] = useState<Map<number, TrackStatus>>(new Map())
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState(false)
  const [available, setAvailable] = useState<CdSummary[]>()
  const [pickerChoice, setPickerChoice] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [view, setView] = useState<View>('details')
  const [notepad, setNotepad] = useState(false)
  const [notice, setNotice] = useState('')

  // Read the inserted disc. Wallet discs are ownership-checked; public deep links are read-only.
  useEffect(() => {
    setCd(undefined)
    setSelected(undefined)
    setError('')
    if (!disc) return
    let cancelled = false
    const account = wallet.account
    const tokenId = BigInt(disc.tokenId)
    setReading(true)
    const started = Date.now()
    void (async () => {
      if (!publicMode && account) {
        const owner = await cdOwner(tokenId)
        if (owner && owner.toLowerCase() !== account.toLowerCase()) {
          if (cancelled) return
          ejectDisc(account)
          setNotice(`the disc in drive D: (CD #${tokenId}) is no longer in this wallet, so it was ejected.`)
          return
        }
      }
      const loaded = await loadCd(tokenId)
      const frameIds = loaded.snapshot.tracks
        .filter((track) => track.kind === 'frame')
        .map((track) => track.sourceId)
      const nextStatuses = await trackStatuses(frameIds).catch(() => new Map<number, TrackStatus>())
      // A short spin-up so inserting a disc feels like a drive, never longer than the real read.
      const wait = Math.max(0, 700 - (Date.now() - started))
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      if (cancelled) return
      setCd(loaded)
      setStatuses(nextStatuses)
      playSound('confirm')
    })()
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setReading(false)
      })
    return () => {
      cancelled = true
    }
  }, [wallet.account, disc?.tokenId, publicMode])

  const openPicker = useCallback(async () => {
    setPicker(true)
    setAvailable(undefined)
    setPickerChoice(undefined)
    if (!wallet.account) return
    const account: Address = wallet.account
    try {
      const ids = await loadOwnedCds(account)
      const summaries = await Promise.all(
        ids.map((id) => loadCdSummary(id).catch(() => ({ tokenId: id, label: `cd #${id}`, trackCount: 0 }))),
      )
      setAvailable(summaries)
      setPickerChoice(summaries[0]?.tokenId.toString())
    } catch (cause) {
      setAvailable([])
      setNotice(cause instanceof Error ? cause.message : String(cause))
    }
  }, [wallet.account])

  const insert = () => {
    if (!wallet.account || !pickerChoice || !available) return
    const choice = available.find((item) => item.tokenId.toString() === pickerChoice)
    if (!choice) return
    if (publicMode) {
      history.replaceState(null, '', '#/cdrom')
      setRouteCdId(undefined)
    }
    insertDisc(wallet.account, { tokenId: choice.tokenId.toString(), label: choice.label })
    setPicker(false)
    setNotice('')
  }

  const eject = () => {
    if (!disc) return
    if (publicMode) {
      history.replaceState(null, '', '#/cdrom')
      setRouteCdId(undefined)
    } else if (wallet.account) {
      ejectDisc(wallet.account)
    }
    playSound('cancel')
    setNotice('')
  }

  const infoText = useMemo(() => (cd ? cdInfoText(cd, statuses) : ''), [cd, statuses])
  const files = useMemo(() => (cd ? filesFor(cd, infoText) : []), [cd, infoText])
  const selectedFile = files.find((file) => file.key === selected)
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const title = disc ? `${volumeLabel(cd?.snapshot.label ?? disc.label)} (D:)` : 'CD-ROM (D:)'

  const openFile = (file: DriveFile) => {
    playSound('select')
    if (file.kind === 'txt') {
      setNotepad(true)
      return
    }
    if (!cd || file.track == null) return
    setImagingTarget({ cdId: cd.tokenId.toString(), track: file.track })
    openProgram('imaging', true, `#/imaging?cd=${cd.tokenId}&track=${file.track + 1}`)
  }

  const selectedTrack = selectedFile?.track != null ? cd?.snapshot.tracks[selectedFile.track] : undefined
  const selectedStatus =
    selectedTrack?.kind === 'frame' ? statuses.get(selectedTrack.sourceId) : undefined

  return (
    <div className="cdrom-program">
      <MenuBar
        menus={[
          {
            label: 'File',
            items: [
              {
                label: 'Open',
                disabled: !selectedFile,
                disabledReason: disc ? 'select a file first' : 'insert a disc first',
                action: () => selectedFile && openFile(selectedFile),
              },
              {
                label: 'Insert disc…',
                disabled: !wallet.account,
                disabledReason: 'connect a wallet first',
                action: () => void openPicker(),
              },
              { label: 'Eject', disabled: !disc, disabledReason: 'no disc in the drive', action: eject },
              { label: 'Close', action: () => closeWindow('cdrom') },
            ],
          },
          {
            label: 'View',
            items: [
              { label: `Large Icons${view === 'icons' ? ' ✓' : ''}`, action: () => setView('icons') },
              { label: `Details${view === 'details' ? ' ✓' : ''}`, action: () => setView('details') },
            ],
          },
          {
            label: 'Help',
            items: [{ label: 'Help Topics', action: () => openProgram('help', true, helpHash('cdrom')) }],
          },
        ]}
      />
      <div className="cdrom-toolbar raised">
        <Button
          onClick={() => void openPicker()}
          disabled={!wallet.account}
          title={!wallet.account ? 'connect a wallet first' : 'choose one of your CDs'}
        >
          Insert disc…
        </Button>
        <Button onClick={eject} disabled={!disc} title={!disc ? 'no disc in the drive' : 'eject the disc'}>
          Eject
        </Button>
        <span className="cdrom-toolbar-sep" />
        <Button
          onClick={() => setView('icons')}
          disabled={view === 'icons'}
          title={view === 'icons' ? 'already showing large icons' : 'show large icons'}
        >
          Large Icons
        </Button>
        <Button
          onClick={() => setView('details')}
          disabled={view === 'details'}
          title={view === 'details' ? 'already showing details' : 'show details'}
        >
          Details
        </Button>
      </div>
      <div className="cdrom-address">
        <span>Address</span>
        <div className="cdrom-address-field sunken">
          <Icon name={disc ? 'disc' : 'cdrom'} size={16} colour="#c9c9c9" />
          <code>D:\</code>
        </div>
      </div>

      <div className="cdrom-body">
        <aside className="cdrom-webview">
          <span className={`cdrom-webview-art ${reading ? 'spinning' : ''}`}>
            {cd?.token?.image ? (
              <SafeImage src={cd.token.image} alt={cd.token.name} width={112} height={112} />
            ) : (
              <Icon name={disc ? 'disc' : 'cdrom'} size={72} colour="#c9c9c9" />
            )}
          </span>
          <h2>{title}</h2>
          <hr />
          {!disc && <p>no disc in the drive.</p>}
          {disc && reading && <p>reading D:\…</p>}
          {disc && cd && !selectedFile && (
            <>
              <p>
                CD-R · {cd.snapshot.trackCount} track{cd.snapshot.trackCount === 1 ? '' : 's'}
                {cd.token?.attributes.Format ? ` · ${String(cd.token.attributes.Format)}` : ''}
              </p>
              <p>burned by {shortAddress(cd.burner)}</p>
              {publicMode && <p className="cdrom-hint">public disc · read-only · no wallet required</p>}
              <p className="cdrom-hint">select an item to view its description.</p>
            </>
          )}
          {selectedFile && (
            <div className="cdrom-webview-selection">
              <b>{selectedFile.name}</b>
              <span>{selectedFile.type}</span>
              {selectedTrack && cd && <TrackThumb cd={cd} trackIndex={selectedTrack.index} size={128} />}
              {selectedFile.modified && <span>Modified: {win98Date(selectedFile.modified)}</span>}
              <span>Size: {explorerSize(selectedFile.size)}</span>
              {selectedTrack && (
                <>
                  <span>
                    {selectedTrack.kind === 'frame' ? 'frame' : 'block photo'} #{selectedTrack.sourceId} · season{' '}
                    {selectedTrack.season + 1}
                    {selectedTrack.storm ? ' · storm' : ''}
                    {selectedTrack.finale ? ' · finale' : ''}
                  </span>
                  <span>
                    {selectedTrack.kind === 'block-photo'
                      ? 'source is an immutable r3tards Labs Block Camera NFT'
                      : selectedStatus?.recycled
                        ? 'source frame recycled · the art is still onchain'
                        : selectedStatus?.owner
                          ? `source frame owner ${shortAddress(selectedStatus.owner)}`
                          : ''}
                  </span>
                </>
              )}
            </div>
          )}
        </aside>

        <main className={`cdrom-files sunken ${view}`}>
          {view === 'details' && (
            <div className="cdrom-files-head">
              <span>Name</span>
              <span>Size</span>
              <span>Type</span>
              <span>Modified</span>
            </div>
          )}
          {files.map((file) => (
            <button
              key={file.key}
              className={`cdrom-file ${selected === file.key ? 'selected' : ''}`}
              onClick={() => setSelected(file.key)}
              onDoubleClick={() => openFile(file)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') openFile(file)
              }}
            >
              <span className="cdrom-file-name">
                <Icon
                  name={file.kind === 'image' ? 'gallery' : 'info'}
                  size={view === 'icons' ? 36 : 16}
                  colour={file.kind === 'image' ? '#EE93E3' : '#FFFFFF'}
                />
                <span>{file.name}</span>
              </span>
              {view === 'details' && (
                <>
                  <span className="cdrom-num">{explorerSize(file.size)}</span>
                  <span>{file.type}</span>
                  <span>{file.modified ? win98Date(file.modified) : ''}</span>
                </>
              )}
            </button>
          ))}
          {!disc && (
            <div className="cdrom-empty cdrom-empty-state">
              <p>
                {wallet.account
                  ? 'drive D: is empty. insert one of your CDs to play it.'
                  : 'connect a wallet to insert a CD you own, or open a shared CD link.'}
              </p>
              <div className="cdrom-empty-actions">
                <Button
                  primary
                  onClick={() => void openPicker()}
                  disabled={!wallet.account}
                  title={!wallet.account ? 'connect a wallet to insert one of your CDs' : 'choose one of your CDs'}
                >
                  Insert disc…
                </Button>
                <Button onClick={() => openProgram('cd')}>Burn a CD</Button>
              </div>
            </div>
          )}
          {disc && reading && <p className="cdrom-empty">Reading D:\…</p>}
          {disc && error && <p className="cdrom-empty">D:\ could not be read. {error}</p>}
        </main>
      </div>

      <footer className="cdrom-status">
        <span>{cd ? `${files.length} object(s)` : '0 object(s)'}</span>
        <span>{cd ? explorerTotal(totalBytes) : ''}</span>
        <span>
          <Icon name="computer" size={16} colour="#FFFFFF" /> My Computer
        </span>
      </footer>

      {picker && (
        <MessageBox
          title="Insert disc"
          defaultLabel="OK"
          onDefault={insert}
          onCancel={() => undefined}
          onClose={() => setPicker(false)}
        >
          {!wallet.account ? (
            <p>connect a wallet to see the discs it holds.</p>
          ) : available == null ? (
            <p>looking for discs in this wallet…</p>
          ) : !available.length ? (
            <div>
              <p>
                no discs in this wallet yet. burn one from your saved frames with <b>Burn a CD</b>.
              </p>
              <Button
                onClick={() => {
                  setPicker(false)
                  openProgram('cd')
                }}
              >
                Open Burn a CD
              </Button>
            </div>
          ) : (
            <div className="cdrom-picker" role="listbox" aria-label="discs">
              {available.map((item) => (
                <label
                  key={item.tokenId.toString()}
                  className={pickerChoice === item.tokenId.toString() ? 'selected' : ''}
                >
                  <input
                    type="radio"
                    name="cdrom-disc"
                    checked={pickerChoice === item.tokenId.toString()}
                    onChange={() => setPickerChoice(item.tokenId.toString())}
                  />
                  <Icon name="disc" size={24} colour="#c9c9c9" />
                  <span>
                    <b>{volumeLabel(item.label)}</b>
                    <small>
                      cd #{item.tokenId.toString()} · {item.trackCount} track
                      {item.trackCount === 1 ? '' : 's'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </MessageBox>
      )}

      {notepad && cd && (
        <MessageBox title="CDINFO.TXT - Notepad" onClose={() => setNotepad(false)}>
          <pre className="cdrom-notepad sunken">{infoText}</pre>
        </MessageBox>
      )}

      {notice && (
        <MessageBox kind="warning" title="CD-ROM (D:)" message={notice} onClose={() => setNotice('')} />
      )}
    </div>
  )
}
