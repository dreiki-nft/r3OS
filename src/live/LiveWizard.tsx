import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { confirmHigherCost } from '../os/confirm'
import { formatEther, parseEther, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { friendlyError } from '../chain/errors'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { SafeImage } from '../os/ui/SafeImage'
import { createBurner, loadBurner } from './burner'
import { QUICK_ALLOWANCE, samplePaint64, startLiveQuick, type QuickProgress } from './quickStart'
import {
  buildStartSessionTypedData,
  fundingSuggestion,
  getLiveSnapshot,
  isSessionSignatureExpired,
  liveActive,
  refreshLiveStatus,
  type SessionSignature,
  type StartSessionMessage,
} from './liveStore'

const SESSION_LENGTHS = [
  { label: '2 hours', blocks: 24_000n },
  { label: '1 hour', blocks: 12_000n },
  { label: '30 minutes', blocks: 6_000n },
]
const ALLOWANCES = [5_000n, 2_000n, 10_000n]

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

function about(blocks: bigint, ms: number) {
  const minutes = Math.max(1, Math.round((Number(blocks) * ms) / 60_000))
  return minutes >= 60 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`
}

export function LiveWizard() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const [step, setStep] = useState(1)
  const [length, setLength] = useState(24_000n)
  const [allowance, setAllowance] = useState(5_000n)
  const [burnerAddress, setBurnerAddress] = useState(() =>
    wallet.account ? loadBurner(wallet.account)?.address : undefined,
  )
  const [message, setMessage] = useState<StartSessionMessage>()
  const [signature, setSignature] = useState<SessionSignature>()
  const [amount, setAmount] = useState('')
  const [sentAmount, setSentAmount] = useState('')
  const [balance, setBalance] = useState(0n)
  const [startQuote, setStartQuote] = useState<ActionQuote>()
  const [corePaintGas, setCorePaintGas] = useState<bigint>()
  const [fundQuote, setFundQuote] = useState<ActionQuote>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [finished, setFinished] = useState(false)
  const [quick, setQuick] = useState<QuickProgress>()

  const close = () => closeWindow('live-wizard')
  const refreshBalance = useCallback(async () => {
    if (!burnerAddress || !publicClient) return
    const next = await publicClient.getBalance({ address: burnerAddress })
    setBalance(next)
  }, [burnerAddress])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  useEffect(() => {
    if (!wallet.account) return
    const stored = loadBurner(wallet.account)
    if (!stored) return
    setBurnerAddress(stored.address)
    setStep((current) => Math.max(current, 2))
    void refreshLiveStatus(wallet.account).then(() => {
      if (liveActive(getLiveSnapshot())) {
        setStep(4)
        setFinished(true)
      }
    })
  }, [wallet.account])

  useEffect(() => {
    if (!wallet.account || !burnerAddress || !config.paintAddress) return
    const sample = samplePaint64()
    if (sample.pixelWrites !== 64) return
    void quoteAction({
      kind: 'corePaint',
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'paint',
      args: [sample.hex, []],
      account: wallet.account,
      pixels: 64,
      signer: 'wallet',
      action: 'sample 64 px paint',
    })
      .then((quote) => setCorePaintGas(quote.gasLimit))
      .catch(() => setCorePaintGas(undefined))
  }, [wallet.account, burnerAddress])

  useEffect(() => {
    if (!wallet.account || !burnerAddress || !config.paintAddress || !message || !signature) return
    void quoteAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'startSession',
      args: [
        wallet.account,
        burnerAddress,
        message.expiryBlock,
        message.maxUnits,
        message.nonce,
        message.deadline,
        signature,
      ],
      account: wallet.account,
      signer: 'burner',
      action: 'start live session',
    })
      .then((quote) => {
        setStartQuote(quote)
        if (!amount && corePaintGas != null) {
          const suggestion = fundingSuggestion(corePaintGas, quote.gasLimit, quote.maxFeePerGas)
          setAmount(formatEther(suggestion))
        }
      })
      .catch((caught) => setError(friendlyError(caught, 'startSession').message))
  }, [wallet.account, burnerAddress, message, signature, amount, corePaintGas])

  useEffect(() => {
    if (!wallet.account || !burnerAddress || !amount) {
      setFundQuote(undefined)
      return
    }
    let value: bigint
    try {
      value = parseEther(amount)
    } catch {
      setFundQuote(undefined)
      return
    }
    void quoteAction({
      type: 'transfer',
      kind: 'estimate',
      to: burnerAddress,
      functionName: 'transfer',
      account: wallet.account,
      value,
      action: 'fund burner',
    })
      .then(setFundQuote)
      .catch(() => setFundQuote(undefined))
  }, [wallet.account, burnerAddress, amount])

  const enough = useMemo(() => {
    if (!startQuote) return balance > 0n
    return balance >= startQuote.gasLimit * startQuote.maxFeePerGas
  }, [balance, startQuote])

  async function prepareBurner() {
    if (!wallet.account) return
    const burner = createBurner(wallet.account)
    const stored = loadBurner(wallet.account)
    if (!stored || stored.address.toLowerCase() !== burner.address.toLowerCase()) {
      setError('this browser blocked burner storage. allow local storage and try again.')
      return
    }
    setBurnerAddress(burner.address)
    setError('')
    setStep(2)
  }

  async function signSession() {
    if (!wallet.account || !wallet.client || !burnerAddress || !publicClient || !config.paintAddress) return
    setBusy(true)
    setError('')
    try {
      const nonce = (await publicClient.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'sessionNonces',
        args: [wallet.account],
      })) as bigint
      const next: StartSessionMessage = {
        owner: wallet.account,
        sessionKey: burnerAddress,
        expiryBlock: block.block + length,
        maxUnits: allowance,
        nonce,
        deadline: BigInt(Math.floor(Date.now() / 1_000) + 15 * 60),
      }
      const sig = (await wallet.client.signTypedData({
        account: wallet.account,
        ...buildStartSessionTypedData(next),
      })) as Hex
      setMessage(next)
      setSignature(sig)
    } catch (caught) {
      setError(friendlyError(caught, 'startSession').message)
    } finally {
      setBusy(false)
    }
  }

  async function fund() {
    if (!wallet.account || !burnerAddress || !fundQuote) return
    let value: bigint
    try {
      value = parseEther(amount)
    } catch {
      setError('enter a valid MON amount')
      return
    }
    setBusy(true)
    setError('')
    try {
      await sendAction({
        type: 'transfer',
        kind: 'estimate',
        to: burnerAddress,
        functionName: 'transfer',
        account: wallet.account,
        value,
        quote: fundQuote,
        confirmHigherCost,
        action: 'fund burner',
      })
      setSentAmount(amount)
      await refreshBalance()
    } catch (caught) {
      setError(friendlyError(caught, 'transfer').message)
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    if (!wallet.account || !burnerAddress || !message || !signature || !startQuote || !config.paintAddress)
      return
    if (isSessionSignatureExpired(message.deadline)) {
      setSignature(undefined)
      setMessage(undefined)
      setError('the signature expired, sign again')
      setStep(2)
      return
    }
    setBusy(true)
    setError('')
    try {
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'startSession',
        args: [
          wallet.account,
          burnerAddress,
          message.expiryBlock,
          message.maxUnits,
          message.nonce,
          message.deadline,
          signature,
        ],
        account: wallet.account,
        signer: 'burner',
        quote: startQuote,
        confirmHigherCost,
        action: 'start live session',
      })
      await refreshLiveStatus(wallet.account)
      await refreshBalance()
      setFinished(true)
    } catch (caught) {
      const friendly = friendlyError(caught, 'startSession')
      if (/deadline|signature expired/i.test(friendly.message)) {
        setSignature(undefined)
        setMessage(undefined)
        setStep(2)
        setError('the signature expired, sign again')
      } else {
        setError(friendly.message)
      }
    } finally {
      setBusy(false)
    }
  }

  async function quickStart() {
    if (!wallet.account) return
    setBusy(true)
    setError('')
    setQuick({ phase: 'prepare', prompts: 2 })
    try {
      await startLiveQuick(wallet.account, setQuick)
      setFinished(true)
    } catch (caught) {
      setError(friendlyError(caught, 'startSession').message)
    } finally {
      setBusy(false)
    }
  }

  const quickOrder = ['prepare', 'sign', 'fund', 'start', 'done'] as const
  const quickClass = (phase: (typeof quickOrder)[number]) => {
    if (!quick) return ''
    const at = quickOrder.indexOf(quick.phase)
    const mine = quickOrder.indexOf(phase)
    if (at > mine) return 'done'
    return at === mine ? (error ? 'failed' : 'current') : ''
  }

  const selectedLength = SESSION_LENGTHS.find((option) => option.blocks === length)

  return (
    <div className="live-wizard">
      <div className="live-wizard-body">
        <div className="live-wizard-art sunken">
          <SafeImage src="/os/brand/pfp-main.webp" alt="r3tards" width={168} height={338} />
        </div>
        <section className="live-wizard-step">
          {quick ? (
            <>
              <small>QUICK START</small>
              <h2>{finished ? 'Live mode is on' : 'Starting live mode'}</h2>
              <ol className="live-quick-steps">
                <li className={quickClass('sign')}>
                  Sign the session
                  <small>wallet prompt 1 · a signature, it can't move funds</small>
                </li>
                {quick.prompts !== 1 && (
                  <li className={quickClass('fund')}>
                    Send the burner its gas money
                    <small>
                      wallet prompt 2 ·{' '}
                      {quick.funding ? `${quick.funding} MON` : 'enough for about 100 paints'}
                    </small>
                  </li>
                )}
                <li className={quickClass('start')}>
                  The burner registers itself
                  <small>no prompt</small>
                </li>
              </ol>
              {finished ? (
                <p>
                  Paint away: strokes land with no wallet popup for about {about(24_000n, block.blockTimeMs)}{' '}
                  or {QUICK_ALLOWANCE.toLocaleString()} units. End the session in My Pass › Hardware Profiles
                  to get leftover MON back.
                </p>
              ) : (
                !error && <p className="muted">keep this window open. confirm each prompt in your wallet.</p>
              )}
            </>
          ) : (
            <>
              <small>STEP {step} OF 4</small>
              {step === 1 && (
                <>
                  <h2>Welcome to live mode</h2>
                  <p>
                    Live mode makes a burner key that lives in this browser. It paints for you, so strokes
                    land without a wallet prompt each time.
                  </p>
                  <div className="live-quick sunken">
                    <b>Quick start</b>
                    <span>
                      about {about(24_000n, block.blockTimeMs)} · {QUICK_ALLOWANCE.toLocaleString()} units · 2
                      wallet prompts, then no more popups
                    </span>
                    <Button
                      primary
                      disabled={busy || !wallet.account}
                      title={wallet.account ? undefined : 'connect a wallet first'}
                      onClick={() => void quickStart()}
                    >
                      Start live mode
                    </Button>
                  </div>
                  <p className="muted">or pick your own limits and press Next.</p>
                  <label>
                    Session length
                    <select
                      value={length.toString()}
                      onChange={(event) => setLength(BigInt(event.target.value))}
                    >
                      {SESSION_LENGTHS.map((option) => (
                        <option key={option.blocks.toString()} value={option.blocks.toString()}>
                          {option.label} (about {about(option.blocks, block.blockTimeMs)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Pixel allowance
                    <select
                      value={allowance.toString()}
                      onChange={(event) => setAllowance(BigInt(event.target.value))}
                    >
                      {ALLOWANCES.map((value) => (
                        <option key={value.toString()} value={value.toString()}>
                          {value.toLocaleString()} units
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted">
                    It still spends your normal hourly budget and holder quota. The allowance is an extra cap
                    on top.
                  </p>
                </>
              )}
              {step === 2 && (
                <>
                  <h2>Sign the session</h2>
                  <p>
                    Your wallet signs one message. It names the burner, the expiry block and the pixel
                    allowance. It can't move funds and it can't mint.
                  </p>
                  <pre className="live-summary sunken">{`owner ${short(wallet.account)}
burner ${short(burnerAddress)}
expires block ${message?.expiryBlock.toString() ?? (block.block + length).toString()}
allowance ${allowance.toLocaleString()} units`}</pre>
                  <Button primary disabled={busy || !wallet.client} onClick={() => void signSession()}>
                    Sign in wallet
                  </Button>
                  <p>{signature ? 'signed ✓' : 'not signed yet'}</p>
                </>
              )}
              {step === 3 && (
                <>
                  <h2>Fund the burner</h2>
                  <p>
                    The burner pays its own gas, so it needs a little MON. Monad charges the gas limit, so
                    each live paint costs a fixed small amount.
                  </p>
                  <label>
                    Send
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      inputMode="decimal"
                    />{' '}
                    MON
                  </label>
                  <small>≈ 100 paints</small>
                  <p>max cost: {fundQuote ? `${amount} MON + ${fundQuote.maxCost}` : 'quoting…'}</p>
                  <Button disabled={busy || !fundQuote} onClick={() => void fund()}>
                    Send
                  </Button>
                  {sentAmount && (
                    <p>
                      {sentAmount} MON sent to {short(burnerAddress)} ✓
                    </p>
                  )}
                  <p className="muted">
                    Ending the session later sends whatever is left back to your wallet.
                  </p>
                </>
              )}
              {step === 4 && (
                <>
                  <h2>Finish</h2>
                  {!finished ? (
                    <>
                      <p>
                        Ready to start. The burner sends its own startSession transaction. After that, strokes
                        commit on pointer-up.
                      </p>
                      <pre className="live-summary sunken">{`burner ${short(burnerAddress)} · ${Number(
                        formatEther(balance),
                      ).toFixed(2)} MON
paints the canvas as ${short(wallet.account)}
expires block ${message?.expiryBlock.toString() ?? '—'} (about ${selectedLength?.label ?? '—'})
allowance ${allowance.toLocaleString()} units`}</pre>
                      {busy && <p>registering the burner…</p>}
                    </>
                  ) : (
                    <>
                      <p>
                        Live mode is on. Paint away. The tray key icon shows the session; End session lives in
                        System Properties › Hardware Profiles.
                      </p>
                      <pre className="live-summary sunken">{`burner ${short(burnerAddress)} · ${Number(
                        formatEther(balance),
                      ).toFixed(2)} MON
paints the canvas as ${short(wallet.account)}
expires block ${message?.expiryBlock.toString() ?? '—'} (about ${selectedLength?.label ?? '—'})
allowance ${allowance.toLocaleString()} units`}</pre>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {error && <p className="dialog-error">{error}</p>}
        </section>
      </div>
      <footer className="live-wizard-footer">
        {quick ? (
          <>
            <Button
              disabled={busy || finished}
              onClick={() => {
                setQuick(undefined)
                setError('')
              }}
            >
              &lt; Options
            </Button>
            {finished ? (
              <Button primary onClick={close}>
                Close
              </Button>
            ) : (
              <Button primary disabled={busy} onClick={() => void quickStart()}>
                {busy ? 'Working…' : 'Try again'}
              </Button>
            )}
            {!finished && (
              <Button disabled={busy} onClick={close}>
                Cancel
              </Button>
            )}
          </>
        ) : (
          <>
            <Button disabled={step === 1 || busy || finished} onClick={() => setStep((value) => value - 1)}>
              &lt; Back
            </Button>
            {step < 4 ? (
              <Button
                primary={step > 1}
                disabled={busy || (step === 2 && !signature) || (step === 3 && !enough)}
                onClick={() => {
                  if (step === 1) void prepareBurner()
                  else setStep((value) => value + 1)
                }}
              >
                Next &gt;
              </Button>
            ) : finished ? (
              <Button primary onClick={close}>
                Close
              </Button>
            ) : (
              <Button primary disabled={busy || !enough || !startQuote} onClick={() => void finish()}>
                Finish
              </Button>
            )}
            {!finished && <Button onClick={close}>Cancel</Button>}
          </>
        )}
      </footer>
    </div>
  )
}
