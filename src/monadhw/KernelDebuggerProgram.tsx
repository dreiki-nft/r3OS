import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { formatEther, parseEther, type Address } from 'viem'
import { publicClient } from '../chain/clients'
import { readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_KERNEL_DEBUGGER_ABI } from '../lib/generated/abi'
import { errorText, labAddress, shortAddress } from '../labs/labCommon'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import { MessageBox } from '../os/ui/MessageBox'
import { buildKernelLines } from './kernel'
import {
  createProcessKey,
  KERNEL_PING_GAS,
  KERNEL_RUN_GAS,
  loadProcessKey,
  runKernelScenario,
  sweepProcessKey,
  withdrawProcessCredits,
  type KernelScenario,
  type ProcessKeyRecord,
} from './processKey'
import './monadhw.css'

const RULES = [
  'the process key is a throwaway local key used only to create the real “recent transaction” condition that a normal one-off wallet call usually avoids.',
  'BURST GRACEFUL sends ping and run back-to-back. if the reserve condition is detected, the value is returned inside the run transaction before commit.',
  'BURST NAIVE deliberately leaves the dip uncorrected. on Monad it is expected to revert at transaction end and still be charged its full fixed gas limit.',
] as const

const FUND = parseEther('0.05')
const DEFAULT_VALUE = '0.01'

