import './defrag.css'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { decodeEventLog, parseAbiItem, type Address, type Hex, type Log } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient, wsClient } from '../chain/clients'
import { getLogsWindow } from '../chain/logs'
import { discoverContracts } from '../chain/contracts'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { MessageBox } from '../os/ui/MessageBox'
import { Icon } from '../os/ui/Icon'
import {
  BRUSH_BOX_SLOTS_USED,
  CANVAS_PAGES,
  DRIVE_C_PAGES,
  FLIPBOOK_PAGES,
  PAGE_SLOTS,
  advanceDefrag,
  brushStorageTouches,
  completionMessage,
  countColdWarm,
  flipbookStorageTouches,
  paintStorageTouches,
  pauseDefrag,
  resumeDefrag,
  samePageShare,
  startDefrag,
  stopDefrag,
  type DefragAnimation,
  type DefragDrive,
  type SlotTouch,
} from './defrag'

const PAINTED = parseAbiItem(
  'event Painted(uint256 indexed season,address indexed owner,address indexed sender,bytes runs,bytes corruptions,uint32 unitsSpent,uint16 regionsMask)',
)
const FLIPBOOK_PAINTED = parseAbiItem(
  'event FlipbookPainted(uint64 indexed frameNumber,address indexed owner,address indexed sender,bytes runs,uint16 pixels)',
)
const BRUSH_CAUGHT = parseAbiItem(
  'event BrushCaught(address indexed owner,address sender,uint8 slot,uint256 indexed blockNumber,uint256 brush)',
)

const RULES = [
  'each square is one storage slot: 32 bytes, 64 pixels. a page is 128 squares, which is 32 canvas rows.',
  'when a paint lands, the slots it writes flash red. reads flash green.',
  'the first touch of a page is cold. every other touch in that page is warm and costs less gas.',
  "estimated from the contracts' storage layout and each tx's calldata, like Lanes.",
]

type Addresses = { paint: Address; flipbook?: Address; brushes?: Address }

function drivePages(drive: DefragDrive, boxPages: number) {
  return drive === 'C' ? DRIVE_C_PAGES : drive === 'D' ? FLIPBOOK_PAGES : Math.max(1, boxPages)
}

function driveTitle(drive: DefragDrive) {
  if (drive === 'C') return 'r3tards paint canvas'
  if (drive === 'D') return 'flipbook reel'
  return 'block dna boxes'
}

function baseSlotClass(drive: DefragDrive, slot: number) {
  if (drive === 'C') {
    const page = Math.floor(slot / PAGE_SLOTS)
    if (page >= CANVAS_PAGES + 16) return 'frozen'
    if (page < CANVAS_PAGES) return 'optimized'
    return slot % PAGE_SLOTS <= 60 ? 'optimized' : 'free'
  }
  if (drive === 'D') return 'optimized'
  return slot % PAGE_SLOTS < BRUSH_BOX_SLOTS_USED ? 'optimized' : 'free'
}

function parseLog(log: Log, addresses: Addresses, boxIndex: (owner: Address) => number): SlotTouch[] {
  if (log.blockNumber == null) return []
  const address = log.address.toLowerCase()
  try {
    if (address === addresses.paint.toLowerCase()) {
      const decoded = decodeEventLog({ abi: [PAINTED], data: log.data, topics: log.topics, strict: false })
      if (decoded.eventName !== 'Painted') return []
      const args = decoded.args as { runs?: Hex }
      return args.runs ? paintStorageTouches(args.runs, log.blockNumber) : []
    }
    if (addresses.flipbook && address === addresses.flipbook.toLowerCase()) {
      const decoded = decodeEventLog({
        abi: [FLIPBOOK_PAINTED],
        data: log.data,
        topics: log.topics,
        strict: false,
      })
      if (decoded.eventName !== 'FlipbookPainted') return []
      const args = decoded.args as { frameNumber?: bigint }
      return flipbookStorageTouches(args.frameNumber ?? 0n, log.blockNumber)
    }
    if (addresses.brushes && address === addresses.brushes.toLowerCase()) {
      const decoded = decodeEventLog({
        abi: [BRUSH_CAUGHT],
        data: log.data,
        topics: log.topics,
        strict: false,
      })
      if (decoded.eventName !== 'BrushCaught') return []
      const args = decoded.args as { owner?: Address }
      if (!args.owner) return []
      return brushStorageTouches(args.owner, boxIndex(args.owner), log.blockNumber)
    }
  } catch {
    return []
  }
  return []
}

