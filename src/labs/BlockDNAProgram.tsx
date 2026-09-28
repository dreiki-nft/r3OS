import './phase3c2a.css'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { bytesToHex, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { resolveHolderIds } from '../chain/holders'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_BRUSHES_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import {
  brushCell,
  brushColour,
  brushDistinctColours,
  brushFilledCells,
  brushFromBlockhash,
  brushRuns,
} from '../lib/brushes'
import { PALETTE } from '../lib/palette'
import { getLiveSnapshot, liveActive, subscribeLive } from '../live/liveStore'
import { getCanvasSnapshot, subscribeCanvas } from '../paint/canvasStore'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { errorText, labAddress } from './labCommon'
import { LabCanvas } from './LabCanvas'

const RULES = [
  'catch: save a brush from any of the last 256 blocks (~77 s) into one of your 8 slots. that is as far back as a contract can read block hashes.',
  "stamp: paint it onto the canvas with normal paint and your normal pixel budget. it can't sit under the face outline.",
  'verify: the contract checks the brush is still intact on the canvas and marks the slot ✓. do it right away, since anyone can paint over it and storms glitch pixels.',
  "one catch per block. a block can't be in your box twice, and catching over a verified slot clears its ✓.",
] as const

type BrushHeader = { block: bigint; hash: Hex; brush: bigint }
type BoxState = {
  brushes: bigint[]
  nextSlot: number
  verifiedMask: number
  catches: number
  verifiedTotal: number
  lastCatchBlock: bigint
}

const EMPTY_BOX: BoxState = {
  brushes: Array(8).fill(0n),
  nextSlot: 0,
  verifiedMask: 0,
  catches: 0,
  verifiedTotal: 0,
  lastCatchBlock: 0n,
}

function brushPixels(brush: bigint) {
  const pixels = new Uint8Array(64)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const slot = brushCell(brush, y, x)
      pixels[y * 8 + x] = slot ? brushColour(brush, slot as 1 | 2 | 3) : 0
    }
  }
  return pixels
}

function kind(brush: bigint) {
  const count = brushDistinctColours(brush)
  return count <= 1 ? 'mono' : count === 2 ? 'duo' : 'trio'
}

function conflict(brush: bigint, x: number, y: number, outline: Uint8Array) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (brushCell(brush, r, c) && outline[(y + r) * 256 + x + c]) return true
    }
  }
  return false
}

export function catchableAt(head: bigint, source: bigint) {
  return source < head && head - source <= 256n
}

