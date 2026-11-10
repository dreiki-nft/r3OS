import { describe, expect, it, vi } from 'vitest'
import type { TxTrace } from '../chain/txTrace'
import { hourlyBudget, landedPaint, statsFrom, strokeNotice, type StrokeStats } from './firstStroke'

const stats = (over: Partial<StrokeStats> = {}): StrokeStats => ({
  activeDays: 0,
  pixelsToday: 5,
  firstPaintBlock: 100n,
  paintCount: 1,
  ...over,
})

describe('past the first stroke', () => {
  it('reads the painterStats fields it needs', () => {
    expect(statsFrom([3n, 20n, 900n, 1n, 100n, 200n, 7n, 0n])).toEqual({
      activeDays: 3,
      pixelsToday: 20,
      firstPaintBlock: 100n,
      paintCount: 7,
    })
    expect(statsFrom([])).toBeUndefined()
  })

  it('grows the hourly budget 32 per active day up to 2,048, like the contract', () => {
    expect(hourlyBudget(0)).toBe(512)
    expect(hourlyBudget(1)).toBe(544)
    expect(hourlyBudget(48)).toBe(2_048)
    expect(hourlyBudget(200)).toBe(2_048)
  })

  it('celebrates the first paint ever and says what reaching 16 px today earns', () => {
    const notice = strokeNotice(stats(), { blocks: [100n], firstDone: false, creditedToday: false })
    expect(notice?.kind).toBe('first')
    expect(notice?.body).toContain('block #100')
    expect(notice?.body).toContain('paint 11 more px today')
  })

  it('a big first stroke already earned the day: says the new budget instead', () => {
    const notice = strokeNotice(stats({ pixelsToday: 300, activeDays: 1 }), {
      blocks: [100n],
      firstDone: false,
      creditedToday: false,
    })
    expect(notice?.kind).toBe('first')
    expect(notice?.body).toContain('your budget is 544 px an hour')
  })

  it('stays quiet for a later paint of an old wallet, until today counts', () => {
    const old = stats({ firstPaintBlock: 5n, paintCount: 40, activeDays: 9 })
    expect(strokeNotice(old, { blocks: [100n], firstDone: false, creditedToday: false })).toBeUndefined()
    const credit = strokeNotice(
      { ...old, pixelsToday: 16, activeDays: 10 },
      { blocks: [100n], firstDone: true, creditedToday: false },
    )
    expect(credit).toMatchObject({ kind: 'credit', title: 'Today counts' })
    expect(credit?.body).toContain('active day 10: your budget is now 832 px an hour')
    expect(
      strokeNotice({ ...old, pixelsToday: 16 }, { blocks: [100n], firstDone: true, creditedToday: true }),
    ).toBeUndefined()
  })

  it('says when the budget is already at the max', () => {
    const notice = strokeNotice(stats({ firstPaintBlock: 5n, pixelsToday: 40, activeDays: 60 }), {
      blocks: [100n],
      firstDone: true,
      creditedToday: false,
    })
    expect(notice?.body).toContain("that's the 2,048 max")
  })

  it('counts only paints that landed and did not revert, from any signer', () => {
    const trace = (action: string, over: Partial<TxTrace> = {}): TxTrace => ({
      hash: '0x01',
      action,
      signer: 'burner',
      regions: [],
      gasLimit: 1n,
      maxFeePerGas: 1n,
      t: { sent: 0 },
      blockNumber: 5n,
      ...over,
    })
    expect(landedPaint(trace('paint 12 px'))).toBe(true)
    expect(landedPaint(trace('paint 9 px and save frame', { signer: 'wallet' }))).toBe(true)
    expect(landedPaint(trace('paint 12 px', { blockNumber: undefined }))).toBe(false)
    expect(landedPaint(trace('paint 12 px', { receiptStatus: 'reverted' }))).toBe(false)
    expect(landedPaint(trace('mintFrame'))).toBe(false)
  })
})

describe('first stroke watcher', () => {
  it('shows the first notice once per wallet, after its first paint lands', async () => {
    vi.resetModules()
    const raw = [0n, 5n, 5n, 0n, 101n, 101n, 2n]
    vi.doMock('../chain/painterProfile', () => ({
      invalidatePainterProfile: () => undefined,
      readPainterProfile: async () => ({ stats: raw, holder: false }),
    }))
    vi.doMock('../chain/wallet', () => ({
      getWalletSnapshot: () => ({ account: '0x00000000000000000000000000000000000000a1' }),
    }))
    const pushed: { title: string }[] = []
    vi.doMock('../os/balloons', () => ({ pushBalloon: (notice: { title: string }) => pushed.push(notice) }))
    vi.doMock('../os/programs', () => ({ openProgram: () => undefined }))
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    const traces = await import('../chain/txTrace')
    const watcher = await import('./firstStroke')
    watcher.initFirstStroke()
    const landed = (hash: string, block: bigint) =>
      traces.recordTxTrace({
        hash: hash as `0x${string}`,
        action: 'paint 5 px',
        signer: 'burner',
        regions: [],
        gasLimit: 1n,
        maxFeePerGas: 1n,
        t: { sent: 0 },
        blockNumber: block,
        receiptStatus: 'success',
      })
    // The wallet's first paint ever lands in block 101; the next ones say nothing more.
    landed('0x01', 101n)
    await vi.waitFor(() => expect(pushed.map((n) => n.title)).toEqual(['Your first pixels are onchain']))
    landed('0x02', 102n)
    landed('0x03', 103n)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pushed).toHaveLength(1)
    expect(store.get('r3os.firstStroke.0x00000000000000000000000000000000000000a1')).toBe('1')
    watcher.__resetFirstStrokeForTests()
    vi.unstubAllGlobals()
    vi.doUnmock('../chain/painterProfile')
    vi.doUnmock('../chain/wallet')
    vi.doUnmock('../os/balloons')
    vi.doUnmock('../os/programs')
  })
})