export function DefragProgram() {
  const clock = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [drive, setDrive] = useState<DefragDrive>('C')
  const [selectOpen, setSelectOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [stopConfirm, setStopConfirm] = useState(false)
  const [doneMessage, setDoneMessage] = useState('')
  const [touches, setTouches] = useState<SlotTouch[]>([])
  const [addresses, setAddresses] = useState<Addresses>()
  const [animation, setAnimation] = useState<DefragAnimation>({ phase: 'idle', progress: 0 })
  const owners = useRef<Address[]>(wallet.account ? [wallet.account] : [])
  const lastPolled = useRef<bigint | undefined>(undefined)

  const boxIndex = (owner: Address) => {
    const lower = owner.toLowerCase()
    const existing = owners.current.findIndex((entry) => entry.toLowerCase() === lower)
    if (existing >= 0) return existing
    owners.current =
      owners.current.length >= 8 ? [...owners.current.slice(0, 7), owner] : [...owners.current, owner]
    return owners.current.findIndex((entry) => entry.toLowerCase() === lower)
  }

  useEffect(() => {
    if (
      wallet.account &&
      !owners.current.some((entry) => entry.toLowerCase() === wallet.account!.toLowerCase())
    ) {
      owners.current = [wallet.account, ...owners.current].slice(0, 8)
    }
  }, [wallet.account])

  useEffect(() => {
    void discoverContracts().then((contracts) => {
      if (!contracts.paint) return
      setAddresses({
        paint: contracts.paint,
        flipbook: contracts.labs.flipbook,
        brushes: contracts.labs.brushes,
      })
    })
  }, [])

  useEffect(() => {
    if (!addresses || !publicClient || clock.block <= 0n) return
    let cancelled = false
    const list = [addresses.paint, addresses.flipbook, addresses.brushes].filter(Boolean) as Address[]
    const fromBlock = clock.block >= 99n ? clock.block - 99n : 0n
    void getLogsWindow({ address: list, fromBlock, toBlock: clock.block, maxBlocks: 100 })
      .then((logs) => {
        if (cancelled) return
        const mapped = (logs as Log[]).flatMap((log) => parseLog(log, addresses, boxIndex))
        setTouches(mapped)
        lastPolled.current = clock.block
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [addresses])

  useEffect(() => {
    if (!addresses || !wsClient) return
    const list = [addresses.paint, addresses.flipbook, addresses.brushes].filter(Boolean) as Address[]
    return (wsClient as any).watchEvent({
      address: list,
      onLogs: (logs: Log[]) => {
        const mapped = logs.flatMap((log) => parseLog(log, addresses, boxIndex))
        const keepFrom = getBlockSnapshot().block >= 99n ? getBlockSnapshot().block - 99n : 0n
        setTouches((current) => [...current.filter((touch) => touch.blockNumber >= keepFrom), ...mapped])
      },
    }) as () => void
  }, [addresses])

  useEffect(() => {
    if (!addresses || !publicClient || wsClient || clock.block <= 0n) return
    const previous = lastPolled.current
    if (previous == null) {
      lastPolled.current = clock.block
      return
    }
    if (clock.block <= previous || clock.block - previous < 10n) return
    const keepFrom = clock.block >= 99n ? clock.block - 99n : 0n
    const fromBlock = previous + 1n > keepFrom ? previous + 1n : keepFrom
    const toBlock = clock.block
    lastPolled.current = toBlock
    const list = [addresses.paint, addresses.flipbook, addresses.brushes].filter(Boolean) as Address[]
    void getLogsWindow({ address: list, fromBlock, toBlock, maxBlocks: 100 })
      .then((logs) => {
        const mapped = (logs as Log[]).flatMap((log) => parseLog(log, addresses, boxIndex))
        const keepFrom = clock.block >= 99n ? clock.block - 99n : 0n
        setTouches((current) => [...current.filter((touch) => touch.blockNumber >= keepFrom), ...mapped])
      })
      .catch(() => undefined)
  }, [addresses, clock.block])

  useEffect(() => {
    if (animation.phase !== 'reading' && animation.phase !== 'moving') return
    const timer = window.setTimeout(() => setAnimation((state) => advanceDefrag(state)), 110)
    return () => window.clearTimeout(timer)
  }, [animation])

  useEffect(() => {
    if (animation.phase !== 'complete') return
    setDoneMessage(completionMessage(drive, drivePages(drive, owners.current.length)))
  }, [animation.phase, drive])

  const visibleTouches = useMemo(() => touches.filter((touch) => touch.drive === drive), [touches, drive])
  const bySlot = useMemo(() => {
    const map = new Map<number, SlotTouch>()
    for (const touch of visibleTouches) {
      const prior = map.get(touch.slot)
      if (!prior || prior.blockNumber <= touch.blockNumber) map.set(touch.slot, touch)
    }
    return map
  }, [visibleTouches])
  const blocks = useMemo(() => {
    const map = new Map<bigint, SlotTouch[]>()
    for (const touch of visibleTouches) {
      const list = map.get(touch.blockNumber) ?? []
      list.push(touch)
      map.set(touch.blockNumber, list)
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-100)
      .map(([, value]) => value)
  }, [visibleTouches])
  const lastBlockTouches = blocks.at(-1) ?? []
  const stats = countColdWarm(lastBlockTouches)
  const share = samePageShare(blocks)
  const pageCount = drivePages(drive, owners.current.length)
  const slotCount = pageCount * PAGE_SLOTS
  const running = animation.phase === 'reading' || animation.phase === 'moving'

  return (
    <div className="defrag-program">
      <MenuBar
        menus={[
          {
            label: 'File',
            items: [
              { label: 'Select Drive…', action: () => setSelectOpen(true) },
              { label: 'Exit', action: () => closeWindow('defrag') },
            ],
          },
          { label: 'View', items: [{ label: 'Legend…', action: () => setLegendOpen(true) }] },
          { label: 'Help', items: [{ label: 'About storage pages', disabled: true }] },
        ]}
      />
      <IntroBar
        lead="your canvas as Monad stores it: 4 KB pages of storage. watch each paint light up the pages it touches."
        monad="since MonadTen, storage lives in 4 KB pages of 128 slots. the first touch warms the whole page, so data that sits together is cheaper to use together. we laid the canvas out page by page on purpose."
        rules={RULES}
      />

      <div className="defrag-head">
        <div>
          <Icon name="layers" size={28} colour="#9F70DA" />
          <span>
            <b>Defragmenting Drive {drive}</b>
            <small>{driveTitle(drive)}</small>
          </span>
        </div>
        <Button onClick={() => setLegendOpen(true)}>Legend…</Button>
      </div>

      <div className="defrag-grid sunken" aria-label={`${slotCount} storage slots`}>
        {Array.from({ length: slotCount }, (_, position) => {
          const shuffle = animation.phase === 'moving' ? Math.floor(animation.progress / 8) * 17 : 0
          const slot = slotCount ? (position + shuffle) % slotCount : position
          const touch = bySlot.get(slot)
          const fresh = touch && clock.block >= touch.blockNumber && clock.block - touch.blockNumber <= 1n
          const className = fresh
            ? touch.mode === 'read'
              ? 'reading'
              : 'writing'
            : baseSlotClass(drive, slot)
          return (
            <i
              key={position}
              className={`${className} ${position % PAGE_SLOTS === 0 ? 'page-start' : ''}`}
              title={`slot ${slot} · page ${Math.floor(slot / PAGE_SLOTS)}`}
            />
          )
        })}
      </div>

      <section className="defrag-details group">
        <span className="legend-label">Details</span>
        <div>
          <small>pages touched, last block</small>
          <b>{stats.pages}</b>
        </div>
        <div>
          <small>slots touched</small>
          <b>{stats.total}</b>
        </div>
        <div>
          <small>cold page touches</small>
          <b>{stats.cold}</b>
        </div>
        <div>
          <small>warm touches</small>
          <b>{stats.warm}</b>
        </div>
        <div>
          <small>same-page share · 100 blocks</small>
          <b>{Math.round(share * 100)}%</b>
        </div>
      </section>

      <div className="defrag-progress sunken">
        <span style={{ width: `${animation.progress}%` }} />
      </div>
      <div className="defrag-controls">
        <span>
          {animation.phase === 'reading'
            ? 'Reading drive information…'
            : animation.phase === 'moving'
              ? 'Optimizing page layout…'
              : animation.phase === 'paused'
                ? 'Paused'
                : animation.phase === 'complete'
                  ? 'Complete'
                  : 'Ready'}
        </span>
        <Button primary disabled={running} onClick={() => setAnimation(startDefrag())}>
          Start
        </Button>
        <Button
          disabled={!running && animation.phase !== 'paused'}
          onClick={() =>
            setAnimation((state) => (state.phase === 'paused' ? resumeDefrag(state) : pauseDefrag(state)))
          }
        >
          {animation.phase === 'paused' ? 'Resume' : 'Pause'}
        </Button>
        <Button
          disabled={
            animation.phase === 'idle' || animation.phase === 'complete' || animation.phase === 'stopped'
          }
          onClick={() => setStopConfirm(true)}
        >
          Stop
        </Button>
      </div>
      <footer className="defrag-status sunken">
        estimated from the contracts' storage layout and each tx's calldata. monad's executor is the real
        source.
      </footer>

      {selectOpen && (
        <div className="modal-shade">
          <div className="defrag-select window" role="dialog" aria-label="Select Drive">
            <header className="titlebar">
              <strong>Select Drive</strong>
            </header>
            <p>Select the drive you want to defragment:</p>
            {(['C', 'D', 'E'] as const).map((id) => (
              <label key={id} className={drive === id ? 'selected' : ''}>
                <input type="radio" name="drive" checked={drive === id} onChange={() => setDrive(id)} />
                <Icon name="layers" size={26} colour={id === 'C' ? '#9F70DA' : '#5FEDDF'} />
                <span>
                  <b>
                    {id}: {driveTitle(id)}
                  </b>
                  <small>{drivePages(id, owners.current.length)} pages</small>
                </span>
              </label>
            ))}
            {detailsOpen && (
              <p className="defrag-select-details">
                C: 8 canvas pages + 16 region-state pages + 8 outline pages. D: the 32-frame ring, 16 slots
                per frame. E: one 128-slot aligned page per Block DNA owner box.
              </p>
            )}
            <div className="dialog-actions">
              <Button primary onClick={() => setSelectOpen(false)}>
                OK
              </Button>
              <Button onClick={() => closeWindow('defrag')}>Exit</Button>
              <Button disabled title="there is nothing to configure; the contracts already picked the layout">
                Settings…
              </Button>
              <Button onClick={() => setDetailsOpen((value) => !value)}>
                {detailsOpen ? 'Hide Details' : 'Show Details'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {legendOpen && (
        <MessageBox title="Legend" onClose={() => setLegendOpen(false)}>
          <div className="defrag-legend">
            <span>
              <i className="optimized" />
              optimized data (page-aligned)
            </span>
            <span>
              <i className="reading" />
              being read
            </span>
            <span>
              <i className="writing" />
              being written
            </span>
            <span>
              <i className="free" />
              free / never written
            </span>
            <span>
              <i className="frozen" />
              frozen core · data that will not be moved
            </span>
          </div>
        </MessageBox>
      )}
      {stopConfirm && (
        <MessageBox
          title="Disk Defragmenter"
          kind="warning"
          message="Are you sure?"
          defaultLabel="Stop"
          onDefault={() => setAnimation((state) => stopDefrag(state))}
          onCancel={() => undefined}
          onClose={() => setStopConfirm(false)}
        />
      )}
      {doneMessage && (
        <MessageBox title="Disk Defragmenter" message={doneMessage} onClose={() => setDoneMessage('')} />
      )}
    </div>
  )
}
