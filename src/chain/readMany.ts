import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, Hex } from 'viem'
import { publicClient } from './clients'
import { config } from './config'

export interface ReadManyCall {
  address: Address
  abi: Abi | readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

export type ReadManyResult =
  { status: 'success'; result: unknown } | { status: 'failure'; error: Error; result?: undefined }

let multicallCheck: Promise<Address | undefined> | undefined

async function usableMulticall3() {
  if (!publicClient || !config.multicall3Address) return undefined
  if (!multicallCheck) {
    multicallCheck = publicClient
      .getCode({ address: config.multicall3Address })
      .then((code: Hex | undefined) => (code && code !== '0x' ? config.multicall3Address : undefined))
      .catch(() => undefined)
  }
  return multicallCheck
}

async function fallbackRead(client: any, call: ReadManyCall): Promise<ReadManyResult> {
  try {
    const result = await client.readContract({
      address: call.address,
      abi: call.abi as Abi,
      functionName: call.functionName as ContractFunctionName<Abi>,
      args: (call.args ?? []) as ContractFunctionArgs<Abi>,
    })
    return { status: 'success', result }
  } catch (error) {
    return { status: 'failure', error: error instanceof Error ? error : new Error(String(error)) }
  }
}

export async function readManyUsing(
  client: any,
  calls: readonly ReadManyCall[],
  options: { allowFailure?: boolean; multicallAddress?: Address } = {},
) {
  const allowFailure = options.allowFailure ?? true
  if (!calls.length) return []

  if (options.multicallAddress) {
    const result = await client.multicall({
      contracts: calls,
      allowFailure: true,
      multicallAddress: options.multicallAddress,
    })
    if (!allowFailure) {
      const failed = result.find((item: any) => item.status === 'failure')
      if (failed) throw failed.error
      return result.map((item: any) => item.result)
    }
    return result
  }

  const result = await Promise.all(calls.map((call) => fallbackRead(client, call)))
  if (!allowFailure) {
    const failed = result.find((item) => item.status === 'failure')
    if (failed?.status === 'failure') throw failed.error
    return result.map((item) => (item as { status: 'success'; result: unknown }).result)
  }
  return result
}

/** One batched-read path for Labs, with a Multicall3 code check and a parallel fallback. */
export async function readMany(calls: readonly ReadManyCall[], options: { allowFailure?: boolean } = {}) {
  if (!publicClient) throw new Error('DEMO_MODE')
  return readManyUsing(publicClient, calls, {
    ...options,
    multicallAddress: await usableMulticall3(),
  })
}

export function __resetReadManyForTests() {
  multicallCheck = undefined
}