export function BlockDNAProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const canvas = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const [address, setAddress] = useState<Address>()
  const [headers, setHeaders] = useState<BrushHeader[]>([])
  const [selectedBlock, setSelectedBlock] = useState<bigint>()
  const [box, setBox] = useState<BoxState>(EMPTY_BOX)
  const [slot, setSlot] = useState(0)
  const [x, setX] = useState(120)
  const [y, setY] = useState(40)
  const [holderIds, setHolderIds] = useState<bigint[]>([])
  const [catchQuote, setCatchQuote] = useState<ActionQuote>()
  const [paintQuote, setPaintQuote] = useState<ActionQuote>()
  const [verifyQuote, setVerifyQuote] = useState<ActionQuote>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void labAddress('brushes')
      .then(setAddress)
      .catch(() => setMessage("this Lab isn't deployed on this network"))
  }, [])

  useEffect(() => {
    if (!publicClient || block.block <= 1n) return
    let cancelled = false
    const source = block.block - 1n
    void publicClient
      .getBlock({ blockNumber: source, includeTransactions: false })
      .then((header) => {
        if (cancelled || !header.hash) return
        const next = { block: source, hash: header.hash, brush: brushFromBlockhash(header.hash, source) }
        setHeaders((current) => {
          const merged = [...current.filter((item) => item.block !== source), next]
            .sort((a, b) => (a.block < b.block ? -1 : 1))
            .slice(-16)
          return merged
        })
        setSelectedBlock((current) => current ?? source)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [block.block])

  useEffect(() => {
    const client = publicClient
    if (!client || headers.length || block.block < 18n) return
    let cancelled = false
    const starts = Array.from({ length: 16 }, (_, i) => block.block - BigInt(16 - i))
    void Promise.all(
      starts.map((number) =>
        client.getBlock({ blockNumber: number, includeTransactions: false }).catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return
      const next = rows.flatMap((row, index) =>
        row?.hash
          ? [{ block: starts[index], hash: row.hash, brush: brushFromBlockhash(row.hash, starts[index]) }]
          : [],
      )
      setHeaders(next)
      setSelectedBlock(next.at(-1)?.block)
    })
    return () => {
      cancelled = true
    }
  }, [block.block, headers.length])

  const refreshBox = useCallback(async () => {
    if (!publicClient || !address || !wallet.account) return setBox(EMPTY_BOX)
    try {
      const raw = (await publicClient.readContract({
        address,
        abi: R3TARDS_BRUSHES_ABI,
        functionName: 'box',
        args: [wallet.account],
      })) as any
      const next: BoxState = {
        brushes: Array.from(raw[0] as readonly bigint[], BigInt),
        nextSlot: Number(raw[1]),
        verifiedMask: Number(raw[2]),
        catches: Number(raw[3]),
        verifiedTotal: Number(raw[4]),
        lastCatchBlock: BigInt(raw[5]),
      }
      setBox(next)
      if (!next.brushes[slot]) setSlot(next.nextSlot)
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, wallet.account, slot])

  useEffect(() => {
    void refreshBox()
  }, [refreshBox, block.block])

  useEffect(() => {
    if (!publicClient || !wallet.account) return
    void discoverContracts().then(async (contracts) => {
      if (contracts.r3tards)
        setHolderIds(await resolveHolderIds(publicClient as never, contracts.r3tards, wallet.account!))
    })
  }, [wallet.account])

  const selected = headers.find((item) => item.block === selectedBlock) ?? headers.at(-1)
  const stampBrush = box.brushes[slot] || selected?.brush || 0n
  const filled = stampBrush ? brushFilledCells(stampBrush) : 0
  const blocked = stampBrush ? conflict(stampBrush, x, y, canvas.outline) : false
  const runs = useMemo(
    () => (stampBrush ? brushRuns(stampBrush, x, y) : new Uint8Array()),
    [stampBrush, x, y],
  )

  useEffect(() => {
    setCatchQuote(undefined)
    if (!address || !wallet.account || !selected || !catchableAt(block.block, selected.block)) return
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_BRUSHES_ABI,
      functionName: 'catchBrush',
      args: [selected.block],
      account: wallet.account,
      signer: liveActive(live) ? 'burner' : 'wallet',
      action: 'catch Block DNA brush',
    })
      .then(setCatchQuote)
      .catch(() => undefined)
  }, [address, wallet.account, selected?.block, block.block, live.version])

  useEffect(() => {
    setPaintQuote(undefined)
    setVerifyQuote(undefined)
    if (!wallet.account || !address || !stampBrush || blocked) return
    if (canvas.status !== 'demo') {
      void discoverContracts().then(({ paint }) => {
        if (!paint) return
        void quoteAction({
          kind: 'corePaint',
          address: paint,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'paint',
          args: [bytesToHex(runs), holderIds],
          account: wallet.account!,
          signer: liveActive(live) ? 'burner' : 'wallet',
          pixels: filled,
          action: 'stamp Block DNA brush',
        })
          .then(setPaintQuote)
          .catch(() => undefined)
      })
    }
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_BRUSHES_ABI,
      functionName: 'verify',
      args: [slot, x, y],
      account: wallet.account,
      signer: liveActive(live) ? 'burner' : 'wallet',
      action: `verify Block DNA slot ${slot + 1}`,
    })
      .then(setVerifyQuote)
      .catch(() => undefined)
  }, [
    address,
    wallet.account,
    stampBrush,
    slot,
    x,
    y,
    blocked,
    runs,
    filled,
    holderIds,
    live.version,
    canvas.status,
  ])

  async function transact(kindName: 'catch' | 'stamp' | 'verify') {
    if (!wallet.account || !address) return
    setBusy(true)
    setMessage('')
    try {
      if (kindName === 'catch' && selected && catchQuote) {
        await sendAction({
          kind: 'estimate',
          address,
          abi: R3TARDS_BRUSHES_ABI,
          functionName: 'catchBrush',
          args: [selected.block],
          account: wallet.account,
          signer: liveActive(live) ? 'burner' : 'wallet',
          quote: catchQuote,
          action: 'catch Block DNA brush',
          successSound: 'success-light',
        })
      } else if (kindName === 'stamp' && paintQuote) {
        const paint = (await discoverContracts()).paint
        if (!paint) throw new Error('core not deployed')
        await sendAction({
          kind: 'corePaint',
          address: paint,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'paint',
          args: [bytesToHex(runs), holderIds],
          account: wallet.account,
          signer: liveActive(live) ? 'burner' : 'wallet',
          pixels: filled,
          quote: paintQuote,
          action: 'stamp Block DNA brush',
        })
      } else if (kindName === 'verify' && verifyQuote) {
        await sendAction({
          kind: 'estimate',
          address,
          abi: R3TARDS_BRUSHES_ABI,
          functionName: 'verify',
          args: [slot, x, y],
          account: wallet.account,
          signer: liveActive(live) ? 'burner' : 'wallet',
          quote: verifyQuote,
          action: `verify Block DNA slot ${slot + 1}`,
          successSound: 'success-heavy',
        })
      }
      await refreshBox()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const menus = [
    { label: 'File', items: [{ label: 'Close', action: () => closeWindow('brushes') }] },
    { label: 'View', items: [{ label: 'Refresh box', action: refreshBox }] },
    { label: 'Brush', items: [{ label: 'Verify selected slot', action: () => void transact('verify') }] },
    { label: 'Help', items: [{ label: 'How it works', disabled: true }] },
  ]

  return (
    <div className="lab-program block-dna-program">
      <MenuBar menus={menus} />
      <IntroBar
        lead="every Monad block's hash generates a unique pixel brush. catch one while it's fresh, stamp it on the canvas, then verify it to keep it."
        monad="a new block every 0.3 s means a new brush about 3 times a second, each derived onchain from its block hash."
        rules={RULES}
        finalLine="3 verified brushes earn the BLOCK DNA stamp on your Pass."
      />
      <div className="dna-body">
        <GroupBox title="New brushes · one per block">
          <div className="dna-strip">
            {headers.map((entry, index) => (
              <button
                key={String(entry.block)}
                className={selected?.block === entry.block ? 'selected' : ''}
                onClick={() => setSelectedBlock(entry.block)}
              >
                <LabCanvas size={8} pixels={brushPixels(entry.brush)} zoom={5.5} />
                <small>…{String(entry.block).slice(-6)}</small>
                <small>
                  {kind(entry.brush)} · {brushFilledCells(entry.brush)}
                </small>
                {index === headers.length - 1 && <i className="dna-live-dot" />}
              </button>
            ))}
          </div>
          <div className="dna-strip-meta">
            <span>
              oldest shown · catchable for ~
              {headers[0] ? Math.max(0, Number(256n - (block.block - headers[0].block))) : 0} blocks more
            </span>
            <span>newest · block {headers.at(-1)?.block.toString() ?? '—'}</span>
          </div>
        </GroupBox>
        <div className="dna-columns">
          <GroupBox title={`Brush ${selected?.block.toString() ?? '—'}`}>
            <div className="dna-selected">
              {selected && <LabCanvas size={8} pixels={brushPixels(selected.brush)} zoom={24} />}
              <dl className="lab-dl">
                <dt>block</dt>
                <dd>{selected?.block.toString() ?? '—'}</dd>
                <dt>shape</dt>
                <dd>
                  {selected ? `${kind(selected.brush)} · ${brushFilledCells(selected.brush)} cells` : '—'}
                </dd>
                <dt>colours</dt>
                <dd>
                  {selected
                    ? [1, 2, 3]
                        .map((s) => brushColour(selected.brush, s as 1 | 2 | 3))
                        .map((c) => PALETTE[c]?.name)
                        .join(' · ')
                    : '—'}
                </dd>
                <dt>time left</dt>
                <dd>
                  {selected ? `${Math.max(0, Number(256n - (block.block - selected.block)))} blocks` : '—'}
                </dd>
              </dl>
              <Button
                primary
                disabled={busy || !catchQuote}
                title={
                  box.verifiedMask & (1 << box.nextSlot) ? 'catching here clears this slot ✓' : undefined
                }
                onClick={() => void transact('catch')}
              >
                Catch into slot {box.nextSlot + 1}
              </Button>
              <small>{catchQuote?.maxCost ?? 'select a catchable brush'}</small>
            </div>
          </GroupBox>
          <GroupBox title="Your box">
            <div className="dna-box">
              {box.brushes.map((brush, index) => (
                <button
                  key={index}
                  className={slot === index ? 'selected' : ''}
                  onClick={() => setSlot(index)}
                >
                  {brush ? (
                    <LabCanvas size={8} pixels={brushPixels(brush)} zoom={7} />
                  ) : (
                    <span className="dna-empty">empty</span>
                  )}
                  <small>
                    slot {index + 1} {box.verifiedMask & (1 << index) ? '✓' : ''}
                  </small>
                </button>
              ))}
            </div>
            <p>verified {box.verifiedTotal} / 3 → BLOCK DNA stamp on your Pass</p>
          </GroupBox>
          <GroupBox title="Stamp and verify">
            <div className="dna-stamp">
              <div
                className="dna-canvas-preview sunken"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setX(
                    Math.max(
                      0,
                      Math.min(248, Math.floor(((event.clientX - rect.left) / rect.width) * 256) - 4),
                    ),
                  )
                  setY(
                    Math.max(
                      0,
                      Math.min(248, Math.floor(((event.clientY - rect.top) / rect.height) * 256) - 4),
                    ),
                  )
                }}
              >
                <LabCanvas size={256} pixels={canvas.background} zoom={1.125} />
                <div className="dna-stamp-overlay" style={{ left: x * 1.125, top: y * 1.125 }}>
                  {stampBrush ? <LabCanvas size={8} pixels={brushPixels(stampBrush)} zoom={1.125} /> : null}
                </div>
              </div>
              <div className="dna-stamp-actions">
                <p>
                  {blocked
                    ? 'that spot crosses the protected face outline.'
                    : `${filled} pixels · (${x}, ${y})`}
                </p>
                <small>anyone can paint over this stamp before you verify it.</small>
                <Button
                  primary
                  disabled={busy || blocked || !paintQuote}
                  onClick={() => void transact('stamp')}
                >
                  Stamp on canvas
                </Button>
                <small>{paintQuote?.maxCost ?? (blocked ? 'pick another spot' : 'quoting…')}</small>
                <Button
                  disabled={busy || blocked || !verifyQuote || !box.brushes[slot]}
                  onClick={() => void transact('verify')}
                >
                  Verify slot {slot + 1}
                </Button>
                <small>{verifyQuote?.maxCost ?? 'stamp first, then verify quickly'}</small>
              </div>
            </div>
          </GroupBox>
        </div>
      </div>
      <footer className="lab-status">
        <span>{message || 'catch → stamp → verify'}</span>
        <span>box {box.brushes.filter(Boolean).length} / 8</span>
        <span>#{block.block.toString()}</span>
      </footer>
    </div>
  )
}
