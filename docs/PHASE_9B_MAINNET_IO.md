# Phase 9B — Mainnet I/O

Status: FastLane topology resolved; optional stateless Worker accelerator implemented. No Worker deployment, mainnet deployment or transaction benchmark has been executed by these repository changes.

## Final FastLane policy

FastLane support confirmed directly on 2026-10-05 that the Enterprise RPC URL should not be exposed in a frontend and that placing FastLane behind a Cloudflare Worker is a normal/recommended pattern for their apps and dashboards.

Therefore the production topology is:

```text
browser
  ├─ direct public Monad RPC / WebSocket → Monad
  └─ optional r3OS Cloudflare Worker → FastLane Enterprise → Monad
```

The Worker is acceleration only:

- no database
- no canonical application state
- no wallet/session state
- no signing or private keys
- no transaction submission
- no admin actions
- no exclusive event delivery
- no correctness dependency

If the Worker is missing, rate-limited or unhealthy, r3OS continues through direct public Monad RPC/WebSocket. Losing the Worker may make startup slower; it must not make the application incorrect or unavailable.

The FastLane credential remains a Cloudflare secret and never appears in a `VITE_` variable. Cloudflare's current documentation says sensitive API tokens should be stored as Worker secrets rather than normal variables, and its native rate-limit binding can enforce application-side limits without a separate database.

Sources:

- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## FastLane measurement

The local Enterprise probe measured Monad Mainnet chain ID 143 / `Monad/0.16.4` with approximately:

- cold `eth_chainId`: 560 ms
- warm sequential calls: 166–172 ms
- five-member batch: 166 ms
- twenty-member batch: 173 ms

The 1-member benchmark originally appeared unsupported because the provider normalized the one-member batch into a single JSON-RPC object rather than an array. The capability probe now normalizes either response shape so it does not report a false batch failure.

Batch members continue to be conservatively counted individually for provider accounting.

## Worker surface

The Worker lives in `edge/fastlane-worker/` and intentionally does **not** implement a generic JSON-RPC proxy.

Public routes:

- `GET /health`
- `POST /v1/boot-rpc`

`/v1/boot-rpc` accepts only the exact ten-member r3OS Boot Packet shape:

1. `eth_chainId`
2. `eth_blockNumber`
3. `web3_clientVersion`
4. Paint `eth_getCode`
5. Multicall3 `eth_getCode`
6–10. five no-argument `eth_call`s against the configured Paint address

The Worker additionally enforces:

- exact Paint and Multicall target addresses
- `latest` block tags for this low-latency startup packet
- allowed browser origins
- 16 KiB body cap
- unique JSON-RPC IDs
- native Cloudflare rate-limit binding
- no caching
- no raw transaction path
- no arbitrary contract target

The checked-in Wrangler file is an example only and contains no FastLane credential. The Worker fails closed if its rate-limit binding or FastLane secret is missing.

## Browser integration

The only new browser-visible value is:

```text
VITE_FASTLANE_ACCELERATOR_URL=https://<worker-host>/v1/boot-rpc
```

It is active only on chain 143. Testnet ignores it even if accidentally configured.

Boot behavior:

1. Try the optional accelerator with a short timeout.
2. Require a complete chain-143 Boot Packet.
3. On any accelerator error, malformed/incomplete packet, CORS rejection or rate limit, fall back to the direct public RPC Boot Packet.
4. Existing viem/public-provider reads remain authoritative and continue independently.

Boot diagnostics label the source as `accelerator` or `public`.

## Why JSON-RPC batch

Monad's performance guidance recommends concurrent `eth_call`s and notes that JSON-RPC batch members can execute in parallel, while Multicall executes its internal calls serially. The Boot Packet is specifically for independent startup reads where removing both round-trip waterfalls and serialized EVM aggregation is useful.

Current public mainnet providers expose different batch capabilities, so direct-public fallback retains recursive batch splitting rather than assuming one universal limit.

Sources:

- https://docs.monad.xyz/developer-essentials/best-practices
- https://docs.monad.xyz/developer-essentials/network-information
- https://docs.monad.xyz/reference/json-rpc/overview

## Method-aware routing

Still not added.

The existing action pool already maintains health/latency EWMA, cooldowns, freshness penalties, hedged latency-sensitive reads, multi-endpoint raw-transaction broadcast and receipt hedging. The FastLane Worker currently accelerates only the measured Boot Packet path. Adding a generic method router would increase complexity and quota exposure without evidence that it improves the application.

## Priority-fee benchmark

`npm run benchmark:priority` remains read-only by default.

Current plan snapshot observed:

- initial base fee: 100 gwei
- `eth_maxPriorityFeePerGas`: 2 gwei
- matrix: 0 / 1 / 2 / 5 gwei

Monad currently documents that the transaction gas limit is charged and that priority fee participates in transaction ordering. The current 2 gwei RPC suggestion is not treated as proof that 2 gwei is optimal.

No priority benchmark transaction has been sent. Transaction mode remains gated by explicit mainnet-spend confirmation and should not run until the user approves that exact step.

## Remaining 9B work

1. Run the full local acceptance gates for this Worker/fallback patch.
2. Create the Cloudflare Worker only after reviewing its origin, rate limit, Paint address and secret setup.
3. Measure Worker Boot Packet latency from the production browser and compare with direct-public fallback.
4. Decide whether any additional read-heavy endpoint deserves acceleration based on measurements, not architectural enthusiasm.
5. Run the small 0/1/2/5 gwei transaction matrix only after explicit mainnet-spend approval.
6. Consider fixed gas envelopes only after mainnet simulations prove conservative bounds for each known action.
