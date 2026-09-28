import { type Address, type Hex } from 'viem'
import { buildStartSessionTypedData, type StartSessionMessage } from '../live/liveStore'

export const SLEEPWALKER_MAX_STENCIL_PIXELS = 4_096
export const SLEEPWALKER_STEP_MAX_PX = 64
export const SLEEPWALKER_STEP_GAS_LIMIT = 1_000_000n

export interface SessionPlan extends StartSessionMessage {}

export interface SignedSession {
  expiryBlock: bigint
  maxUnits: bigint
  nonce: bigint
  deadline: bigint
  sig: Hex
}

export function planSleepwalkerSessions({
  owner,
  sessionKey,
  block,
  nonce,
  count,
  maxSessionBlocks,
  maxUnits,
  deadline,
}: {
  owner: Address
  sessionKey: Address
  block: bigint
  nonce: bigint
  count: number
  maxSessionBlocks: bigint
  maxUnits: bigint
  deadline: bigint
}) {
  if (count < 1 || count > 4) throw new Error('session count must be 1–4')
  if (maxSessionBlocks <= 0n) throw new Error('MAX_SESSION_BLOCKS must be positive')
  const firstExpiry = block + maxSessionBlocks
  return Array.from({ length: count }, (_, index): SessionPlan => ({
    owner,
    sessionKey,
    expiryBlock: firstExpiry + BigInt(index) * maxSessionBlocks,
    maxUnits,
    nonce: nonce + BigInt(index),
    deadline,
  }))
}

export function sleepwalkerTypedData(plan: SessionPlan) {
  return buildStartSessionTypedData(plan)
}

export function decodeStencilRuns(runs: Hex) {
  const clean = runs.slice(2)
  if (clean.length % 8 !== 0) throw new Error('invalid stencil run bytes')
  const decoded: { y: number; x0: number; x1: number; colour: number }[] = []
  let pixels = 0
  for (let offset = 0; offset < clean.length; offset += 8) {
    const y = Number.parseInt(clean.slice(offset, offset + 2), 16)
    const x0 = Number.parseInt(clean.slice(offset + 2, offset + 4), 16)
    const x1 = Number.parseInt(clean.slice(offset + 4, offset + 6), 16)
    const colour = Number.parseInt(clean.slice(offset + 6, offset + 8), 16)
    if (x1 < x0 || colour > 15) throw new Error('invalid stencil run')
    decoded.push({ y, x0, x1, colour })
    pixels += x1 - x0 + 1
  }
  return { runs: decoded, pixels }
}

export function buildSleepwalkerStencil(runs: Hex, cap = SLEEPWALKER_MAX_STENCIL_PIXELS) {
  const decoded = decodeStencilRuns(runs)
  if (decoded.pixels === 0) throw new Error('draw something first')
  if (decoded.pixels > cap) throw new Error(`dream stencils are capped at ${cap.toLocaleString()} px`)
  return { hex: runs, pixels: decoded.pixels, runs: decoded.runs }
}

export interface DreamtLike {
  cursorFrom: bigint | number
  cursorTo: bigint | number
  pixels: bigint | number
  blockNumber: bigint | number
}

export function orderDreamt(events: readonly DreamtLike[]) {
  return [...events].sort((a, b) => {
    const block = BigInt(a.blockNumber) - BigInt(b.blockNumber)
    if (block !== 0n) return block < 0n ? -1 : 1
    const cursor = BigInt(a.cursorFrom) - BigInt(b.cursorFrom)
    return cursor < 0n ? -1 : cursor > 0n ? 1 : 0
  })
}

export function cursorPixels(runs: Hex, cursor: number) {
  const decoded = decodeStencilRuns(runs).runs
  const result: { x: number; y: number; colour: number }[] = []
  let remaining = Math.max(0, cursor)
  for (const run of decoded) {
    const width = run.x1 - run.x0 + 1
    const take = Math.min(width, remaining)
    for (let x = run.x0; x < run.x0 + take; x++) result.push({ x, y: run.y, colour: run.colour })
    remaining -= take
    if (remaining <= 0) break
  }
  return result
}

export const STEP_CODE_MESSAGES = [
  'painted',
  'complete',
  'no dream',
  'no usable session yet',
  'stalled — fresh signatures needed',
  "hasn't painted today",
  'dream allowance used for today',
  'too soon — wait for the pace window',
  'no spendable paint budget',
  'core paint rejected',
] as const

export function stepCodeMessage(code: number, waitBlocks?: bigint) {
  if (code === 7 && waitBlocks != null && waitBlocks > 0n) return `too soon, wait ${waitBlocks} blocks`
  return STEP_CODE_MESSAGES[code] ?? `step result ${code}`
}

export function filterReadySleepers<T extends { owner: Address }>(
  sleepers: readonly T[],
  ready: readonly boolean[],
) {
  return sleepers.filter((_, index) => ready[index] === true)
}

export function estimateDreamSteps(pixels: number, stepMax = SLEEPWALKER_STEP_MAX_PX) {
  return pixels === 0 ? 0 : Math.ceil(pixels / stepMax)
}
