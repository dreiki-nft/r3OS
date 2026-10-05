export const PRIORITY_CONFIRM = 'YES_MAINNET_SPEND'
export const TRANSFER_GAS_LIMIT = 21_000n
const GWEI = 1_000_000_000n

export function priorityWei(gwei) {
  const value = Number(gwei)
  if (!Number.isFinite(value) || value < 0) throw new Error('invalid priority gwei')
  return BigInt(Math.round(value * 1_000_000_000))
}

export function buildPriorityPlan(baseFeePerGas, values = [0, 1, 2, 5]) {
  const base = BigInt(baseFeePerGas)
  return values.map((gwei) => {
    const priority = priorityWei(gwei)
    const maxFeePerGas = base * 2n + priority
    return {
      priorityGwei: Number(gwei),
      priorityFeePerGas: priority,
      maxFeePerGas,
      gasLimit: TRANSFER_GAS_LIMIT,
      maxCostWei: TRANSFER_GAS_LIMIT * maxFeePerGas,
    }
  })
}

export function assertSendGate({ send, confirmation, chainId }) {
  if (!send) return
  if (chainId !== 143) throw new Error('PRIORITY_BENCH_MAINNET_ONLY')
  if (confirmation !== PRIORITY_CONFIRM) throw new Error('PRIORITY_BENCH_EXPLICIT_CONFIRMATION_REQUIRED')
}

export function weiToMon(value) {
  const whole = value / 10n ** 18n
  const fraction = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

export function weiToGwei(value) {
  const whole = value / GWEI
  const fraction = (value % GWEI).toString().padStart(9, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}
