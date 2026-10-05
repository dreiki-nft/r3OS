const POLICY_VALUES = new Set(['unverified', 'public-browser', 'secret-server'])

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function selectedHeaders(headers) {
  const names = [
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-allow-credentials',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'ratelimit-limit',
    'ratelimit-remaining',
  ]
  return Object.fromEntries(names.flatMap((name) => {
    const value = headers.get(name)
    return value == null ? [] : [[name, value]]
  }))
}

function corsOriginAllows(value, origin) {
  if (!value) return false
  return value === '*' || value.split(',').map((part) => part.trim()).includes(origin)
}

function preflightAllows(headers, origin) {
  const allowOrigin = headers['access-control-allow-origin']
  const methods = String(headers['access-control-allow-methods'] ?? '').toUpperCase()
  const allowedHeaders = String(headers['access-control-allow-headers'] ?? '').toLowerCase()
  return (
    corsOriginAllows(allowOrigin, origin) &&
    (methods.includes('POST') || methods.includes('*')) &&
    (allowedHeaders.includes('content-type') || allowedHeaders.includes('*'))
  )
}

async function fetchTimed(url, init, timeoutMs = 4_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = now()
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return { response, ms: now() - started }
  } finally {
    clearTimeout(timer)
  }
}

async function rpcPost(url, payload, origin) {
  const { response, ms } = await fetchTimed(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(payload),
  })
  const headers = selectedHeaders(response.headers)
  let body
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  return { status: response.status, ok: response.ok, ms, headers, body }
}

function request(id, method, params = []) {
  return { jsonrpc: '2.0', id, method, params }
}

export function normalizeRpcResponseItems(body) {
  return Array.isArray(body) ? body : body ? [body] : []
}

function responseById(body) {
  return new Map(normalizeRpcResponseItems(body).map((item) => [item?.id, item]))
}

function rpcResult(row) {
  return row && !row.error ? row.result : undefined
}

export function browserDecision({ technicalBrowserEligible, policy }) {
  if (policy === 'secret-server') return 'BLOCKED_SECRET_CREDENTIAL'
  if (policy !== 'public-browser') return 'BLOCKED_POLICY_UNVERIFIED'
  if (!technicalBrowserEligible) return 'BLOCKED_BROWSER_TRANSPORT'
  return 'ELIGIBLE_AS_BROWSER_RPC_LANE'
}

export function normalizePolicy(value) {
  const policy = String(value ?? '').trim().toLowerCase()
  return POLICY_VALUES.has(policy) ? policy : 'unverified'
}

export async function probeRpcCapability({
  url,
  origin = 'https://r3os.invalid',
  policy = 'unverified',
  batchSizes = [1, 5, 20],
}) {
  if (!url) throw new Error('RPC_PROBE_URL_REQUIRED')
  const normalizedPolicy = normalizePolicy(policy)

  let preflight
  try {
    const result = await fetchTimed(url, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
    preflight = {
      status: result.response.status,
      ms: result.ms,
      headers: selectedHeaders(result.response.headers),
    }
  } catch (error) {
    preflight = { status: 0, ms: 0, headers: {}, error: error instanceof Error ? error.name : 'Error' }
  }

  const cold = await rpcPost(url, request(1, 'eth_chainId'), origin)
  const coldMap = responseById(cold.body)
  const chainIdRaw = rpcResult(coldMap.get(1))
  const chainId = typeof chainIdRaw === 'string' ? Number(BigInt(chainIdRaw)) : undefined

  const warmSequential = []
  for (let i = 0; i < 3; i += 1) {
    const row = await rpcPost(url, request(10 + i, 'eth_blockNumber'), origin)
    warmSequential.push({ ms: row.ms, ok: row.ok && rpcResult(responseById(row.body).get(10 + i)) != null })
  }

  const capabilityPayload = [
    request(100, 'web3_clientVersion'),
    request(101, 'eth_blockNumber'),
    request(102, 'eth_getBlockByNumber', ['finalized', false]),
    request(103, 'eth_maxPriorityFeePerGas'),
    request(104, 'eth_feeHistory', ['0x1', 'latest', [50]]),
  ]
  const capabilityBatch = await rpcPost(url, capabilityPayload, origin)
  const capability = responseById(capabilityBatch.body)

  const batchBenchmarks = []
  let nextId = 1_000
  for (const requested of batchSizes) {
    const size = Math.max(1, Math.min(100, Number(requested) || 1))
    const payload = Array.from({ length: size }, () => request(nextId++, 'eth_blockNumber'))
    const row = await rpcPost(url, payload, origin)
    // Some JSON-RPC servers normalize a one-member batch into a single response object.
    // Count that as a successful one-member request instead of reporting a fake batch failure.
    const items = normalizeRpcResponseItems(row.body)
    batchBenchmarks.push({
      size,
      ms: row.ms,
      httpStatus: row.status,
      responseCount: items.length,
      successCount: items.filter((item) => item && !item.error && item.result != null).length,
      supported: row.ok && items.length === size && items.every((item) => !item.error && item.result != null),
    })
  }

  const postCors = cold.headers
  const technicalBrowserEligible =
    chainId === 143 &&
    preflight.status >= 200 &&
    preflight.status < 300 &&
    preflightAllows(preflight.headers, origin) &&
    corsOriginAllows(postCors['access-control-allow-origin'], origin)

  const clientVersion = rpcResult(capability.get(100))
  const finalized = rpcResult(capability.get(102))
  const priority = rpcResult(capability.get(103))
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    endpoint: {
      urlStored: false,
      credentialFingerprintStored: false,
    },
    chainId,
    clientVersion: typeof clientVersion === 'string' ? clientVersion : undefined,
    credentialPolicy: normalizedPolicy,
    browser: {
      probeOrigin: origin,
      technicalBrowserEligible,
      decision: browserDecision({ technicalBrowserEligible, policy: normalizedPolicy }),
      preflight,
      postHeaders: postCors,
    },
    methods: {
      eth_chainId: chainId === 143,
      web3_clientVersion: typeof clientVersion === 'string',
      eth_blockNumber: rpcResult(capability.get(101)) != null,
      finalizedBlock: Boolean(finalized && typeof finalized === 'object' && finalized.hash),
      eth_maxPriorityFeePerGas: typeof priority === 'string',
      eth_feeHistory: rpcResult(capability.get(104)) != null,
    },
    timings: {
      coldChainIdMs: cold.ms,
      warmSequential,
      capabilityBatchMs: capabilityBatch.ms,
      batchBenchmarks,
    },
    accounting: {
      batchMembersAreConservativelyCountedIndividually: true,
      approximateRpcMembers: 1 + warmSequential.length + capabilityPayload.length + batchBenchmarks.reduce((sum, row) => sum + row.size, 0),
    },
    notes: [
      'CORS reachability does not prove that an RPC credential is safe to expose in browser code.',
      'Only set credentialPolicy=public-browser after the provider explicitly permits browser exposure for this credential.',
      'This probe never sends a transaction and never stores the endpoint URL.',
    ],
  }
  return report
}
