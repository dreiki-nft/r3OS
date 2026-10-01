import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { formatEther, isAddress, parseEther, toHex, type Address, type Hex } from 'viem'
import { publicClient } from '../chain/clients'
import { readHeavy, readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { readSystemEventNow } from '../chain/systemEvent'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import {
  R3TARDS_CARD_MEMORY_ABI,
  R3TARDS_KERNEL_DEBUGGER_ABI,
  R3TARDS_OPERATOR_RECORD_ABI,
} from '../lib/generated/abi'
import { errorText, labAddress, shortAddress } from '../labs/labCommon'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import { MessageBox } from '../os/ui/MessageBox'
import { KERNEL_OPERATOR_COPY } from '../operator/copy'
import {
  loadRouterEnvironment,
  runCompare,
  tokenMetadata,
  traceLines,
  venueCodeInfo,
} from '../router/routerLab'
import { formatAmount, parseAmount, venuesForPair, type RouterVenue } from '../router/venues'
import {
  buildKernelLines,
  formatDeviceLines,
  formatDumpLines,
  formatEventLines,
  formatOperatorStorageLines,
  normalizeKernelOperatorRecord,
  operatorObservedLines,
  operatorStorageVerificationLine,
  parseKernelCommand,
  storageVerificationLine,
  type KernelCardInfo,
} from './kernel'
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

async function kernelToken(symbol: string, venues: readonly RouterVenue[]) {
  const addresses = Array.from(
    new Set(venues.flatMap((venue) => [venue.token0, venue.token1]).map((value) => value.toLowerCase())),
  )
  const metas = await Promise.all(addresses.map((value) => tokenMetadata(value as Address)))
  const found = metas.find((meta) => meta.symbol.toUpperCase() === symbol.toUpperCase())
  if (!found) throw new Error(`unknown router token: ${symbol}`)
  return found
}

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
  const [cardDriver, setCardDriver] = useState<Address>()
  const [operatorDriver, setOperatorDriver] = useState<Address>()
  const [command, setCommand] = useState('')
  const [lastCommand, setLastCommand] = useState('')

  useEffect(() => {
    void labAddress('kernel-debugger')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  useEffect(() => {
    void labAddress('card-drv')
      .then(setCardDriver)
      .catch(() => setCardDriver(undefined))
  }, [])

  useEffect(() => {
    void labAddress('operator-record')
      .then(setOperatorDriver)
      .catch(() => setOperatorDriver(undefined))
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

  async function executeCommand() {
    const parsed = parseKernelCommand(command)
    const echo = `C:\\KERNEL>${command}`
    setLastCommand(command)
    setCommand('')
    if (parsed.kind === 'cls') {
      setLines([])
      return
    }
    if (parsed.kind === 'help') {
      setLines((current) => [
        ...current,
        echo,
        'help',
        'cls',
        'device <id>',
        'dump <id> [word] [count]',
        KERNEL_OPERATOR_COPY.eventCommand,
        KERNEL_OPERATOR_COPY.operatorCommand,
        'venues [IN] [OUT]',
        'route <amount> <IN> <OUT>',
        'quote <label|0xadapter> <amount> <IN> <OUT>',
      ])
      return
    }
    if (parsed.kind === 'error') {
      setLines((current) => [...current, echo, parsed.message])
      return
    }
    if (parsed.kind === 'event') {
      try {
        const snapshot = await readSystemEventNow()
        setLines((current) => [...current, echo, ...formatEventLines(snapshot)])
      } catch (error) {
        setLines((current) => [...current, echo, errorText(error)])
      }
      return
    }
    if (parsed.kind === 'operator') {
      const target = parsed.address ?? wallet.account
      if (!target) {
        setLines((current) => [...current, echo, KERNEL_OPERATOR_COPY.connectOrAddress])
        return
      }
      if (!operatorDriver || !publicClient) {
        setLines((current) => [...current, echo, KERNEL_OPERATOR_COPY.driverMissing])
        return
      }
      try {
        const driver = operatorDriver
        const client = publicClient
        const rows = await readMany(
          [
            { address: driver, abi: R3TARDS_OPERATOR_RECORD_ABI, functionName: 'recordOf', args: [target] },
            {
              address: driver,
              abi: R3TARDS_OPERATOR_RECORD_ABI,
              functionName: 'recordBaseSlot',
              args: [target],
            },
          ],
          { allowFailure: false },
        )
        const record = normalizeKernelOperatorRecord(rows[0])
        const base = BigInt(rows[1] as bigint)
        const wordIndexes = [0, 1, ...Array.from({ length: 16 }, (_, index) => 16 + index)]
        const storageRows = await readHeavy(
          wordIndexes.map((word) => ({
            run: () =>
              client.getStorageAt({ address: driver, slot: toHex(base + BigInt(word), { size: 32 }) }),
          })),
          { concurrency: 4 },
        )
        const entries = wordIndexes.map((word, index) => ({
          word,
          value:
            storageRows[index]?.status === 'success' ? String(storageRows[index].result ?? '0x') : undefined,
        }))
        setLines((current) => [
          ...current,
          echo,
          ...operatorObservedLines(record),
          ...formatOperatorStorageLines(base, entries),
          operatorStorageVerificationLine(record, entries[0]?.value),
        ])
      } catch (error) {
        setLines((current) => [...current, echo, errorText(error)])
      }
      return
    }

    if (parsed.kind === 'venues' || parsed.kind === 'route' || parsed.kind === 'quote') {
      try {
        const env = await loadRouterEnvironment()
        if (!env.lab) {
          setLines((current) => [...current, echo, 'router-lab driver not installed'])
          return
        }
        if (!env.venues.length && parsed.kind !== 'quote') {
          setLines((current) => [...current, echo, 'no router venues configured'])
          return
        }
        if (parsed.kind === 'venues') {
          let listed = env.venues
          if (parsed.tokenIn && parsed.tokenOut) {
            const input = await kernelToken(parsed.tokenIn, env.venues)
            const output = await kernelToken(parsed.tokenOut, env.venues)
            listed = venuesForPair(input.address, output.address, env.venues)
          }
          const entries = await Promise.all(
            listed.map(async (venue) => {
              const code = await venueCodeInfo(venue)
              return `${venue.label.padEnd(22)} ${venue.adapter}  ${code.state}`
            }),
          )
          setLines((current) => [...current, echo, 'ROUTER VENUES', ...entries])
          return
        }
        const input = await kernelToken(parsed.tokenIn, env.venues)
        const output = await kernelToken(parsed.tokenOut, env.venues)
        const amountIn = parseAmount(parsed.amount, input.decimals)
        let selectedVenues = venuesForPair(input.address, output.address, env.venues)
        if (parsed.kind === 'quote') {
          const byLabel = env.venues.find((venue) => venue.label.toLowerCase() === parsed.venue.toLowerCase())
          if (byLabel) selectedVenues = [byLabel]
          else if (isAddress(parsed.venue)) {
            selectedVenues = [
              {
                label: 'unlisted',
                adapter: parsed.venue as Address,
                token0: input.address,
                token1: output.address,
                source: 'unlisted',
              },
            ]
          } else throw new Error(`unknown venue: ${parsed.venue}`)
        }
        if (!selectedVenues.length) throw new Error('no venues for pair')
        const comparison = await runCompare({
          lab: env.lab,
          tokenIn: input.address,
          tokenOut: output.address,
          amountIn,
          venues: selectedVenues.slice(0, 8),
          gasPerFrame: 2_000_000n,
          probeStatic: true,
        })
        const outputLines = traceLines({
          comparison,
          venues: selectedVenues.slice(0, 8),
          tokenInSymbol: input.symbol,
          tokenOutSymbol: output.symbol,
          amountText: parsed.amount,
          outputDecimals: output.decimals,
          formatOutput: formatAmount,
        })
        setLines((current) => [...current, echo, ...outputLines])
      } catch (error) {
        setLines((current) => [...current, echo, errorText(error)])
      }
      return
    }
    if (!cardDriver || !publicClient) {
      setLines((current) => [...current, echo, 'CARD.DRV not installed'])
      return
    }
    try {
      if (parsed.kind === 'device') {
        const rows = await readMany(
          [
            {
              address: cardDriver,
              abi: R3TARDS_CARD_MEMORY_ABI,
              functionName: 'cardInfo',
              args: [parsed.cardId],
            },
            {
              address: cardDriver,
              abi: R3TARDS_CARD_MEMORY_ABI,
              functionName: 'pageHash',
              args: [parsed.cardId],
            },
          ],
          { allowFailure: false },
        )
        const raw = rows[0] as any
        const info: KernelCardInfo = {
          owner: raw.owner ?? raw[0],
          exists: Boolean(raw.exists ?? raw[1]),
          pageBaseSlot: BigInt(raw.pageBaseSlot ?? raw[2]),
          pageIndex: BigInt(raw.pageIndex ?? raw[3]),
          formatted: Boolean(raw.formatted ?? raw[4]),
          version: Number(raw.version ?? raw[5]),
          writes: Number(raw.writes ?? raw[6]),
          firstWriteBlock: BigInt(raw.firstWriteBlock ?? raw[7]),
          lastWriteBlock: BigInt(raw.lastWriteBlock ?? raw[8]),
        }
        setLines((current) => [
          ...current,
          echo,
          ...formatDeviceLines(parsed.cardId, info, rows[1] as string),
        ])
        return
      }

      const dumpRows = await readHeavy([
        {
          address: cardDriver,
          abi: R3TARDS_CARD_MEMORY_ABI,
          functionName: 'readWords',
          args: [parsed.cardId, BigInt(parsed.word), BigInt(parsed.count)],
        },
        {
          address: cardDriver,
          abi: R3TARDS_CARD_MEMORY_ABI,
          functionName: 'readPage',
          args: [parsed.cardId],
        },
      ])
      if (dumpRows[0]?.status !== 'success') throw dumpRows[0]?.error ?? new Error('dump failed')
      if (dumpRows[1]?.status !== 'success') throw dumpRows[1]?.error ?? new Error('page verification failed')
      const base = BigInt(
        (
          await readMany(
            [
              {
                address: cardDriver,
                abi: R3TARDS_CARD_MEMORY_ABI,
                functionName: 'pageBaseSlot',
                args: [parsed.cardId],
              },
            ],
            { allowFailure: false },
          )
        )[0] as bigint,
      )
      const storage = await publicClient.getStorageAt({
        address: cardDriver,
        slot: toHex(base, { size: 32 }),
      })
      const page = dumpRows[1].result as readonly Hex[]
      setLines((current) => [
        ...current,
        echo,
        ...formatDumpLines(base, parsed.word, dumpRows[0].result as readonly string[]),
        storageVerificationLine(page[0], storage),
      ])
    } catch (error) {
      setLines((current) => [...current, echo, errorText(error)])
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
          <form
            className="kernel-command-line"
            onSubmit={(event) => {
              event.preventDefault()
              void executeCommand()
            }}
          >
            <span>C:\KERNEL&gt;</span>
            <input
              value={command}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCommand(lastCommand)
                }
              }}
            />
          </form>
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
