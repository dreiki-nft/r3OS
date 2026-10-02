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
  kind: 'txt' | 'bmp'
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
    ...cd.snapshot.tracks.map((track) => ({
      key: `track-${track.index}`,
      name: trackFileName(track.index),
      kind: 'bmp' as const,
      size: TRACK_BMP_BYTES,
      type: 'Bitmap Image',
      modified: cd.frameTimestamps.get(track.frameId),
      track: track.index,
    })),
  ]
}

function TrackThumb({ frameId, size }: { frameId: number; size: number }) {
  const [image, setImage] = useState<PixelImage>()
  useEffect(() => {
    let cancelled = false
    setImage(undefined)
    getFrameImage(frameId)
      .then((next) => !cancelled && setImage(next))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [frameId])
  return <PixelPreview image={image} size={size} className="cdrom-thumb" />
}

export function CdromProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  useSyncExternalStore(subscribeCdrom, getCdromVersion)
  const disc = currentDisc(wallet.account)

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

  // Read the inserted disc (and eject it if it has left the wallet).
  useEffect(() => {
    setCd(undefined)
    setSelected(undefined)
    setError('')
    if (!wallet.account || !disc) return
    let cancelled = false
    const account = wallet.account
    const tokenId = BigInt(disc.tokenId)
    setReading(true)
    const started = Date.now()
    void (async () => {
      const owner = await cdOwner(tokenId)
      if (owner && owner.toLowerCase() !== account.toLowerCase()) {
        if (cancelled) return
        ejectDisc(account)
        setNotice(`the disc in drive D: (CD #${tokenId}) is no longer in this wallet, so it was ejected.`)
        return
      }
      const loaded = await loadCd(tokenId)
      const nextStatuses = await trackStatuses(loaded.snapshot.tracks.map((track) => track.frameId)).catch(
        () => new Map<number, TrackStatus>(),
      )
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
  }, [wallet.account, disc?.tokenId])

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
    insertDisc(wallet.account, { tokenId: choice.tokenId.toString(), label: choice.label })
    setPicker(false)
    setNotice('')
  }

  const eject = () => {
    if (!wallet.account || !disc) return
    ejectDisc(wallet.account)
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
  const selectedStatus = selectedTrack ? statuses.get(selectedTrack.frameId) : undefined

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
              <p className="cdrom-hint">select an item to view its description.</p>
            </>
          )}
          {selectedFile && (
            <div className="cdrom-webview-selection">
              <b>{selectedFile.name}</b>
              <span>{selectedFile.type}</span>
              {selectedTrack && <TrackThumb frameId={selectedTrack.frameId} size={128} />}
              {selectedFile.modified && <span>Modified: {win98Date(selectedFile.modified)}</span>}
              <span>Size: {explorerSize(selectedFile.size)}</span>
              {selectedTrack && (
                <>
                  <span>
                    frame #{selectedTrack.frameId} · season {selectedTrack.season + 1}
                    {selectedTrack.storm ? ' · storm' : ''}
                    {selectedTrack.finale ? ' · finale' : ''}
                  </span>
                  <span>
                    {selectedStatus?.recycled
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
                  name={file.kind === 'bmp' ? 'gallery' : 'info'}
                  size={view === 'icons' ? 36 : 16}
                  colour={file.kind === 'bmp' ? '#EE93E3' : '#FFFFFF'}
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
              {!wallet.account ? (
                <p>connect a wallet to play the CDs you own.</p>
              ) : (
                <>
                  <p>drive D: is empty. insert one of your CDs to play it.</p>
                  <div className="cdrom-empty-actions">
                    <Button primary onClick={() => void openPicker()}>
                      Insert disc…
                    </Button>
                    <Button onClick={() => openProgram('cd')}>Burn a CD</Button>
                  </div>
                </>
              )}
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
