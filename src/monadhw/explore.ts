/**
 * Pure helpers behind Explore Monad's little experiments. Everything shown there is either read from the chain
 * on a button press or measured by this browser; these functions only shape those numbers for display.
 */

// ---------------------------------------------------------------------------
// Block speed
// ---------------------------------------------------------------------------

export interface BlockSample {
  block: bigint
  /** performance.now() when this browser saw the block */
  at: number
}

/** Keep the newest `max` distinct blocks, newest first. */
export function pushBlockSample(samples: readonly BlockSample[], next: BlockSample, max = 8): BlockSample[] {
  if (samples[0] && next.block <= samples[0].block) return [...samples]
  return [next, ...samples].slice(0, max)
}

/** Average ms per block across the samples this browser saw (needs two samples a block apart or more). */
export function observedBlockMs(samples: readonly BlockSample[]): number | undefined {
  if (samples.length < 2) return undefined
  const newest = samples[0]
  const oldest = samples[samples.length - 1]
  const blocks = Number(newest.block - oldest.block)
  const ms = newest.at - oldest.at
  if (blocks <= 0 || ms <= 0) return undefined
  return ms / blocks
}

/** A boot-screen measurement must cover at least this much time and this many blocks before it is shown. */
export const STEADY_SPAN_MS = 1_200
export const STEADY_SPAN_BLOCKS = 3

/**
 * Like observedBlockMs, but undefined until the samples span enough time and blocks to mean something. A phone
 * on mobile data often receives several headers in one burst; averaging two gaps from one burst printed
 * "0.18 s per block" on a chain that makes one every ~0.4 s.
 */
export function steadyBlockMs(samples: readonly BlockSample[]): number | undefined {
  if (samples.length < 2) return undefined
  const newest = samples[0]
  const oldest = samples[samples.length - 1]
  if (newest.at - oldest.at < STEADY_SPAN_MS) return undefined
  if (newest.block - oldest.block < BigInt(STEADY_SPAN_BLOCKS)) return undefined
  return observedBlockMs(samples)
}

export function formatBlockMs(ms?: number) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(2)} s` : `${Math.round(ms)} ms`
}

/** "+0.29 s" since the previous sample, or '' for the oldest line. */
export function sampleGap(samples: readonly BlockSample[], index: number) {
  const current = samples[index]
  const previous = samples[index + 1]
  if (!current || !previous) return ''
  return `+${((current.at - previous.at) / 1_000).toFixed(2)} s`
}

// ---------------------------------------------------------------------------
// Storage race (PAGE.EXE's benchRead, MIP-8 storage pages)
// ---------------------------------------------------------------------------

export const STORAGE_RACE_READS = 128

export interface StorageRaceResult {
  onePage: bigint
  scattered: bigint
  /** scattered / onePage, one decimal */
  ratio: number
  ratioText: string
  /** bar widths in percent of the larger value */
  onePagePct: number
  scatteredPct: number
  /** true when the measurement actually shows the page discount (≥ 2×) */
  pageEffect: boolean
}

export function netGas(gas: bigint, overhead: bigint) {
  return gas > overhead ? gas - overhead : gas
}

export function storageRace(onePage: bigint, scattered: bigint): StorageRaceResult | undefined {
  if (onePage <= 0n || scattered <= 0n) return undefined
  const ratio = Math.round((Number(scattered) / Number(onePage)) * 10) / 10
  const max = onePage > scattered ? onePage : scattered
  return {
    onePage,
    scattered,
    ratio,
    ratioText: `${ratio.toFixed(1)}×`,
    onePagePct: Math.max(2, (Number(onePage) / Number(max)) * 100),
    scatteredPct: Math.max(2, (Number(scattered) / Number(max)) * 100),
    pageEffect: ratio >= 2,
  }
}

// ---------------------------------------------------------------------------
// Liquidity race (ROUTER-LAB compare over MRC-17 adapters)
// ---------------------------------------------------------------------------

export interface QuoteReportLike {
  status: number
  amountOut: bigint
}

export interface LiquidityRow {
  name: string
  amountOut?: bigint
  /** percent of the highest quoted output; 0 for a market that gave no quote */
  pct: number
  highest: boolean
  /** "−0.31%" behind the highest quote; undefined for the top quote and for markets without a quote */
  behind?: string
  /** plain reason when there is no quote */
  note?: string
}

/** "poe-mon-usdc" → "POE". */
export function marketName(label: string) {
  return (label.split('-')[0] || label).toUpperCase()
}

const NO_QUOTE: Record<number, string> = {
  1: 'quoted zero',
  2: 'bad answer',
  3: 'bad answer',
  4: 'no quote',
  5: 'ran out of gas',
  6: 'not deployed',
  7: 'no quote',
}

/**
 * One row per market, best quote first, markets without a quote last. `winner` is the index the contract
 * picked (highest quoted output, ties to the lowest index); 2^256-1 means nobody quoted.
 */
export function liquidityRows(
  reports: readonly QuoteReportLike[],
  labels: readonly string[],
  winner: bigint,
): LiquidityRow[] {
  const top = reports.reduce(
    (max, report) => (report.status === 0 && report.amountOut > max ? report.amountOut : max),
    0n,
  )
  const rows = reports.map((report, index) => {
    const ok = report.status === 0 && report.amountOut > 0n
    return {
      name: marketName(labels[index] ?? `market ${index + 1}`),
      amountOut: ok ? report.amountOut : undefined,
      pct: ok && top > 0n ? Math.max(2, Number((report.amountOut * 10_000n) / top) / 100) : 0,
      highest: BigInt(index) === winner,
      behind:
        ok && top > 0n && report.amountOut < top
          ? `−${(Number(((top - report.amountOut) * 1_000_000n) / top) / 10_000).toFixed(2)}%`
          : undefined,
      note: ok ? undefined : (NO_QUOTE[report.status] ?? 'no quote'),
      index,
    }
  })
  rows.sort((a, b) => {
    if (a.amountOut == null && b.amountOut == null) return a.index - b.index
    if (a.amountOut == null) return 1
    if (b.amountOut == null) return -1
    return a.amountOut === b.amountOut ? a.index - b.index : a.amountOut > b.amountOut ? -1 : 1
  })
  return rows.map(({ index: _index, ...row }) => row)
}
