import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionResult, type Address, type Hex } from 'viem'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import {
  __setBootPacketForTests,
  buildBootPacketRequests,
  decodeBootPacket,
  fetchBootPacketUsing,
} from './bootPacket'

const paint = '0x00000000000000000000000000000000000000aa' as Address
const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11' as Address
const pass = '0x0000000000000000000000000000000000000009' as Address
const r3tards = '0x0000000000000000000000000000000000000008' as Address

function encoded(functionName: string, result: unknown): Hex {
  return encodeFunctionResult({ abi: R3OS_PAINT_ABI, functionName: functionName as never, result: result as never })
}

afterEach(() => {
  vi.unstubAllGlobals()
  __setBootPacketForTests(undefined)
})

describe('boot packet', () => {
  it('packs chain identity, code checks and the five registry/status calls into ten members', () => {
    const entries = buildBootPacketRequests(paint, multicall)
    expect(entries).toHaveLength(10)
    expect(entries.map((entry) => entry.request.method)).toEqual([
      'eth_chainId',
      'eth_blockNumber',
      'web3_clientVersion',
      'eth_getCode',
      'eth_getCode',
      'eth_call',
      'eth_call',
      'eth_call',
      'eth_call',
      'eth_call',
    ])
  })

  it('decodes unordered JSON-RPC batch responses by id', () => {
    const entries = buildBootPacketRequests(paint, multicall)
    const resultFor = (key: string) => {
      switch (key) {
        case 'chainId': return '0x8f'
        case 'blockNumber': return '0x1234'
        case 'clientVersion': return 'Monad/0.16.4'
        case 'paintCode': return '0x6001'
        case 'multicallCode': return '0x6002'
        case 'painterPass': return encoded('painterPass', pass)
        case 'r3tards': return encoded('R3TARDS', r3tards)
        case 'experimentCount': return encoded('experimentCount', 7n)
        case 'renderersFrozen': return encoded('renderersFrozen', false)
        case 'experimentsFrozen': return encoded('experimentsFrozen', true)
        default: return undefined
      }
    }
    const responses = entries
      .map((entry) => ({ id: entry.request.id, result: resultFor(entry.key) }))
      .reverse()
    const decoded = decodeBootPacket(entries, responses, { elapsedMs: 175, httpRequests: 1, paintAddress: paint })
    expect(decoded).toMatchObject({
      chainId: 143,
      blockNumber: 0x1234n,
      clientVersion: 'Monad/0.16.4',
      painterPass: pass,
      r3tards,
      experimentCount: 7,
      renderersFrozen: false,
      experimentsFrozen: true,
      complete: true,
      memberCount: 10,
      httpRequests: 1,
    })
  })

  it('splits a rejected batch and preserves the decoded packet', async () => {
    let requests = 0
    const entries = buildBootPacketRequests(paint, multicall)
    const keyById = new Map(entries.map((entry) => [entry.request.id, entry.key]))
    const resultFor = (key: string) => {
      switch (key) {
        case 'chainId': return '0x8f'
        case 'blockNumber': return '0x1234'
        case 'clientVersion': return 'Monad/test'
        case 'paintCode': return '0x6001'
        case 'multicallCode': return '0x6002'
        case 'painterPass': return encoded('painterPass', pass)
        case 'r3tards': return encoded('R3TARDS', r3tards)
        case 'experimentCount': return encoded('experimentCount', 2n)
        case 'renderersFrozen': return encoded('renderersFrozen', false)
        case 'experimentsFrozen': return encoded('experimentsFrozen', false)
        default: return '0x'
      }
    }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests += 1
      const body = JSON.parse(String(init?.body)) as Array<{ id: number }>
      if (body.length > 5) return new Response('too large', { status: 413 })
      return Response.json(
        body.map((member) => ({ jsonrpc: '2.0', id: member.id, result: resultFor(keyById.get(member.id) ?? '') })),
      )
    }))

    const value = await fetchBootPacketUsing('https://example.invalid', {
      paintAddress: paint,
      multicallAddress: multicall,
      batchSize: 10,
    })
    expect(requests).toBeGreaterThan(1)
    expect(value.chainId).toBe(143)
    expect(value.complete).toBe(true)
    expect(value.httpRequests).toBeGreaterThan(1)
  })
})
