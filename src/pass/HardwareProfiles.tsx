import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { parseEther } from 'viem'
import { publicClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { useRefreshTick } from '../chain/refreshTick'
import { config } from '../chain/config'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_PAINT_ABI, R3TARDS_SLEEPWALKER_ABI } from '../lib/generated/abi'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { Icon } from '../os/ui/Icon'
import { MessageBox } from '../os/ui/MessageBox'
import { deleteBurner } from '../live/burner'
import {
  formatBurnerBalance,
  formatLiveTime,
  getLiveSnapshot,
  liveActive,
  liveTimeLeftMs,
  refreshLiveStatus,
  setLiveOwner,
  subscribeLive,
  sweepAmount,
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
  const [ending, setEnding] = useState(false)
  const [endProgress, setEndProgress] = useState('')
  const [error, setError] = useState('')
  const [sessionNonce, setSessionNonce] = useState(0n)
  const [cancelQuote, setCancelQuote] = useState<ActionQuote>()
  const [dreamSessionsLeft, setDreamSessionsLeft] = useState(0n)
  const [cancelling, setCancelling] = useState(false)
  const endWorkRef = useRef(false)
  const confirmHigherCost = async (oldQuote: ActionQuote, nextQuote: ActionQuote) =>
    window.confirm(`gas moved from ${oldQuote.maxCost} to ${nextQuote.maxCost}. continue?`)

  useEffect(() => setLiveOwner(wallet.account), [wallet.account])

  useEffect(() => {
    setDreamSessionsLeft(0n)
    if (!wallet.account || !publicClient || !config.paintAddress) return
    const client = publicClient
    const account = wallet.account
    let cancelled = false
    void (async () => {
      const nonce = BigInt(
        await client.readContract({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'sessionNonces',
          args: [account],
        }),
      )
      if (!cancelled) setSessionNonce(nonce)
      const contracts = await discoverContracts()
      const sleepwalker = contracts.labs.sleepwalker
      if (sleepwalker) {
        const dream = (await client.readContract({
          address: sleepwalker,
          abi: R3TARDS_SLEEPWALKER_ABI,
          functionName: 'dreamOf',
          args: [account],
        })) as readonly unknown[]
        if (!cancelled) setDreamSessionsLeft(BigInt(dream[5] as bigint))
      }
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [wallet.account, refreshTick])

  useEffect(() => {
    setCancelQuote(undefined)
    if (!wallet.account || !config.paintAddress) return
    const account = wallet.account
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'incrementSessionNonce',
      account,
      action: 'cancel unused session signatures',
    })
      .then((quote) => {
        if (!cancelled) setCancelQuote(quote)
      })
      .catch(() => {
        if (!cancelled) setCancelQuote(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [wallet.account])

  useEffect(() => {
    if (!topUp || !wallet.account || !live.burner) return
    let value: bigint
    try {
      value = parseEther(amount)
    } catch {
      setTopQuote(undefined)
      return
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
      .then(setTopQuote)
      .catch(() => setTopQuote(undefined))
  }, [topUp, wallet.account, live.burner, amount])

  const active = liveActive(live)
  const remaining = unitsLeft(live.session)
  const max = live.session?.maxUnits ?? 0n
  const segments = max > 0n ? Number((remaining * 20n) / max) : 0

  async function sendTopUp() {
    if (!wallet.account || !live.burner || !topQuote) return
    const value = parseEther(amount)
    try {
      await sendAction({
        type: 'transfer',
        kind: 'estimate',
        to: live.burner.address,
        functionName: 'transfer',
        account: wallet.account,
        value,
        quote: topQuote,
        confirmHigherCost,
        action: 'top up burner',
      })
      setTopUp(false)
      await refreshLiveStatus(wallet.account)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function cancelUnusedSignatures() {
    if (!wallet.account || !config.paintAddress || !cancelQuote) return
    setCancelling(true)
    try {
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
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
          abi: R3TARDS_PAINT_ABI,
          functionName: 'incrementSessionNonce',
          account: wallet.account,
          action: 'cancel unused session signatures',
        }),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
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
      setEndProgress('1 of 3 · revoking burner…')
      const revokeQuote = await quoteAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'revokeSession',
        args: [live.burner.address],
        account: wallet.account,
        action: 'end live session',
      })
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'revokeSession',
        args: [live.burner.address],
        account: wallet.account,
        quote: revokeQuote,
        confirmHigherCost,
        action: 'end live session',
      })

      setEndProgress('2 of 3 · sweeping leftover MON…')
      const balance = await publicClient.getBalance({ address: live.burner.address })
      const feeProbe = await quoteAction({
        type: 'transfer',
        kind: 'estimate',
        to: wallet.account,
        functionName: 'transfer',
        account: wallet.account,
        signer: 'burner',
        value: 0n,
        action: 'sweep burner',
      })
      const value = sweepAmount(balance, feeProbe.maxFeePerGas)
      if (value > 0n) {
        const sweepQuote = { ...feeProbe, gasLimit: 21_000n }
        await sendAction({
          type: 'transfer',
          kind: 'estimate',
          to: wallet.account,
          functionName: 'transfer',
          account: wallet.account,
          signer: 'burner',
          value,
          quote: sweepQuote,
          confirmHigherCost,
          action: 'sweep burner',
        })
      }

      setEndProgress('3 of 3 · removing local key…')
      deleteBurner(wallet.account)
      await refreshLiveStatus(wallet.account)
      endWorkRef.current = false
      setEnding(false)
      setEndProgress('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
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
          <small>{live.burner ? 'paints canvas · flipbook · forks' : 'set one up with New burner…'}</small>
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
      <GroupBox title="Cancel unused signatures">
        <dl className="hardware-status">
          <dt>Session nonce</dt>
          <dd>{sessionNonce.toString()}</dd>
        </dl>
        <p>
          Every session you signed but haven't started stops working. Sessions already running keep going;
          revoke those separately.
        </p>
        {dreamSessionsLeft > 0n && (
          <p className="warning-line">
            your Sleepwalker dream stalls at its next night. Resume with new signatures or wake up.
          </p>
        )}
        <Button
          disabled={!wallet.account || !cancelQuote || cancelling}
          onClick={() => void cancelUnusedSignatures()}
        >
          {cancelling ? 'Cancelling…' : 'Cancel unused signatures'}
        </Button>
        <small>{cancelQuote?.maxCost ?? 'quoting…'}</small>
      </GroupBox>
      <div className="hardware-actions">
        <Button
          disabled={active}
          title={active ? 'end the current session first' : undefined}
          onClick={() => openProgram('live-wizard')}
        >
          New burner…
        </Button>
        <Button disabled={!live.burner} onClick={() => setTopUp(true)}>
          Top up…
        </Button>
        <Button className="danger-text" disabled={!active} onClick={() => setEnding(true)}>
          End session…
        </Button>
      </div>
      <p className="muted hardware-footnote">
        Live mode can't mint frames, reels or forks, change face or background, or claim the Painter Pass.
        Ending the session revokes the key first, then sends leftover MON back to your wallet.
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
          <p>max gas: {topQuote?.maxCost ?? 'quoting…'}</p>
        </MessageBox>
      )}
      {ending && (
        <MessageBox
          title="End live session"
          kind="warning"
          message="Revoke the burner and send its leftover MON back to your wallet?"
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
