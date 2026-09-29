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
): Promise<any[]> {
  const allowFailure = options.allowFailure ?? true
  if (!calls.length) return []
  let chunks: ReadManyResult[]

  if (options.multicallAddress) {
    chunks = []
    for (let i = 0; i < calls.length; i += 100) {
      const part = calls.slice(i, i + 100)
      const result = await client.multicall({
        contracts: part,
        allowFailure: true,
        multicallAddress: options.multicallAddress,
      })
      chunks.push(...result)
    }
  } else {
    chunks = await Promise.all(calls.map((call) => fallbackRead(client, call)))
  }

  if (!allowFailure) {
    const failed = chunks.find((item) => item.status === 'failure')
    if (failed?.status === 'failure') throw failed.error
    return chunks.map((item) => (item as { status: 'success'; result: unknown }).result)
  }
  return chunks
}

/** One bounded-read path for ordinary reads. Multicalls are split into at most 100 calls. */
export async function readMany(calls: readonly ReadManyCall[], options: { allowFailure?: boolean } = {}) {
  if (!publicClient) throw new Error('DEMO_MODE')
  return readManyUsing(publicClient, calls, {
    ...options,
    multicallAddress: await usableMulticall3(),
  })
}

export async function readHeavyUsing(
  client: any,
  calls: readonly ReadManyCall[],
  options: { concurrency?: number } = {},
) {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2))
  const results: ReadManyResult[] = new Array(calls.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor++
      if (index >= calls.length) return
      results[index] = await fallbackRead(client, calls[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, calls.length) }, () => worker()))
  return results
}

/** Heavy art/metadata reads are individual eth_call requests with bounded concurrency. */
export async function readHeavy(calls: readonly ReadManyCall[], options: { concurrency?: number } = {}) {
  if (!publicClient) throw new Error('DEMO_MODE')
  return readHeavyUsing(publicClient, calls, options)
}

export function __resetReadManyForTests() {
  multicallCheck = undefined
}
