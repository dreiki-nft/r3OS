import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { isAddress, parseAbiItem, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { chainName } from '../chain/config'
import { getLogsWindow } from '../chain/logs'
import { cardPageBaseSlot, regionOf, useMonadCard } from '../chain/monadCard'
import { readHeavy, readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_CARD_MEMORY_ABI, R3TARDS_PAGE_EXE_ABI } from '../lib/generated/abi'
import { PALETTE } from '../lib/palette'
import { errorText, labAddress, shortAddress } from '../labs/labCommon'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import {
  BENCH_PATTERNS,
  bytesToWords,
  changedWordRange,
  decodeBenchWriteResult,
  extractRevertData,
  hexdumpRows,
  packPagePixels,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  summarizePageTraffic,
  unpackPagePixels,
  wordsToBytes,
  type BenchPattern,
  type PageTrafficSummary,
} from './page'
import './monadhw.css'

const NS = [1, 8, 32, 128] as const
const CARD_WRITTEN = parseAbiItem(
  'event CardWritten(uint256 indexed cardId, address indexed owner, uint256 wordOffset, uint32 writes, bytes32[] words)',
)
const RULES = [
  'MIP-8 groups 128 consecutive storage words into one 4 KiB page. the first read warms the page; the rest of that page stay warm for the transaction.',
  'the benchmark compares contiguous slots, one slot on many pages, and mapping-style hashed slots. write measurements deliberately revert, so they never persist benchmark state.',
  'wallet pages are writable here. CARD.DRV pages are read-only here and open in CARDMEM.EXE for programming.',
] as const

type Probe = { cold: bigint; warm: bigint; next: bigint; overhead: bigint }
type BenchRow = { mode: 'read' | 'write'; pattern: BenchPattern; n: number; gas: bigint }
type PageSource = 'wallet' | 'card'

function net(value: bigint, overhead: bigint) {
  return value > overhead ? value - overhead : value
}

function parseCardId(text: string) {
  try {
    const value = BigInt(text.trim())
    return value >= 0n ? value : undefined
  } catch {
    return undefined
  }
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
  const card = useMonadCard()
  const refreshTick = useRefreshTick(30)
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [probe, setProbe] = useState<Probe>()
  const [bench, setBench] = useState<BenchRow[]>([])
  const [benchBlock, setBenchBlock] = useState<bigint>()
  const [benchBusy, setBenchBusy] = useState(false)
  const [source, setSource] = useState<PageSource>('wallet')
  const [targetText, setTargetText] = useState('')
  const [target, setTarget] = useState<Address>()
  const [cardIdText, setCardIdText] = useState('')
  const [cardId, setCardId] = useState<bigint>()
  const [baseSlot, setBaseSlot] = useState<bigint>()
  const [pageIndex, setPageIndex] = useState<bigint>()
  const [cardReadCost, setCardReadCost] = useState<bigint>()
  const [traffic, setTraffic] = useState<PageTrafficSummary[]>([])
  const [trafficBusy, setTrafficBusy] = useState(false)
  const [trafficProgress, setTrafficProgress] = useState('')
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

  useEffect(() => {
    if (card.cardId != null && !cardIdText) {
      setCardId(card.cardId)
      setCardIdText(card.cardId.toString())
    }
  }, [card.cardId, cardIdText])

  const loadPage = useCallback(async () => {
    if (!address) return
    try {
      let words: Hex[]
      if (source === 'wallet') {
        if (!target) return
        const [meta, pageRows] = await Promise.all([
          readMany(
            [
              { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'pageBaseSlot', args: [target] },
              { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'pageIndexOf', args: [target] },
            ],
            { allowFailure: false },
          ),
          readHeavy([
            { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'readPage', args: [target] },
            { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'probePage' },
          ]),
        ])
        setBaseSlot(BigInt(meta[0] as bigint))
        setPageIndex(BigInt(meta[1] as bigint))
        setCardReadCost(undefined)
        if (pageRows[1]?.status !== 'success') throw pageRows[1]?.error ?? new Error('page probe failed')
        const p = pageRows[1].result as readonly bigint[]
        setProbe({ cold: BigInt(p[0]), warm: BigInt(p[1]), next: BigInt(p[2]), overhead: BigInt(p[3]) })
        if (pageRows[0]?.status !== 'success') throw pageRows[0]?.error ?? new Error('page read failed')
        words = [...(pageRows[0].result as readonly Hex[])]
      } else {
        if (!card.driverAddress || cardId == null) return
        const [meta, pageRows, costRows] = await Promise.all([
          readMany(
            [
              {
                address: card.driverAddress,
                abi: R3TARDS_CARD_MEMORY_ABI,
                functionName: 'pageBaseSlot',
                args: [cardId],
              },
              {
                address: card.driverAddress,
                abi: R3TARDS_CARD_MEMORY_ABI,
                functionName: 'pageIndexOf',
                args: [cardId],
              },
            ],
            { allowFailure: false },
          ),
          readHeavy([
            {
              address: card.driverAddress,
              abi: R3TARDS_CARD_MEMORY_ABI,
              functionName: 'readPage',
              args: [cardId],
            },
          ]),
          // readCost must be a cold, standalone eth_call. Never place it in multicall.
          readHeavy([
            {
              address: card.driverAddress,
              abi: R3TARDS_CARD_MEMORY_ABI,
              functionName: 'readCost',
              args: [cardId],
            },
          ]),
        ])
        setBaseSlot(BigInt(meta[0] as bigint))
        setPageIndex(BigInt(meta[1] as bigint))
        if (pageRows[0]?.status !== 'success') throw pageRows[0]?.error ?? new Error('card page read failed')
        words = [...(pageRows[0].result as readonly Hex[])]
        setCardReadCost(costRows[0]?.status === 'success' ? BigInt(costRows[0].result as bigint) : undefined)
      }

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
  }, [address, target, source, card.driverAddress, cardId])

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
  const editable = Boolean(
    source === 'wallet' && wallet.account && target && wallet.account.toLowerCase() === target.toLowerCase(),
  )

  useEffect(() => {
    setQuote(undefined)
    if (source !== 'wallet' || !address || !wallet.account || !editable || !range) return
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
  }, [source, address, wallet.account, editable, range])

  async function writePage() {
    if (source !== 'wallet' || !address || !wallet.account || !range || !quote) return
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

  async function scanTraffic() {
    if (!publicClient || !card.driverAddress) return
    const client = publicClient
    setTrafficBusy(true)
    setTrafficProgress('scanning…')
    setMessage('')
    try {
      const head = await client.getBlockNumber({ cacheTime: 0 })
      const fromBlock = head > 2_999n ? head - 2_999n : 0n
      const logs = await getLogsWindow({
        address: card.driverAddress,
        event: CARD_WRITTEN,
        fromBlock,
        toBlock: head,
        maxBlocks: 3_000,
        onProgress: (done, total) => setTrafficProgress(`${done}/${total} blocks`),
      })
      const sorted = [...logs].sort((a, b) =>
        BigInt(a.blockNumber ?? 0n) > BigInt(b.blockNumber ?? 0n) ? -1 : 1,
      )
      const hashes: Hex[] = []
      const seen = new Set<string>()
      for (const log of sorted) {
        const hash = log.transactionHash as Hex | undefined
        if (!hash || seen.has(hash.toLowerCase())) continue
        seen.add(hash.toLowerCase())
        hashes.push(hash)
        if (hashes.length >= 50) break
      }
      const receiptRows = await readHeavy(
        hashes.map((hash) => ({ run: () => client.getTransactionReceipt({ hash }) })),
        { concurrency: 2 },
      )
      const receipts = [] as Array<{ transactionHash: Hex; gasUsed: bigint; status: 'success' | 'reverted' }>
      receiptRows.forEach((row, index) => {
        if (row?.status !== 'success') return
        const receipt = row.result as { gasUsed: bigint; status: 'success' | 'reverted' }
        receipts.push({ transactionHash: hashes[index], gasUsed: receipt.gasUsed, status: receipt.status })
      })
      const items = logs
        .filter((log) => log.transactionHash && log.blockNumber != null)
        .map((log) => {
          const args = log.args as { cardId?: bigint; words?: readonly Hex[] }
          const id = BigInt(args.cardId ?? 0n)
          return {
            block: BigInt(log.blockNumber),
            txHash: log.transactionHash as Hex,
            page: cardPageBaseSlot(id) >> 7n,
            words: args.words?.length ?? 0,
          }
        })
      setTraffic(summarizePageTraffic(items, receipts))
      setTrafficProgress(`${logs.length} writes · ${Math.min(hashes.length, 50)} receipts`)
    } catch (error) {
      setTrafficProgress('')
      setMessage(errorText(error))
    } finally {
      setTrafficBusy(false)
    }
  }

  const maxBench = bench.reduce((max, row) => (row.gas > max ? row.gas : max), 1n)
  const rows = hexdumpRows(currentWords)
  const scattered128 = bench.find((row) => row.mode === 'read' && row.n === 128 && row.pattern === 1)

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
      <HardwareBus highlight={source === 'card' ? ['storage', 'card'] : ['storage']} />

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
          <div className="page-source-switch" role="group" aria-label="page source">
            <Button primary={source === 'wallet'} onClick={() => setSource('wallet')}>
              WALLET PAGE
            </Button>
            <Button primary={source === 'card'} onClick={() => setSource('card')}>
              CARD PAGE
            </Button>
          </div>

          {source === 'wallet' ? (
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
          ) : (
            <div className="hw-toolbar page-address-row">
              <label>
                card #
                <input value={cardIdText} onChange={(event) => setCardIdText(event.target.value)} />
              </label>
              <Button
                disabled={!card.driverAddress}
                onClick={() => {
                  const next = parseCardId(cardIdText)
                  if (next == null) {
                    setMessage('enter a valid card number')
                    return
                  }
                  setCardId(next)
                  setMessage('')
                }}
              >
                View card page
              </Button>
              <Button
                disabled={cardId == null}
                onClick={() => openProgram('card-mem', true, `#/card-mem?card=${cardId?.toString() ?? ''}`)}
              >
                OPEN IN CARDMEM.EXE
              </Button>
            </div>
          )}

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
                    onClick={() => source === 'wallet' && setColour(entry.index)}
                  />
                ))}
              </div>
              <div className="hw-toolbar">
                {source === 'wallet' ? (
                  <>
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
                  </>
                ) : (
                  <span>read-only · program this page in CARDMEM.EXE</span>
                )}
              </div>
            </div>

            <div className={`page-hexdump sunken ${source === 'card' ? 'card-page-hexdump' : ''}`}>
              {rows.map((row) => {
                const region = source === 'card' ? regionOf(row.offset * 32) : undefined
                return (
                  <div
                    key={row.offset}
                    className={
                      region ? `card-region-${region.toLowerCase().replaceAll(' ', '-')}` : undefined
                    }
                  >
                    <b>{row.offset.toString(16).padStart(2, '0')}</b>
                    <code>{row.hex}</code>
                    <span>{row.ascii}</span>
                    {region && <em>{region}</em>}
                  </div>
                )
              })}
            </div>
          </div>
        </GroupBox>

        {source === 'card' && (
          <>
            <GroupBox title="CARD READ">
              <div className="hw-stat-grid">
                <span>full 4 KiB read</span>
                <b>{cardReadCost == null ? '—' : `${cardReadCost.toString()} gas (1 page)`}</b>
                <span>128 scattered reads</span>
                <b>{scattered128 ? `${scattered128.gas.toString()} gas (128 pages)` : 'run benchmark'}</b>
              </div>
              <small>both values are measured. CARD.DRV readCost runs as its own cold eth_call.</small>
            </GroupBox>

            <GroupBox title="CARD TRAFFIC · PRIVATE PAGES">
              <div className="hw-toolbar">
                <Button disabled={trafficBusy || !card.driverAddress} onClick={() => void scanTraffic()}>
                  {trafficBusy ? 'Scanning…' : 'SCAN'}
                </Button>
                <span>{trafficProgress || 'last 3,000 blocks · receipts capped at 50'}</span>
              </div>
              <div className="card-traffic-table sunken">
                <div className="card-traffic-head">
                  <b>block</b>
                  <b>writes</b>
                  <b>pages</b>
                  <b>words</b>
                  <b>gas used</b>
                  <b>status</b>
                </div>
                {traffic.map((row) => (
                  <div key={row.block.toString()}>
                    <code>{row.block.toString()}</code>
                    <span>{row.writes}</span>
                    <span>{row.distinctPages}</span>
                    <span>{row.words}</span>
                    <span>{row.gasUsed.toString()}</span>
                    <span>{row.status}</span>
                  </div>
                ))}
                {!traffic.length && <p>no scan results yet.</p>}
              </div>
              <small>
                Monad RPC doesn't expose conflict or re-execution counts; this shows where writes landed.
              </small>
            </GroupBox>
          </>
        )}
        {message && <p className="hw-message">{message}</p>}
      </div>
    </div>
  )
}
