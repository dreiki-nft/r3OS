import { decodeEventLog, type Hex } from 'viem'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'

export interface CoreLogLike {
  data: Hex
  topics: readonly Hex[]
}

export function decodeCoreEventLog(log: CoreLogLike) {
  return decodeEventLog({
    abi: R3TARDS_PAINT_ABI,
    data: log.data,
    topics: log.topics as [signature: Hex, ...args: Hex[]],
  })
}
