import './phase3c2a.css'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { formatEther, parseEther, type Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { readMany } from '../chain/readMany'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_FINALE_AUCTION_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { HISTORY_STORAGE_ADDRESS, auctionSettleWindow, winnerAt, type AuctionBid } from '../lib/auction'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { PixelPreview } from '../frames/PixelPreview'
import { getFrameImage } from '../frames/frameImage'
import type { PixelImage } from '../frames/frameImage'
import { errorText, labAddress, sameAddress, shortAddress } from './labCommon'
import { useRefreshTick } from '../chain/refreshTick'

const RULES = [
  'bid by depositing MON. your bid is your total deposit, and a new high has to beat the last one by 5%.',
  "the last 12,000 blocks (~1 h) are the candle. after close, the close block's hash picks the real end somewhere inside it.",
  'settle while the close hash is still available. if it expires, the contract safely falls back to the candle start.',
  "whoever was highest at that block wins. bids after it are refunded, so sniping in the last second doesn't help.",
  'no admin: anyone can settle once bidding closes. the seller is paid, 5% royalty goes to the collection, and losing bidders withdraw their deposits.',
] as const

type Info = {
  seller: Address
  tokenId: bigint
  reserve: bigint
  startBlock: bigint
  closeBlock: bigint
  candleStartBlock: bigint
  state: number
  highest: bigint
  bidCount: number
  endBlock: bigint
  winner: Address
  price: bigint
  royalty: bigint
  usedFallback: boolean
}

function normalizeInfo(raw: any): Info {
  return {
    seller: raw.seller ?? raw[0],
    tokenId: BigInt(raw.tokenId ?? raw[1]),
    reserve: BigInt(raw.reserve ?? raw[2]),
    startBlock: BigInt(raw.startBlock ?? raw[3]),
    closeBlock: BigInt(raw.closeBlock ?? raw[4]),
    candleStartBlock: BigInt(raw.candleStartBlock ?? raw[5]),
    state: Number(raw.state ?? raw[6]),
    highest: BigInt(raw.highest ?? raw[7]),
    bidCount: Number(raw.bidCount ?? raw[8]),
    endBlock: BigInt(raw.endBlock ?? raw[9]),
    winner: raw.winner ?? raw[10],
    price: BigInt(raw.price ?? raw[11]),
    royalty: BigInt(raw.royalty ?? raw[12]),
    usedFallback: Boolean(raw.usedFallback ?? raw[13]),
  }
}

export function roughDuration(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds < 90) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  return minutes < 90 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`
}

export function auctionBarPosition(block: bigint, start: bigint, close: bigint) {
  if (close <= start) return 0
  const clamped = block < start ? start : block > close ? close : block
  return Number(((clamped - start) * 10_000n) / (close - start)) / 100
}

export function auctionActions(info: Info | undefined, head: bigint, deposit: bigint, credits: bigint) {
  return {
    settle: Boolean(info && info.state === 1 && head > info.closeBlock),
    withdrawBid: Boolean(info && info.state === 2 && deposit > 0n),
    withdrawProceeds: credits > 0n,
  }
}

function routeNumber(name: string) {
  return BigInt(new URLSearchParams(location.hash.split('?')[1] ?? '').get(name) || 0)
}

export function AuctionProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const refreshTick = useRefreshTick()
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [address, setAddress] = useState<Address>()
  const [auctionId, setAuctionId] = useState<bigint>(routeNumber('auction'))
  const [sellerToken, setSellerToken] = useState<bigint>(routeNumber('token'))

  // Run… `auction <id>` (or a link) can change `#/auction?auction=<id>` while the window is already open.
  useEffect(() => {
    const route = () => {
      if (!location.hash.startsWith('#/auction')) return
      const next = routeNumber('auction')
      if (next > 0n) setAuctionId(next)
    }
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])
  const [info, setInfo] = useState<Info>()
  const [bids, setBids] = useState<AuctionBid[]>([])
  const [minBid, setMinBid] = useState(0n)
  const [deposit, setDeposit] = useState(0n)
  const [credits, setCredits] = useState(0n)
  const [knownEnd, setKnownEnd] = useState(false)
  const [previewEnd, setPreviewEnd] = useState(0n)
  const [image, setImage] = useState<PixelImage>()
  const [topup, setTopup] = useState('0')
  const [reserve, setReserve] = useState('50')
  const [quote, setQuote] = useState<ActionQuote>()
  const [listQuote, setListQuote] = useState<ActionQuote>()
  const [approveQuote, setApproveQuote] = useState<ActionQuote>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [historyAvailable, setHistoryAvailable] = useState(false)
  const [autoSettle, setAutoSettle] = useState(false)
  const bidCountRef = useRef(0)
  const autoSettledRef = useRef(new Set<string>())

  useEffect(() => {
    void labAddress('finale auction')
      .then(setAddress)
      .catch(() => setMessage("this Lab isn't deployed on this network"))
  }, [])

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    void publicClient
      .getCode({ address: HISTORY_STORAGE_ADDRESS })
      .then((code) => !cancelled && setHistoryAvailable(Boolean(code && code !== '0x')))
      .catch(() => !cancelled && setHistoryAvailable(false))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    bidCountRef.current = 0
    setBids([])
    if (!auctionId) return setAutoSettle(false)
    try {
      setAutoSettle(localStorage.getItem(`r3os.auction.autosettle.${auctionId}`) === '1')
    } catch {
      setAutoSettle(false)
    }
  }, [auctionId])

  const refresh = useCallback(async () => {
    if (!publicClient || !address) return
    try {
      let id = auctionId
      if (!id) {
        id = BigInt(
          await publicClient.readContract({
            address,
            abi: R3TARDS_FINALE_AUCTION_ABI,
            functionName: 'auctionCount',
          }),
        )
        setAuctionId(id)
      }
      if (!id) return
      const baseCalls: any[] = [
        { address, abi: R3TARDS_FINALE_AUCTION_ABI, functionName: 'auctionInfo', args: [id] },
        { address, abi: R3TARDS_FINALE_AUCTION_ABI, functionName: 'minNextBid', args: [id] },
        { address, abi: R3TARDS_FINALE_AUCTION_ABI, functionName: 'previewEndBlock', args: [id] },
      ]
      if (wallet.account) {
        baseCalls.push(
          { address, abi: R3TARDS_FINALE_AUCTION_ABI, functionName: 'depositOf', args: [id, wallet.account] },
          { address, abi: R3TARDS_FINALE_AUCTION_ABI, functionName: 'credits', args: [wallet.account] },
        )
      }
      const values = (await readMany(baseCalls, { allowFailure: false })) as any[]
      const next = normalizeInfo(values[0])
      setInfo(next)
      setMinBid(BigInt(values[1]))
      setTopup(formatEther(BigInt(values[1]) - (wallet.account ? BigInt(values[3] ?? 0) : 0n)))
      const end = values[2] as any
      setKnownEnd(Boolean(end[0]))
      setPreviewEnd(BigInt(end[1]))
      if (wallet.account) {
        setDeposit(BigInt(values[3]))
        setCredits(BigInt(values[4]))
      }
      if (next.bidCount < bidCountRef.current) {
        bidCountRef.current = 0
        setBids([])
      }
      if (next.bidCount > bidCountRef.current) {
        const start = bidCountRef.current
        const bidCalls = Array.from({ length: next.bidCount - start }, (_, offset) => ({
          address,
          abi: R3TARDS_FINALE_AUCTION_ABI,
          functionName: 'bidAt',
          args: [id, BigInt(start + offset)],
        }))
        const bidRows = (await readMany(bidCalls, { allowFailure: false })) as any[]
        const appended = bidRows.map((row) => ({
          bidder: row[0] as Address,
          blockNumber: BigInt(row[1]),
          total: BigInt(row[2]),
        }))
        setBids((current) => [...current.slice(0, start), ...appended])
        bidCountRef.current = next.bidCount
      }
      setImage(await getFrameImage(Number(next.tokenId)))
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, auctionId, wallet.account])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshTick])

  const actions = auctionActions(info, block.block, deposit, credits)
  const settleWindow = info ? auctionSettleWindow(info.closeBlock, block.block, historyAvailable) : undefined
  useEffect(() => {
    if (!info || !address || !wallet.account || !autoSettle || info.state !== 1) return
    if (block.block <= info.closeBlock) return
    const key = `${auctionId}`
    if (autoSettledRef.current.has(key)) return
    autoSettledRef.current.add(key)
    void send('settle', [auctionId])
  }, [info, address, wallet.account, autoSettle, block.block, auctionId])

  const winning = useMemo(
    () => (info && knownEnd ? winnerAt(bids, previewEnd) : null),
    [info, knownEnd, bids, previewEnd],
  )

  useEffect(() => {
    setQuote(undefined)
    if (!address || !wallet.account || !info || info.state !== 1) return
    let value = 0n
    try {
      value = parseEther(topup || '0')
    } catch {
      return
    }
    if (value <= 0n || deposit + value < minBid) return
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_FINALE_AUCTION_ABI,
      functionName: 'bid',
      args: [auctionId],
      account: wallet.account,
      value,
      action: 'place auction bid',
    })
      .then(setQuote)
      .catch(() => undefined)
  }, [address, wallet.account, info?.state, topup, deposit, minBid, auctionId])

  useEffect(() => {
    setApproveQuote(undefined)
    setListQuote(undefined)
    if (!address || !wallet.account || !sellerToken || !config.paintAddress) return
    let reserveWei: bigint
    try {
      reserveWei = parseEther(reserve || '0')
    } catch {
      return
    }
    if (reserveWei <= 0n) return
    void quoteAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'approve',
      args: [address, sellerToken],
      account: wallet.account,
      action: 'approve finale auction',
    })
      .then(setApproveQuote)
      .catch(() => undefined)
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_FINALE_AUCTION_ABI,
      functionName: 'list',
      args: [sellerToken, reserveWei, 0],
      account: wallet.account,
      action: 'list finale',
    })
      .then(setListQuote)
      .catch(() => undefined)
  }, [address, wallet.account, sellerToken, reserve])

  async function send(
    functionName: string,
    args: readonly unknown[] = [],
    actionQuote?: ActionQuote,
    value?: bigint,
  ) {
    if (!address || !wallet.account) return
    const q =
      actionQuote ??
      (await quoteAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FINALE_AUCTION_ABI,
        functionName,
        args,
        account: wallet.account,
        value,
        action: functionName,
      }))
    setPending(true)
    try {
      await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FINALE_AUCTION_ABI,
        functionName,
        args,
        account: wallet.account,
        value,
        quote: q,
        action: functionName,
        successSound: functionName === 'settle' ? 'success-heavy' : 'success-light',
      })
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function approve() {
    if (!wallet.account || !address || !config.paintAddress || !approveQuote) return
    setPending(true)
    try {
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'approve',
        args: [address, sellerToken],
        account: wallet.account,
        quote: approveQuote,
        action: 'approve finale auction',
      })
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function list() {
    if (!listQuote) return
    const reserveWei = parseEther(reserve)
    await send('list', [sellerToken, reserveWei, 0], listQuote)
    setSellerToken(0n)
  }

  const nowPct = info ? auctionBarPosition(block.block, info.startBlock, info.closeBlock) : 0
  const candlePct = info ? auctionBarPosition(info.candleStartBlock, info.startBlock, info.closeBlock) : 0
  const endPct = info && knownEnd ? auctionBarPosition(previewEnd, info.startBlock, info.closeBlock) : 0

  return (
    <div className="lab-program auction-program">
      <MenuBar
        menus={[
          { label: 'File', items: [{ label: 'Close', action: () => closeWindow('auction') }] },
          { label: 'View', items: [{ label: 'Refresh', action: refresh }] },
          {
            label: 'Auction',
            items: [
              { label: 'Settle', disabled: !actions.settle, action: () => void send('settle', [auctionId]) },
            ],
          },
          { label: 'Help', items: [{ label: 'How it works', disabled: true }] },
        ]}
      />
      <IntroBar
        lead="each season's final canvas goes to a candle auction: ~24 h of bidding, and the real end is a random block in the last hour."
        monad="the end is picked from the close block's hash, and with 0.3 s blocks every bid's timing is exact."
        rules={RULES}
        finalLine="placing any bid completes the PADDLE UP quest."
      />
      <div className="auction-main">
        <aside className="auction-finale">
          <div className="sunken auction-preview">
            <PixelPreview image={image} size={320} />
          </div>
          <h3>{info ? `season finale · token #${info.tokenId}` : 'season finale'}</h3>
          {info && (
            <dl className="lab-dl">
              <dt>seller</dt>
              <dd>{shortAddress(info.seller)}</dd>
              <dt>royalty</dt>
              <dd>5% to the collection</dd>
              <dt>admin</dt>
              <dd>none. anyone can settle.</dd>
            </dl>
          )}
          {sellerToken > 0n && (
            <GroupBox title={`Auction finale #${sellerToken}`}>
              <label>
                Reserve <input value={reserve} onChange={(e) => setReserve(e.target.value)} /> MON
              </label>
              <div className="lab-action-row">
                <Button disabled={pending || !approveQuote} onClick={approve}>
                  Approve
                </Button>
                <Button primary disabled={pending || !listQuote} onClick={list}>
                  List now
                </Button>
              </div>
              <small>
                approval {approveQuote?.maxCost ?? 'quoting…'} · list {listQuote?.maxCost ?? 'quoting…'}
              </small>
            </GroupBox>
          )}
        </aside>
        <section className="auction-content">
          {info ? (
            <>
              <div className="auction-facts">
                <div className="sunken">
                  <small>reserve</small>
                  <b>{formatEther(info.reserve)} MON</b>
                </div>
                <div className="sunken">
                  <small>{info.state === 2 ? 'winning bid' : 'standing high'}</small>
                  <b>{formatEther(info.state === 2 ? info.price : info.highest)} MON</b>
                  <small>{winning ? shortAddress(winning.bidder) : '—'}</small>
                </div>
                <div className="sunken">
                  <small>next minimum</small>
                  <b>{formatEther(minBid)} MON</b>
                </div>
                <div className="sunken">
                  <small>your deposit</small>
                  <b>{formatEther(deposit)} MON</b>
                </div>
              </div>
              <GroupBox title="Bidding period · 288,000 blocks (about 24 h)">
                <div className="auction-track">
                  <i style={{ width: `${nowPct}%` }} />
                  <span className="candle" style={{ left: `${candlePct}%`, width: `${100 - candlePct}%` }} />
                  {knownEnd && <b className="drawn" style={{ left: `${endPct}%` }} />}
                </div>
                <div className="auction-track-labels">
                  <span>start {info.startBlock.toString()}</span>
                  <span>close {info.closeBlock.toString()}</span>
                </div>
                <small>
                  {knownEnd
                    ? `drawn end · ${previewEnd}${info.usedFallback ? ' · candle-start fallback' : ''}`
                    : block.block >= info.candleStartBlock
                      ? 'the real end is somewhere in the final-hour candle'
                      : `candle starts ${info.candleStartBlock}`}
                </small>
              </GroupBox>
              {info.state === 1 && settleWindow && (
                <div className="auction-settle-note sunken">
                  <div>
                    <b>
                      {settleWindow.state === 'burning'
                        ? 'candle burning'
                        : settleWindow.state === 'random'
                          ? `settle now: the random end is available for ${settleWindow.blocksLeft.toString()} more blocks (~${roughDuration(Number(settleWindow.blocksLeft) * block.blockTimeMs)})`
                          : `the random end expired: settling now uses the candle start (block ${settleWindow.fallbackEnd.toString()}) as the end`}
                    </b>
                  </div>
                  {wallet.account && block.block <= settleWindow.randomUntil && (
                    <div>
                      <label>
                        <input
                          type="checkbox"
                          checked={autoSettle}
                          onChange={(event) => {
                            const checked = event.target.checked
                            setAutoSettle(checked)
                            try {
                              localStorage.setItem(
                                `r3os.auction.autosettle.${auctionId}`,
                                checked ? '1' : '0',
                              )
                            } catch {
                              // The preference simply becomes session-only when storage is unavailable.
                            }
                          }}
                        />{' '}
                        Settle for me when bidding closes
                      </label>
                    </div>
                  )}
                </div>
              )}
              {info.state === 1 && (
                <div className="auction-bid-row">
                  <label>
                    Top up by <input value={topup} onChange={(e) => setTopup(e.target.value)} /> MON
                  </label>
                  <span>
                    → your bid becomes{' '}
                    <b>
                      {(() => {
                        try {
                          return `${formatEther(deposit + parseEther(topup || '0'))} MON`
                        } catch {
                          return '—'
                        }
                      })()}
                    </b>
                  </span>
                  <Button
                    primary
                    disabled={pending || !quote}
                    onClick={() => {
                      let value = 0n
                      try {
                        value = parseEther(topup)
                      } catch {
                        return
                      }
                      void send('bid', [auctionId], quote, value)
                    }}
                  >
                    Place bid
                  </Button>
                  <small>{quote?.maxCost ?? 'minimum top-up required'}</small>
                </div>
              )}
              <GroupBox title="Bids by block">
                <div className="auction-bids">
                  <b>block</b>
                  <b>bidder</b>
                  <b>bid</b>
                  <b>note</b>
                  {bids.map((bid, index) => (
                    <span className="auction-bid-grid" key={index}>
                      <span>{bid.blockNumber.toString()}</span>
                      <span>{shortAddress(bid.bidder)}</span>
                      <span>{formatEther(bid.total)} MON</span>
                      <span>
                        {knownEnd && bid.blockNumber > previewEnd
                          ? 'after candle'
                          : winning === bid
                            ? 'winning'
                            : index === bids.length - 1
                              ? 'standing'
                              : ''}
                      </span>
                    </span>
                  ))}
                </div>
              </GroupBox>
              <div className="lab-action-row">
                <Button
                  primary
                  disabled={pending || !actions.settle}
                  onClick={() => void send('settle', [auctionId])}
                >
                  Settle
                </Button>
                <Button
                  disabled={pending || !actions.withdrawBid}
                  onClick={() => void send('withdraw', [auctionId])}
                >
                  Withdraw bid
                </Button>
                <Button
                  disabled={pending || !actions.withdrawProceeds}
                  onClick={() => void send('withdrawCredits')}
                >
                  Withdraw proceeds
                </Button>
              </div>
              <small>
                Your bid is locked until settlement. A bid placed during the final hour might land after the
                candle.
              </small>
            </>
          ) : (
            <div className="lab-empty">no auction found yet.</div>
          )}
        </section>
      </div>
      <footer className="lab-status">
        <span>{message || (info?.state === 2 ? 'settled' : 'permissionless candle auction')}</span>
        <span>{wallet.account ? shortAddress(wallet.account) : 'wallet disconnected'}</span>
        <span>#{block.block.toString()}</span>
      </footer>
    </div>
  )
}
