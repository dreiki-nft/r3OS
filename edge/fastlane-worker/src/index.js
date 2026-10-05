const BOOT_METHODS = [
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
]

const HEX_ADDRESS = /^0x[0-9a-f]{40}$/i
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/i
const MAX_BODY_BYTES = 16 * 1024

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function normalizeAddress(value) {
  return typeof value === 'string' && HEX_ADDRESS.test(value) ? value.toLowerCase() : ''
}

function allowedOrigins(env) {
  return new Set(
    String(env.R3OS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function corsHeaders(origin, env) {
  return allowedOrigins(env).has(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type',
        vary: 'Origin',
      }
    : { vary: 'Origin' }
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get('origin') || ''
  return origin && allowedOrigins(env).has(origin)
}

function validBaseMember(member, index) {
  return (
    member &&
    typeof member === 'object' &&
    member.jsonrpc === '2.0' &&
    (typeof member.id === 'number' || typeof member.id === 'string') &&
    member.method === BOOT_METHODS[index] &&
    Array.isArray(member.params)
  )
}

function validNoParam(member) {
  return member.params.length === 0
}

function validCodeRead(member, expectedAddress) {
  return (
    member.params.length === 2 &&
    normalizeAddress(member.params[0]) === normalizeAddress(expectedAddress) &&
    member.params[1] === 'latest'
  )
}

function validPaintCall(member, paintAddress) {
  if (member.params.length !== 2 || member.params[1] !== 'latest') return false
  const call = member.params[0]
  if (!call || typeof call !== 'object' || Array.isArray(call)) return false
  const keys = Object.keys(call)
  if (keys.some((key) => key !== 'to' && key !== 'data')) return false
  if (normalizeAddress(call.to) !== normalizeAddress(paintAddress)) return false
  // Boot calls are five no-argument view selectors. Exactly four selector bytes keeps this relay narrow.
  return typeof call.data === 'string' && HEX_DATA.test(call.data) && call.data.length === 10
}

export function validateBootBatch(payload, env) {
  const paint = normalizeAddress(env.R3OS_PAINT_ADDRESS)
  const multicall = normalizeAddress(env.R3OS_MULTICALL3_ADDRESS)
  if (!paint || !multicall) return { ok: false, code: 'EDGE_TARGETS_UNCONFIGURED' }
  if (!Array.isArray(payload) || payload.length !== BOOT_METHODS.length) {
    return { ok: false, code: 'EDGE_BOOT_BATCH_SHAPE' }
  }
  if (!payload.every((member, index) => validBaseMember(member, index))) {
    return { ok: false, code: 'EDGE_BOOT_BATCH_METHODS' }
  }
  if (!validNoParam(payload[0]) || !validNoParam(payload[1]) || !validNoParam(payload[2])) {
    return { ok: false, code: 'EDGE_BOOT_BATCH_PARAMS' }
  }
  if (!validCodeRead(payload[3], paint) || !validCodeRead(payload[4], multicall)) {
    return { ok: false, code: 'EDGE_BOOT_CODE_TARGET' }
  }
  for (let index = 5; index < payload.length; index += 1) {
    if (!validPaintCall(payload[index], paint)) return { ok: false, code: 'EDGE_BOOT_CALL_TARGET' }
  }
  const selectors = new Set(payload.slice(5).map((member) => member.params[0].data.toLowerCase()))
  if (selectors.size !== 5) return { ok: false, code: 'EDGE_BOOT_CALL_SELECTORS' }
  const ids = new Set(payload.map((member) => String(member.id)))
  if (ids.size !== payload.length) return { ok: false, code: 'EDGE_DUPLICATE_IDS' }
  return { ok: true }
}

async function parseJsonBody(request) {
  const length = Number(request.headers.get('content-length') || '0')
  if (length > MAX_BODY_BYTES) throw new Error('EDGE_BODY_TOO_LARGE')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('EDGE_BODY_TOO_LARGE')
  return JSON.parse(text)
}

async function handleRpc(request, env) {
  const origin = request.headers.get('origin') || ''
  const headers = corsHeaders(origin, env)
  if (!isAllowedOrigin(request, env)) return json({ error: 'EDGE_ORIGIN_BLOCKED' }, 403, headers)
  if (!env.FASTLANE_RPC_URL) return json({ error: 'EDGE_FASTLANE_SECRET_MISSING' }, 503, headers)
  if (!env.RPC_RATE_LIMITER?.limit) return json({ error: 'EDGE_RATE_LIMIT_UNCONFIGURED' }, 503, headers)

  let payload
  try {
    payload = await parseJsonBody(request)
  } catch (error) {
    const code = error instanceof Error && error.message === 'EDGE_BODY_TOO_LARGE'
      ? 'EDGE_BODY_TOO_LARGE'
      : 'EDGE_INVALID_JSON'
    return json({ error: code }, code === 'EDGE_BODY_TOO_LARGE' ? 413 : 400, headers)
  }

  const validation = validateBootBatch(payload, env)
  if (!validation.ok) return json({ error: validation.code }, 400, headers)

  const limited = await env.RPC_RATE_LIMITER.limit({ key: 'r3os-fastlane-boot' })
  if (!limited?.success) return json({ error: 'EDGE_RATE_LIMITED' }, 429, headers)

  let upstream
  try {
    upstream = await fetch(env.FASTLANE_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return json({ error: 'EDGE_UPSTREAM_UNAVAILABLE' }, 502, headers)
  }

  const body = await upstream.text()
  return new Response(body, {
    status: upstream.ok ? 200 : 502,
    headers: {
      ...headers,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-r3os-accelerator': 'fastlane-read',
    },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('origin') || ''
    const headers = corsHeaders(origin, env)

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, mode: 'stateless-fastlane-read-accelerator' }, 200, headers)
    }

    if (url.pathname !== '/v1/boot-rpc') return json({ error: 'NOT_FOUND' }, 404, headers)

    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin(request, env)) return new Response(null, { status: 403, headers })
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, headers)

    return handleRpc(request, env)
  },
}
