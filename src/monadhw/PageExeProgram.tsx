import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { isAddress, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { chainName } from '../chain/config'
import { readHeavy, readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_PAGE_EXE_ABI } from '../lib/generated/abi'
import { PALETTE } from '../lib/palette'
import { labAddress, errorText, shortAddress } from '../labs/labCommon'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import {
  BENCH_PATTERNS,
  bytesToWords,
  changedWordRange,
  extractRevertData,
  hexdumpRows,
  packPagePixels,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  unpackPagePixels,
  wordsToBytes,
  decodeBenchWriteResult,
  type BenchPattern,
} from './page'
import './monadhw.css'

const NS = [1, 8, 32, 128] as const
const RULES = [
  'MIP-8 groups 128 consecutive storage words into one 4 KiB page. the first read warms the page; the rest of that page stay warm for the transaction.',
  'the benchmark compares contiguous slots, one slot on many pages, and mapping-style hashed slots. write measurements deliberately revert, so they never persist benchmark state.',
  'your 4 KiB page is real contract storage. the editor sends only the minimal covering range of changed 32-byte words.',
] as const

type Probe = { cold: bigint; warm: bigint; next: bigint; overhead: bigint }
type BenchRow = { mode: 'read' | 'write'; pattern: BenchPattern; n: number; gas: bigint }

function net(value: bigint, overhead: bigint) {
  return value > overhead ? value - overhead : value
}

function PageCanvas({
  pixels,
  editable,
  colour,
  onPaint,
}: {
  pixels: Uint8Array
  editable: boolean
  colour: number
  onPaint: (x: number, y: number, colour: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const painting = useRef(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
    for (let y = 0; y < PAGE_HEIGHT; y++) {
      for (let x = 0; x < PAGE_WIDTH; x++) {
        ctx.fillStyle = PALETTE[pixels[y * PAGE_WIDTH + x] ?? 0]?.hex ?? '#000000'
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }, [pixels])

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!editable) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(
      0,
      Math.min(PAGE_WIDTH - 1, Math.floor(((event.clientX - rect.left) / rect.width) * PAGE_WIDTH)),
    )
    const y = Math.max(
      0,
      Math.min(PAGE_HEIGHT - 1, Math.floor(((event.clientY - rect.top) / rect.height) * PAGE_HEIGHT)),
    )
    onPaint(x, y, colour)
  }

  return (
    <canvas
      ref={ref}
      width={PAGE_WIDTH}
      height={PAGE_HEIGHT}
      className={`page-pixel-canvas ${editable ? 'editable' : ''}`}
      onPointerDown={(event) => {
        if (!editable) return
        painting.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        point(event)
      }}
      onPointerMove={(event) => painting.current && point(event)}
      onPointerUp={(event) => {
        painting.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        painting.current = false
      }}
    />
  )
}

export function PageExeProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const refreshTick = useRefreshTick(30)
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [probe, setProbe] = useState<Probe>()
  const [bench, setBench] = useState<BenchRow[]>([])
  const [benchBlock, setBenchBlock] = useState<bigint>()
  const [benchBusy, setBenchBusy] = useState(false)
  const [targetText, setTargetText] = useState('')
  const [target, setTarget] = useState<Address>()
  const [baseSlot, setBaseSlot] = useState<bigint>()
  const [pageIndex, setPageIndex] = useState<bigint>()
  const [originalWords, setOriginalWords] = useState<Hex[]>([])
  const originalRef = useRef<Hex[]>([])
  const [pixels, setPixels] = useState(new Uint8Array(PAGE_WIDTH * PAGE_HEIGHT))
  const [colour, setColour] = useState(1)
  const [quote, setQuote] = useState<ActionQuote>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void labAddress('page-exe')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  useEffect(() => {
    if (wallet.account && !targetText) {
      setTarget(wallet.account)
      setTargetText(wallet.account)
    }
  }, [wallet.account, targetText])

  const loadPage = useCallback(async () => {
    if (!address || !target) return
    try {
      const [meta, pageRows] = await Promise.all([
        readMany(
          [
            { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'pageBaseSlot', args: [target] },
            { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'pageIndexOf', args: [target] },
          ],
          { allowFailure: false },
        ),
        // Measurements run as their own eth_call: inside a multicall another call could warm the page first.
        readHeavy([
          { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'readPage', args: [target] },
          { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'probePage' },
        ]),
      ])
      setBaseSlot(BigInt(meta[0] as bigint))
      setPageIndex(BigInt(meta[1] as bigint))
      if (pageRows[1]?.status !== 'success') throw pageRows[1]?.error ?? new Error('page probe failed')
      const p = pageRows[1].result as readonly bigint[]
      setProbe({ cold: BigInt(p[0]), warm: BigInt(p[1]), next: BigInt(p[2]), overhead: BigInt(p[3]) })
      if (pageRows[0]?.status !== 'success') throw pageRows[0]?.error ?? new Error('page read failed')
      const words = [...(pageRows[0].result as readonly Hex[])]
      // Periodic refreshes must not wipe unsaved drawing: only replace the editor when the chain changed.
      const previous = originalRef.current
      const unchanged =
        previous.length === words.length && words.every((word, index) => word === previous[index])
      if (!unchanged) {
        originalRef.current = words
        setOriginalWords(words)
        setPixels(unpackPagePixels(wordsToBytes(words)))
      }
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, target])

  useEffect(() => {
    void loadPage()
  }, [loadPage, refreshTick])

  const runBenchmarks = useCallback(async () => {
    if (!address) return
    setBenchBusy(true)
    setMessage('')
    try {
      const calls = BENCH_PATTERNS.flatMap((pattern) =>
        NS.map((n) => ({
          address,
          abi: R3TARDS_PAGE_EXE_ABI,
          functionName: 'benchRead',
          args: [pattern.id, BigInt(n)],
        })),
      )
      const reads = await readHeavy(calls, { concurrency: 2 })
      const rows: BenchRow[] = []
      reads.forEach((row, index) => {
        if (row?.status !== 'success') return
        const pattern = BENCH_PATTERNS[Math.floor(index / NS.length)].id
        const n = NS[index % NS.length]
        const values = row.result as readonly bigint[]
        rows.push({ mode: 'read', pattern, n, gas: net(BigInt(values[0]), BigInt(values[1])) })
      })

      const writeCalls = BENCH_PATTERNS.flatMap((pattern) =>
        NS.map((n) => ({
          address,
          abi: R3TARDS_PAGE_EXE_ABI,
          functionName: 'benchWrite',
          args: [pattern.id, BigInt(n)],
        })),
      )
      const writes = await readHeavy(writeCalls, { concurrency: 2 })
      writes.forEach((row, index) => {
        if (row?.status !== 'failure') return
        const data = extractRevertData(row.error)
        if (!data) return
        const decoded = decodeBenchWriteResult(data, R3TARDS_PAGE_EXE_ABI)
        if (!decoded) return
        const pattern = BENCH_PATTERNS[Math.floor(index / NS.length)].id
        const n = NS[index % NS.length]
        rows.push({ mode: 'write', pattern, n, gas: net(decoded.gasUsed, decoded.overhead) })
      })
      setBench(rows)
      setBenchBlock(block.block)
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setBenchBusy(false)
    }
  }, [address, block.block])

  const currentWords = useMemo(() => bytesToWords(packPagePixels(pixels)), [pixels])
  const range = useMemo(() => changedWordRange(originalWords, currentWords), [originalWords, currentWords])
  const editable = Boolean(wallet.account && target && wallet.account.toLowerCase() === target.toLowerCase())

  useEffect(() => {
    setQuote(undefined)
    if (!address || !wallet.account || !editable || !range) return
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_PAGE_EXE_ABI,
      functionName: 'writePage',
      args: [BigInt(range.offset), range.words],
      account: wallet.account,
      action: 'write PAGE.EXE page',
    })
      .then((next) => !cancelled && setQuote(next))
      .catch((error) => {
        if (cancelled) return
        setQuote(undefined)
        setMessage(`cannot quote this write: ${errorText(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, editable, range])

  async function writePage() {
    if (!address || !wallet.account || !range || !quote) return
    setPending(true)
    setMessage('')
    try {
      await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_PAGE_EXE_ABI,
        functionName: 'writePage',
        args: [BigInt(range.offset), range.words],
        account: wallet.account,
        quote,
        action: 'write PAGE.EXE page',
        successSound: 'success-heavy',
      })
      setMessage(`wrote words ${range.offset}–${range.offset + range.words.length - 1}`)
      await loadPage()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  const maxBench = bench.reduce((max, row) => (row.gas > max ? row.gas : max), 1n)
  const rows = hexdumpRows(currentWords)

  if (missing) {
    return (
      <div className="monadhw-program">
        <p>PAGE.EXE is not deployed on this network.</p>
      </div>
    )
  }

  return (
    <div className="monadhw-program page-exe-program">
      <IntroBar
        lead="one real 4 KiB storage page, plus a MIP-8 microscope."
        monad="storage is charged by 128-slot pages: warm the page once, then inspect what that changes."
        rules={RULES}
      />
      <HardwareBus highlight={['storage']} />

      <div className="monadhw-scroll">
        <GroupBox title="Page probe">
          <div className="hw-stat-grid">
            <span>cold SLOAD</span>
            <b>{probe ? net(probe.cold, probe.overhead).toString() : '—'} gas</b>
            <span>warm same page</span>
            <b>{probe ? net(probe.warm, probe.overhead).toString() : '—'} gas</b>
            <span>next page cold</span>
            <b>{probe ? net(probe.next, probe.overhead).toString() : '—'} gas</b>
            <span>measurement overhead</span>
            <b>{probe?.overhead.toString() ?? '—'} gas</b>
          </div>
        </GroupBox>

        <GroupBox title="MIP-8 benchmark">
          <div className="hw-toolbar">
            <Button disabled={benchBusy || !address} onClick={() => void runBenchmarks()}>
              {benchBusy ? 'Measuring…' : 'Run benchmark'}
            </Button>
            <span>
              {benchBlock != null
                ? `measured in-EVM with gasleft() via eth_call on ${chainName} at block ${benchBlock}`
                : 'not measured yet'}
            </span>
          </div>
          <div className="bench-table">
            {(['read', 'write'] as const).map((mode) => (
              <section key={mode}>
                <h4>{mode === 'read' ? 'SLOAD' : 'fresh SSTORE (reverted after measurement)'}</h4>
                {NS.flatMap((n) =>
                  BENCH_PATTERNS.map((pattern) => {
                    const row = bench.find(
                      (item) => item.mode === mode && item.n === n && item.pattern === pattern.id,
                    )
                    const contiguous = bench.find(
                      (item) => item.mode === mode && item.n === n && item.pattern === 0,
                    )
                    const ratio =
                      row && contiguous && contiguous.gas > 0n
                        ? Number(row.gas) / Number(contiguous.gas)
                        : undefined
                    return (
                      <div className="bench-row" key={`${mode}-${n}-${pattern.id}`}>
                        <code>
                          {String(n).padStart(3)} · {pattern.label}
                        </code>
                        <div className="bench-bar-track">
                          <i
                            style={{
                              width: row ? `${Math.max(1, Number((row.gas * 100n) / maxBench))}%` : '0%',
                            }}
                          />
                        </div>
                        <b>{row?.gas.toString() ?? '—'}</b>
                        <span>{ratio == null ? '—' : `${ratio.toFixed(2)}×`}</span>
                      </div>
                    )
                  }),
                )}
              </section>
            ))}
          </div>
        </GroupBox>

        <GroupBox title="4 KiB page">
          <div className="hw-toolbar page-address-row">
            <label>
              wallet
              <input
                value={targetText}
                placeholder="0x…"
                onChange={(event) => setTargetText(event.target.value)}
              />
            </label>
            <Button
              onClick={() => {
                if (!isAddress(targetText)) {
                  setMessage('enter a valid wallet address')
                  return
                }
                setTarget(targetText as Address)
                setMessage('')
              }}
            >
              View page
            </Button>
            <span>{target ? shortAddress(target) : '—'}</span>
          </div>
          <div className="hw-stat-grid page-meta">
            <span>page index</span>
            <b>{pageIndex == null ? '—' : `0x${pageIndex.toString(16)}`}</b>
            <span>base slot</span>
            <code>{baseSlot == null ? '—' : `0x${baseSlot.toString(16).padStart(64, '0')}`}</code>
          </div>

          <div className="page-editor-layout">
            <div>
              <PageCanvas
                pixels={pixels}
                editable={editable}
                colour={colour}
                onPaint={(x, y, nextColour) => {
                  setPixels((current) => {
                    const next = current.slice()
                    next[y * PAGE_WIDTH + x] = nextColour
                    return next
                  })
                }}
              />
              <div className="page-palette" aria-label="page palette">
                {PALETTE.map((entry) => (
                  <button
                    key={entry.index}
                    className={colour === entry.index ? 'selected' : ''}
                    style={{ background: entry.hex }}
                    title={entry.name}
                    onClick={() => setColour(entry.index)}
                  />
                ))}
              </div>
              <div className="hw-toolbar">
                <Button
                  disabled={!editable || !range || !quote || pending}
                  primary
                  onClick={() => void writePage()}
                >
                  {pending ? 'Writing…' : 'Write page'}
                </Button>
                <span>
                  {!editable
                    ? 'read-only'
                    : range
                      ? `${range.words.length} word${range.words.length === 1 ? '' : 's'} · ${quote?.maxCost ?? 'quoting…'}`
                      : 'no changes'}
                </span>
              </div>
            </div>

            <div className="page-hexdump sunken">
              {rows.map((row) => (
                <div key={row.offset}>
                  <b>{row.offset.toString(16).padStart(2, '0')}</b>
                  <code>{row.hex}</code>
                  <span>{row.ascii}</span>
                </div>
              ))}
            </div>
          </div>
        </GroupBox>
        {message && <p className="hw-message">{message}</p>}
      </div>
    </div>
  )
}
