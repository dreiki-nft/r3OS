import { describe, expect, it } from 'vitest'
import worker, { sameSecret } from '../edge/fastlane-worker/src/index.js'

const origin = 'https://r3os.example'
const URL_ = 'https://edge.invalid/v1/agent-exe/scoreboard'

function kv() {
  const store = new Map<string, string>()
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  }
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    R3OS_ALLOWED_ORIGINS: origin,
    AGENT_EXE_PUBLISH_TOKEN: 'publish-secret-123',
    AGENT_EXE_REVEAL_AT: '0',
    AGENT_EXE_KV: kv(),
    ...overrides,
  }
}

const board = { game: 'AGENT.EXE', phase: 'battle', updatedAt: 1_793_880_000, health: { start: '1333', left: '1200', pct: 90 } }
const put = (body: unknown, token = 'publish-secret-123') =>
  new Request(URL_, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = () => new Request(URL_, { headers: { origin } })

describe('AGENT.EXE scoreboard route', () => {
  it('stores a published scoreboard and serves it to allowed origins', async () => {
    const e = env()
    expect((await worker.fetch(put(board), e)).status).toBe(200)
    const res = await worker.fetch(get(), e)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
    expect(await res.json()).toMatchObject({ game: 'AGENT.EXE', phase: 'battle' })
  })

  it('rejects publishes without the right token, oversized bodies and the wrong shape', async () => {
    const e = env()
    expect((await worker.fetch(put(board, 'wrong'), e)).status).toBe(401)
    expect((await worker.fetch(new Request(URL_, { method: 'PUT', body: JSON.stringify(board) }), e)).status).toBe(401)
    expect((await worker.fetch(put({ game: 'OTHER', updatedAt: 1 }), e)).status).toBe(400)
    expect((await worker.fetch(put({ game: 'AGENT.EXE', updatedAt: 1, pad: 'x'.repeat(300_000) }), e)).status).toBe(413)
    expect(e.AGENT_EXE_KV.store.size).toBe(0)
    expect((await worker.fetch(put(board), env({ AGENT_EXE_PUBLISH_TOKEN: '' }))).status).toBe(503)
  })

  it('stays a plain 404 before the reveal time, even with data stored', async () => {
    const e = env({ AGENT_EXE_REVEAL_AT: String(Math.floor(Date.now() / 1000) + 3600) })
    await worker.fetch(put(board), e)
    const res = await worker.fetch(get(), e)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' })
  })

  it('404 when nothing has been published yet; other methods refused', async () => {
    expect((await worker.fetch(get(), env())).status).toBe(404)
    expect((await worker.fetch(new Request(URL_, { method: 'POST', body: '{}' }), env())).status).toBe(405)
  })

  it('compares secrets in constant time and never accepts an empty one', () => {
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abd')).toBe(false)
    expect(sameSecret('abc', 'abcd')).toBe(false)
    expect(sameSecret('', '')).toBe(false)
  })
})
