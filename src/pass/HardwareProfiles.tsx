import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { screenSafeMessage } from '../chain/errors'
import { confirmHigherCost } from '../os/confirm'
import { formatEther, parseEther } from 'viem'
import { publicClient } from '../chain/clients'
import { useRefreshTick } from '../chain/refreshTick'
import { config } from '../chain/config'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { Icon } from '../os/ui/Icon'
import { MessageBox } from '../os/ui/MessageBox'
import { cachedBurnerBalance, setCachedBurnerBalance } from '../live/burner'
import { endLiveSession } from '../live/endSession'
import { StrandedBurners } from '../live/StrandedBurners'
import {
  burnerTopUpValue,
  confirmBurnerBalance,
  formatBurnerBalance,
  MAX_BURNER_FUND,
  formatLiveTime,
  getLiveSnapshot,
  liveActive,
  liveTimeLeftMs,
  setLiveOwner,
  subscribeLive,
  unitsLeft,
} from '../live/liveStore'

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

export function HardwareProfiles() {
  const refreshTick = useRefreshTick()
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const [topUp, setTopUp] = useState(false)
  const [amount, setAmount] = useState('0.5')
  const [topQuote, setTopQuote] = useState<ActionQuote>()
  const [topQuoteValue, setTopQuoteValue] = useState<bigint>()
  const [ending, setEnding] = useState(false)
  const [endProgress, setEndProgress] = useState('')
  const [error, setError] = useState('')
  const [sessionNonce, setSessionNonce] = useState(0n)
  const [cancelQuote, setCancelQuote] = useState<ActionQuote>()
  const [cancelQuoteFailed, setCancelQuoteFailed] = useState(false)
  const [topQuoteNote, setTopQuoteNote] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const endWorkRef = useRef(false)

  useEffect(() => setLiveOwner(wallet.account), [wallet.account])

  useEffect(() => {
    if (!wallet.account || !publicClient || !config.paintAddress) return
    const client = publicClient
    const account = wallet.account
    let cancelled = false
    void (async () => {
      const nonce = BigInt(
        await client.readContract({
          address: config.paintAddress!,
          abi: R3OS_PAINT_ABI,
          functionName: 'sessionNonces',
          args: [account],
        }),
      )
      if (!cancelled) setSessionNonce(nonce)
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [wallet.account, refreshTick])

  useEffect(() => {
    setCancelQuote(undefined)
    setCancelQuoteFailed(false)
    if (!wallet.account || !config.paintAddress) return
    const account = wallet.account
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'incrementSessionNonce',
      account,
      action: 'cancel unused session signatures',
    })
      .then((quote) => {
        if (!cancelled) setCancelQuote(quote)
      })
      .catch(() => {
        if (cancelled) return
        setCancelQuote(undefined)
        setCancelQuoteFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [wallet.account])

  useEffect(() => {
    setTopQuote(undefined)
    setTopQuoteValue(undefined)
    if (!topUp || !wallet.account || !live.burner) return
    setTopQuoteNote('')
    let requested: bigint
    try {
      requested = parseEther(amount)
    } catch {
      setTopQuoteNote('enter a valid MON amount')
      return
    }
    const currentBalance = cachedBurnerBalance(wallet.account) ?? live.balance
    const value = burnerTopUpValue(requested, currentBalance)
    if (value <= 0n) {
      setTopQuoteNote(`burner is already at the ${formatEther(MAX_BURNER_FUND)} MON browser-key cap`)
      return
    }
    if (value < requested) {
      setTopQuoteNote(
        `will send ${formatEther(value)} MON so the burner stays at or below the ${formatEther(MAX_BURNER_FUND)} MON cap`,
      )
    }
    void quoteAction({
      type: 'transfer',
      kind: 'estimate',
      to: live.burner.address,
      functionName: 'transfer',
      account: wallet.account,
      value,
      action: 'top up burner',
    })
      .then((quote) => {
        setTopQuote(quote)
        setTopQuoteValue(value)
      })
      .catch(() => {
        setTopQuote(undefined)
        setTopQuoteValue(undefined)
        setTopQuoteNote('quote unavailable')
      })
  }, [topUp, wallet.account, live.burner, live.balance, amount])

  const active = liveActive(live)
  const remaining = unitsLeft(live.session)
  const max = live.session?.maxUnits ?? 0n
  const segments = max > 0n ? Number((remaining * 20n) / max) : 0

  async function sendTopUp() {
    if (!wallet.account || !live.burner || !topQuote || topQuoteValue == null) return
    const owner = wallet.account
    const value = topQuoteValue
    try {
      await sendAction({
        type: 'transfer',
        kind: 'estimate',
        to: live.burner.address,
        functionName: 'transfer',
        account: owner,
        value,
        quote: topQuote,
        confirmHigherCost,
        action: 'top up burner',
      })
      const currentBalance = cachedBurnerBalance(owner) ?? live.balance
      const nextBalance = currentBalance + value
      setCachedBurnerBalance(owner, nextBalance)
      confirmBurnerBalance(owner, nextBalance)
      setTopUp(false)
      // Funding is already proven by the receipt. Event-driven refreshes will reconcile later; do not
      // immediately replace this receipt-observed balance with a potentially lagging public-RPC read.
    } catch (caught) {
      setError(screenSafeMessage(caught))
    }
  }

  async function cancelUnusedSignatures() {
    if (!wallet.account || !config.paintAddress || !cancelQuote) return
    setCancelling(true)
    try {
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName: 'incrementSessionNonce',
        account: wallet.account,
        quote: cancelQuote,
        confirmHigherCost,
        action: 'cancel unused session signatures',
      })
      setCancelQuote(
        await quoteAction({
          kind: 'estimate',
          address: config.paintAddress,
          abi: R3OS_PAINT_ABI,
          functionName: 'incrementSessionNonce',
          account: wallet.account,
          action: 'cancel unused session signatures',
        }),
      )
    } catch (caught) {
      setError(screenSafeMessage(caught))
    } finally {
      setCancelling(false)
    }
  }

  async function endSession() {
    if (!wallet.account || !live.burner || !config.paintAddress || !publicClient) return
    setEnding(true)
    endWorkRef.current = true
    setError('')
    try {
      await endLiveSession({
        account: wallet.account,
        burner: live.burner.address,
        active,
        onProgress: setEndProgress,
      })
      endWorkRef.current = false
      setEnding(false)
      setEndProgress('')
    } catch (caught) {
      setError(screenSafeMessage(caught))
      endWorkRef.current = false
      setEnding(false)
    }
  }

  return (
    <div className="hardware-profiles">
      <p className="hardware-intro">
        <Icon name="key" size={24} />
        <span>
          Live mode paints without a wallet prompt for every stroke. A burner key in this browser signs paints
          for you, inside limits you sign once.
        </span>
      </p>
      <div className="hardware-list sunken">
        <button>
          <b>Main wallet</b> · {short(wallet.account)}
          <small>frames · face · claims</small>
        </button>
        <button className="selected">
          <b>{live.burner ? 'Burner (current)' : 'No burner'}</b> · {short(live.burner?.address)}
          <small>{live.burner ? 'paints the canvas' : 'set one up with New burner…'}</small>
        </button>
      </div>
      <GroupBox title="Burner status">
        <dl className="hardware-status">
          <dt>Status</dt>
          <dd>
            <i className={active ? 'live-dot active' : 'live-dot'} />
            {active
              ? `Active · painting as ${short(live.session?.owner)}`
              : live.session?.revoked
                ? 'Revoked'
                : live.session && live.session.expiryBlock > 0n
                  ? 'Expired'
                  : 'Not started'}
          </dd>
          <dt>Expires</dt>
          <dd>
            {live.session?.expiryBlock
              ? `block ${live.session.expiryBlock} · in ${formatLiveTime(liveTimeLeftMs(live.session))}`
              : '—'}
          </dd>
          <dt>Allowance</dt>
          <dd>
            {remaining.toLocaleString()} of {max.toLocaleString()} units left
            <span className="live-segments" aria-label={`${remaining} of ${max} units left`}>
              {Array.from({ length: 20 }, (_, index) => (
                <i key={index} className={index < segments ? 'on' : ''} />
              ))}
            </span>
          </dd>
          <dt>Burner balance</dt>
          <dd>{formatBurnerBalance(live.balance)}</dd>
          <dt>Session paints</dt>
          <dd>{live.sessionPaints.toLocaleString()} (counts toward LIVE WIRE)</dd>
        </dl>
      </GroupBox>
      <StrandedBurners owner={wallet.account} current={live.burner?.address} refresh={refreshTick} />
      <GroupBox title="Cancel unused signatures">
        <dl className="hardware-status">
          <dt>Session nonce</dt>
          <dd>{sessionNonce.toString()}</dd>
        </dl>
        <p>
          Every session you signed but haven't started stops working. Sessions already running keep going;
          revoke those separately.
        </p>
        <Button
          disabled={!wallet.account || !cancelQuote || cancelling}
          onClick={() => void cancelUnusedSignatures()}
        >
          {cancelling ? 'Cancelling…' : 'Cancel unused signatures'}
        </Button>
        <small className="hardware-quote">
          {!wallet.account
            ? 'connect a wallet'
            : (cancelQuote?.maxCost ?? (cancelQuoteFailed ? 'quote unavailable' : 'quoting…'))}
        </small>
      </GroupBox>
      <div className="hardware-actions">
        <Button
          disabled={active}
          title={active ? 'end the current session first' : undefined}
          onClick={() => openProgram('live-wizard')}
        >
          New burner…
        </Button>
        <Button
          // A burner whose session is over gets its MON sent straight back by the automatic sweep
          // (src/live/autoSweep.ts), so a top-up then would only bounce. Start Live Mode funds it instead.
          disabled={!live.burner || !active}
          title={live.burner && !active ? 'no running session: Start Live Mode funds the key' : undefined}
          onClick={() => setTopUp(true)}
        >
          Top up…
        </Button>
        <Button
          className="danger-text"
          disabled={!live.burner || (!active && live.balance === 0n)}
          title={!live.burner ? 'no burner in this browser' : undefined}
          onClick={() => setEnding(true)}
        >
          {active || !live.burner ? 'End session…' : 'Sweep leftover MON…'}
        </Button>
      </div>
      <p className="muted hardware-footnote">
        Live mode can't mint frames, change face or background, or claim the Painter Pass. Ending the session
        revokes the key first, then sends leftover MON back to your wallet.
      </p>
      {topUp && (
        <MessageBox
          title="Top up burner"
          onClose={() => setTopUp(false)}
          onDefault={() => void sendTopUp()}
          onCancel={() => setTopUp(false)}
          defaultLabel="Send"
        >
          <label>
            MON <input value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <p>
            {topQuoteValue != null ? `sending ${formatEther(topQuoteValue)} MON · ` : ''}max gas:{' '}
            {topQuote?.maxCost ?? (topQuoteNote || 'quoting…')}
          </p>
          {topQuote && topQuoteNote && <small>{topQuoteNote}</small>}
        </MessageBox>
      )}
      {ending && (
        <MessageBox
          title="End live session"
          kind="warning"
          message={
            active
              ? 'Revoke the burner and send its leftover MON back to your wallet?'
              : 'This session is over. Send the burner’s leftover MON back to your wallet and remove its key from this browser?'
          }
          onClose={() => {
            if (!endWorkRef.current) setEnding(false)
          }}
          onDefault={() => {
            if (!endWorkRef.current) void endSession()
          }}
          onCancel={() => {
            if (!endWorkRef.current) setEnding(false)
          }}
          defaultLabel={endProgress ? 'Working…' : 'End session'}
        >
          {endProgress && <p>{endProgress}</p>}
        </MessageBox>
      )}
      {error && <MessageBox title="Live mode" kind="error" message={error} onClose={() => setError('')} />}
    </div>
  )
}