export function KernelDebuggerProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const refreshTick = useRefreshTick(10)
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [process, setProcess] = useState<ProcessKeyRecord>()
  const [balance, setBalance] = useState(0n)
  const [credits, setCredits] = useState(0n)
  const [fundQuote, setFundQuote] = useState<ActionQuote>()
  const [valueText, setValueText] = useState(DEFAULT_VALUE)
  const [failOptional, setFailOptional] = useState(false)
  const [lines, setLines] = useState<string[]>(['KERNEL DEBUGGER', 'idle'])
  const [naiveConfirm, setNaiveConfirm] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void labAddress('kernel-debugger')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  useEffect(() => {
    setProcess(wallet.account ? loadProcessKey(wallet.account) : undefined)
  }, [wallet.account])

  const refreshProcess = useCallback(async () => {
    if (!publicClient || !address || !process) {
      setBalance(0n)
      setCredits(0n)
      return
    }
    const [nextBalance, rows] = await Promise.all([
      publicClient.getBalance({ address: process.address }).catch(() => 0n),
      readMany(
        [{ address, abi: R3TARDS_KERNEL_DEBUGGER_ABI, functionName: 'credits', args: [process.address] }],
        { allowFailure: true },
      ).catch(() => []),
    ])
    setBalance(nextBalance)
    const row = rows[0] as any
    setCredits(row?.status === 'success' ? BigInt(row.result) : 0n)
  }, [address, process])

  useEffect(() => {
    void refreshProcess()
  }, [refreshProcess, refreshTick])

  useEffect(() => {
    setFundQuote(undefined)
    if (!wallet.account || !process) return
    let cancelled = false
    void quoteAction({
      type: 'transfer',
      kind: 'estimate',
      account: wallet.account,
      to: process.address,
      functionName: 'transfer',
      value: FUND,
      action: 'fund Kernel process key',
    })
      .then((quote) => !cancelled && setFundQuote(quote))
      .catch(() => !cancelled && setFundQuote(undefined))
    return () => {
      cancelled = true
    }
  }, [wallet.account, process])

  const parsedValue = useMemo(() => {
    try {
      return parseEther(valueText || '0')
    } catch {
      return undefined
    }
  }, [valueText])

  async function fund() {
    if (!wallet.account || !process || !fundQuote) return
    setPending(true)
    setMessage('')
    try {
      await sendAction({
        type: 'transfer',
        kind: 'estimate',
        account: wallet.account,
        to: process.address,
        functionName: 'transfer',
        value: FUND,
        quote: fundQuote,
        action: 'fund Kernel process key',
      })
      setMessage('process key funded with 0.05 MON')
      await refreshProcess()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function run(scenario: KernelScenario, confirmed = false) {
    if (!address || !process || parsedValue == null) return
    if (scenario === 'burst-naive' && !confirmed) {
      // In-OS dialog instead of window.confirm (off-brand, and blocked in some embedded browsers).
      setNaiveConfirm(true)
      return
    }
    setPending(true)
    setMessage('')
    try {
      const result = await runKernelScenario(process, address, scenario, parsedValue, failOptional)
      setLines(buildKernelLines(result, R3TARDS_KERNEL_DEBUGGER_ABI))
      if (result.runSendError && !result.runReceipt) setMessage(result.runSendError)
      await refreshProcess()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function withdraw() {
    if (!address || !process) return
    setPending(true)
    setMessage('')
    try {
      const receipt = await withdrawProcessCredits(process, address)
      setMessage(`credits withdrawn to process key in block ${receipt.blockNumber}`)
      await refreshProcess()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function sweep() {
    if (!process || !wallet.account) return
    setPending(true)
    setMessage('')
    try {
      const receipt = await sweepProcessKey(process, wallet.account)
      setMessage(`process-key MON swept back in block ${receipt.blockNumber}`)
      await refreshProcess()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  if (missing)
    return (
      <div className="monadhw-program">
        <p>Kernel Debugger is not deployed on this network.</p>
      </div>
    )

  return (
    <div className="monadhw-program kernel-program">
      <IntroBar
        lead="watch Monad decide whether an execution can commit."
        monad="MIP-4 exposes the reserve condition so a transaction can isolate a step, check, and unwind before commit."
        rules={RULES}
        finalLine="deferred means not done in this transaction: value was returned. collecting it later still needs another user-signed transaction."
      />
      <HardwareBus highlight={['execution']} />
      <div className="monadhw-scroll kernel-layout">
        <GroupBox title="Process key">
          {!wallet.account ? (
            <p>connect a wallet first.</p>
          ) : !process ? (
            <>
              <p>
                this creates a separate throwaway key in localStorage. it is not your Paint live-mode burner
                and its private key is never displayed.
              </p>
              <Button
                onClick={() => {
                  try {
                    const next = createProcessKey(wallet.account!)
                    setProcess(next)
                    setMessage('process key created')
                  } catch (error) {
                    setMessage(errorText(error))
                  }
                }}
              >
                Create process key
              </Button>
            </>
          ) : (
            <>
              <div className="hw-stat-grid">
                <span>address</span>
                <code>{shortAddress(process.address)}</code>
                <span>balance</span>
                <b>{Number(formatEther(balance)).toFixed(6)} MON</b>
                <span>contract credits</span>
                <b>{Number(formatEther(credits)).toFixed(6)} MON</b>
                <span>reserve target</span>
                <b>stay under 10 MON</b>
              </div>
              <p className="hw-note">
                0.05 MON is deliberately tiny. the key must remain below 10 MON for the reserve demonstration
                to be meaningful.
              </p>
              <div className="hw-toolbar">
                <Button disabled={pending || !fundQuote} onClick={() => void fund()}>
                  Fund 0.05 MON
                </Button>
                <span>{fundQuote?.maxCost ?? 'quoting…'}</span>
                <Button disabled={pending || credits === 0n} onClick={() => void withdraw()}>
                  Withdraw credits
                </Button>
                <Button disabled={pending || balance === 0n} onClick={() => void sweep()}>
                  Sweep back
                </Button>
              </div>
            </>
          )}
        </GroupBox>

        <GroupBox title="Scenarios">
          <div className="kernel-controls">
            <label>
              value
              <input
                value={valueText}
                onChange={(event) => setValueText(event.target.value)}
                inputMode="decimal"
              />{' '}
              MON
            </label>
            <label>
              <input
                type="checkbox"
                checked={failOptional}
                onChange={(event) => setFailOptional(event.target.checked)}
              />
              make optional step fail
            </label>
          </div>
          <div className="kernel-scenarios">
            <Button disabled={pending || !process || parsedValue == null} onClick={() => void run('single')}>
              SINGLE
            </Button>
            <Button
              disabled={pending || !process || parsedValue == null}
              onClick={() => void run('burst-graceful')}
            >
              BURST GRACEFUL
            </Button>
            <Button
              disabled={pending || !process || parsedValue == null}
              onClick={() => void run('burst-naive')}
            >
              BURST NAIVE
            </Button>
          </div>
          <small>
            fixed limits: ping {KERNEL_PING_GAS.toString()} · run {KERNEL_RUN_GAS.toString()}. estimateGas is
            intentionally not used for these two calls.
          </small>
        </GroupBox>

        <div className="kernel-screen sunken" aria-live="polite">
          {lines.map((line, index) => (
            <div key={`${index}-${line}`}>{line}</div>
          ))}
        </div>
        {message && <p className="hw-message">{message}</p>}
      </div>
      {naiveConfirm && (
        <MessageBox
          kind="warning"
          title="BURST NAIVE"
          message={`This run leaves the reserve dip uncorrected on purpose. On Monad it is expected to revert at the end of the transaction, and the full ${KERNEL_RUN_GAS.toLocaleString('en-US')} gas limit is still charged.`}
          defaultLabel="Run it"
          onDefault={() => void run('burst-naive', true)}
          onCancel={() => setNaiveConfirm(false)}
          onClose={() => setNaiveConfirm(false)}
        />
      )}
    </div>
  )
}
