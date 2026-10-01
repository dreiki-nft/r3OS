import {
  createWalletClient,
  encodeFunctionData,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { appChain, appTransport, publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { R3TARDS_KERNEL_DEBUGGER_ABI } from '../lib/generated/abi'

export interface ProcessKeyRecord {
  privateKey: Hex
  address: Address
  createdAt: number
}

export type KernelScenario = 'single' | 'burst-graceful' | 'burst-naive'

export interface KernelScenarioResult {
  scenario: KernelScenario
  pingReceipt?: TransactionReceipt
  runReceipt?: TransactionReceipt
  runHash?: Hex
  runSendError?: string
  gasLimit: bigint
}

export const KERNEL_PING_GAS = 40_000n
export const KERNEL_RUN_GAS = 160_000n

export function processKeyStorageKey(owner: Address, chainId = config.chainId) {
  return `r3os.kernel.key.${chainId}.${owner.toLowerCase()}`
}

function validRecord(value: unknown): value is ProcessKeyRecord {
  const record = value as Partial<ProcessKeyRecord> | null
  return Boolean(
    record &&
    typeof record.privateKey === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(record.privateKey) &&
    typeof record.address === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(record.address) &&
    typeof record.createdAt === 'number',
  )
}

export function loadProcessKey(owner: Address, chainId = config.chainId) {
  try {
    const raw = localStorage.getItem(processKeyStorageKey(owner, chainId))
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    return validRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function createProcessKey(owner: Address, chainId = config.chainId) {
  const existing = loadProcessKey(owner, chainId)
  if (existing) return existing
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const record: ProcessKeyRecord = { privateKey, address: account.address, createdAt: Date.now() }
  localStorage.setItem(processKeyStorageKey(owner, chainId), JSON.stringify(record))
  return record
}

export function deleteProcessKey(owner: Address, chainId = config.chainId) {
  try {
    localStorage.removeItem(processKeyStorageKey(owner, chainId))
  } catch {
    // Storage can be blocked; the caller will see the old record if removal failed.
  }
}

function processWallet(record: ProcessKeyRecord) {
  const account = privateKeyToAccount(record.privateKey)
  return {
    account,
    wallet: createWalletClient({ account, chain: appChain, transport: appTransport }),
  }
}

async function feeQuote() {
  if (!publicClient) throw new Error('DEMO_MODE')
  const raw = await publicClient.estimateFeesPerGas()
  const fees = raw as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }
  return {
    maxFeePerGas: fees.maxFeePerGas ?? fees.gasPrice ?? 0n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
  }
}

async function sendKernelTx(
  record: ProcessKeyRecord,
  kernel: Address,
  functionName: 'ping' | 'run' | 'withdraw',
  args: readonly unknown[],
  gas: bigint,
  value: bigint,
  nonce: number,
  fees: Awaited<ReturnType<typeof feeQuote>>,
) {
  const { account, wallet } = processWallet(record)
  const data = encodeFunctionData({
    abi: R3TARDS_KERNEL_DEBUGGER_ABI,
    functionName,
    args,
  } as any)
  return wallet.sendTransaction({
    account,
    chain: appChain,
    to: kernel,
    data,
    value,
    gas,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
}

export async function runKernelScenario(
  record: ProcessKeyRecord,
  kernel: Address,
  scenario: KernelScenario,
  value: bigint,
  failOptional: boolean,
): Promise<KernelScenarioResult> {
  if (!publicClient) throw new Error('DEMO_MODE')
  const client = publicClient
  const fees = await feeQuote()
  const nonce = await client.getTransactionCount({ address: record.address, blockTag: 'pending' })
  const graceful = scenario !== 'burst-naive'

  if (scenario === 'single') {
    let runHash: Hex | undefined
    try {
      runHash = await sendKernelTx(
        record,
        kernel,
        'run',
        [graceful, failOptional],
        KERNEL_RUN_GAS,
        value,
        nonce,
        fees,
      )
      const runReceipt = await client.waitForTransactionReceipt({ hash: runHash, pollingInterval: 250 })
      return { scenario, runHash, runReceipt, gasLimit: KERNEL_RUN_GAS }
    } catch (error) {
      return {
        scenario,
        runHash,
        runSendError: error instanceof Error ? error.message : String(error),
        gasLimit: KERNEL_RUN_GAS,
      }
    }
  }

  const pingHash = await sendKernelTx(record, kernel, 'ping', [], KERNEL_PING_GAS, 0n, nonce, fees)
  let runHash: Hex | undefined
  let runSendError: string | undefined
  try {
    // Intentionally submit nonce n+1 before waiting for nonce n's receipt.
    runHash = await sendKernelTx(
      record,
      kernel,
      'run',
      [graceful, failOptional],
      KERNEL_RUN_GAS,
      value,
      nonce + 1,
      fees,
    )
  } catch (error) {
    runSendError = error instanceof Error ? error.message : String(error)
  }

  const pingReceiptPromise = client.waitForTransactionReceipt({ hash: pingHash, pollingInterval: 250 })
  const runReceiptPromise = runHash
    ? client.waitForTransactionReceipt({ hash: runHash, pollingInterval: 250 }).catch(() => undefined)
    : Promise.resolve(undefined)
  const [pingReceipt, runReceipt] = await Promise.all([pingReceiptPromise, runReceiptPromise])
  return { scenario, pingReceipt, runReceipt, runHash, runSendError, gasLimit: KERNEL_RUN_GAS }
}

export async function sweepProcessKey(record: ProcessKeyRecord, owner: Address) {
  if (!publicClient) throw new Error('DEMO_MODE')
  const client = publicClient
  const fees = await feeQuote()
  const balance = await client.getBalance({ address: record.address })
  const gas = 21_000n
  const reserve = gas * fees.maxFeePerGas
  if (balance <= reserve) throw new Error('process key balance is too low to sweep')
  const nonce = await client.getTransactionCount({ address: record.address, blockTag: 'pending' })
  const { account, wallet } = processWallet(record)
  const hash = await wallet.sendTransaction({
    account,
    chain: appChain,
    to: owner,
    value: balance - reserve,
    gas,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  return client.waitForTransactionReceipt({ hash, pollingInterval: 250 })
}

export async function withdrawProcessCredits(record: ProcessKeyRecord, kernel: Address) {
  if (!publicClient) throw new Error('DEMO_MODE')
  const client = publicClient
  const fees = await feeQuote()
  const { account } = processWallet(record)
  const data = encodeFunctionData({
    abi: R3TARDS_KERNEL_DEBUGGER_ABI,
    functionName: 'withdraw',
  })
  const estimate = await client.estimateGas({ account: account.address, to: kernel, data })
  const gas = (estimate * 110n + 99n) / 100n
  const nonce = await client.getTransactionCount({ address: record.address, blockTag: 'pending' })
  const hash = await sendKernelTx(record, kernel, 'withdraw', [], gas, 0n, nonce, fees)
  return client.waitForTransactionReceipt({ hash, pollingInterval: 250 })
}

export function receiptLogs(receipt?: TransactionReceipt): readonly Log[] {
  return receipt?.logs ?? []
}
