import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { validateBootBatch } from '../edge/fastlane-worker/src/index.js'

const paint = '0x00000000000000000000000000000000000000aa'
const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11'
const origin = 'https://r3os.example'

function bootBatch() {
  const selector = (index: number) => `0x${String(index).padStart(8, '0')}`
  return [
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
    { jsonrpc: '2.0', id: 3, method: 'web3_clientVersion', params: [] },
    { jsonrpc: '2.0', id: 4, method: 'eth_getCode', params: [paint, 'latest'] },
    { jsonrpc: '2.0', id: 5, method: 'eth_getCode', params: [multicall, 'latest'] },
    ...Array.from({ length: 5 }, (_, index) => ({
      jsonrpc: '2.0',
      id: 6 + index,
      method: 'eth_call',
      params: [{ to: paint, data: selector(index + 1) }, 'latest'],
    })),
  ]
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    FASTLANE_RPC_URL: 'https://secret-fastlane.invalid/token',
    R3OS_ALLOWED_ORIGINS: origin,
    R3OS_PAINT_ADDRESS: paint,
    R3OS_MULTICALL3_ADDRESS: multicall,
    RPC_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    ...overrides,
  }
}

function request(body: unknown, requestOrigin = origin) {
  return new Request('https://edge.invalid/v1/boot-rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: requestOrigin },
    body: JSON.stringify(body),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('FastLane edge accelerator', () => {
  it('forwards only a valid boot packet and never exposes the secret URL to the browser', async () => {
    const upstream = bootBatch().map((row) => ({ jsonrpc: '2.0', id: row.id, result: '0x1' }))
    const fetchMock = vi.fn(async () => Response.json(upstream))
    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(request(bootBatch()), env() as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-r3os-accelerator')).toBe('fastlane-read')
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(await response.json()).toEqual(upstream)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://secret-fastlane.invalid/token')
    expect(JSON.stringify(upstream)).not.toContain('secret-fastlane')
  })

  it('rejects arbitrary RPC methods and targets before spending FastLane quota', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const rateLimiter = { limit: vi.fn(async () => ({ success: true })) }
    const payload = bootBatch()
    payload[5] = { jsonrpc: '2.0', id: 6, method: 'eth_sendRawTransaction', params: ['0xdeadbeef'] } as never

    const response = await worker.fetch(request(payload), env({ RPC_RATE_LIMITER: rateLimiter }) as never)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rateLimiter.limit).not.toHaveBeenCalled()
  })

  it('fails closed on origin, rate-limit and missing-binding problems', async () => {
    expect((await worker.fetch(request(bootBatch(), 'https://evil.invalid'), env() as never)).status).toBe(403)
    expect((await worker.fetch(request(bootBatch()), env({ RPC_RATE_LIMITER: undefined }) as never)).status).toBe(503)
    expect((await worker.fetch(request(bootBatch()), env({ RPC_RATE_LIMITER: { limit: async () => ({ success: false }) } }) as never)).status).toBe(429)
  })

  it('requires the exact ten-member read-only boot shape', () => {
    expect(validateBootBatch(bootBatch(), env())).toEqual({ ok: true })
    expect(validateBootBatch(bootBatch().slice(0, 9), env())).toMatchObject({ ok: false })
    const wrongTarget = bootBatch()
    const codeParams = wrongTarget[3].params as unknown[]
    codeParams[0] = '0x00000000000000000000000000000000000000bb'
    expect(validateBootBatch(wrongTarget, env())).toMatchObject({ ok: false })
  })
})
