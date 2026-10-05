# Phase 9B — Mainnet I/O

Status: first implementation slice. No deployment or transaction has been executed by these changes.

## Provider policy

The browser architecture remains:

`browser → Monad RPC / WebSocket → contracts / storage / logs`

FastLane Enterprise is eligible to become one browser RPC lane only if the provider explicitly confirms that the issued credential may be exposed in browser code. CORS support is necessary but is not permission to publish a credential. A secret/server-only credential must not be placed in any `VITE_` variable and must not be routed through an app-owned proxy merely to preserve FastLane.

Public FastLane material inspected during this phase confirms that FastLane operates Monad RPC infrastructure, but it does not establish the browser-exposure policy for the user's Enterprise credential. Until that account-specific policy is confirmed, production browser integration is intentionally blocked.

Local capability command:

```bash
FASTLANE_RPC_URL="$YOUR_LOCAL_VALUE" npm run rpc:probe:fastlane
```

Do not paste the URL/token into chat. The command writes `artifacts/fastlane-capability.json` without storing the endpoint URL or any credential-derived fingerprint.

If FastLane explicitly confirms the issued credential is browser-public, rerun locally with:

```bash
FASTLANE_BROWSER_POLICY=public-browser FASTLANE_RPC_URL="$YOUR_LOCAL_VALUE" npm run rpc:probe:fastlane
```

Only `ELIGIBLE_AS_BROWSER_RPC_LANE` is sufficient to consider putting that endpoint into the public browser configuration.

## What the capability probe measures

Read-only only:

- chain ID
- `web3_clientVersion`
- finalized-block availability
- `eth_maxPriorityFeePerGas`
- `eth_feeHistory`
- browser CORS preflight/POST headers
- cold request timing
- three warm sequential request timings
- JSON-RPC batch sizes 1 / 5 / 20 by default

Each batch member is conservatively counted as an RPC operation. The probe makes no claim that a 20-member HTTP batch consumes one provider rate-limit unit.

## Mainnet Boot Packet

The browser now starts one bounded batch packet on the primary configured read-safe RPC lane during boot. The initial packet contains ten independent members:

1. `eth_chainId`
2. `eth_blockNumber`
3. `web3_clientVersion`
4. Paint `eth_getCode`
5. Multicall3 `eth_getCode`
6. Paint `painterPass()`
7. Paint `R3TARDS()`
8. Paint `experimentCount()`
9. Paint `renderersFrozen()`
10. Paint `experimentsFrozen()`

The packet is useful state, not synthetic warming traffic. Its decoded registry/status values seed the normal production caches so those reads are not immediately repeated.

The configured `VITE_RPC_BATCH_SIZE` remains the maximum packet size. If a provider rejects a large batch, the packet recursively splits; if the packet fails entirely, normal viem fallback reads continue. It therefore does not become a new single point of failure.

The WebSocket transport is also opened opportunistically during boot. Action RPC probing remains independent and still warms/ranks every configured action endpoint.

## Why JSON-RPC batch instead of a giant Multicall3

Monad's current performance guide recommends concurrent `eth_call`s and notes that RPC batch members can execute in parallel, while Multicall executes its internal calls serially. r3OS still uses Multicall3 for many bounded homogeneous reads; the Boot Packet is specifically for independent startup calls where removing both round-trip waterfalls and serialized EVM aggregation is useful.

Current official public-mainnet batch limits are provider-specific, including limits of 100, 10, or 1 depending on the endpoint. The runtime therefore does not assume one universal batch size.

Sources:

- https://docs.monad.xyz/developer-essentials/best-practices
- https://docs.monad.xyz/developer-essentials/network-information
- https://docs.monad.xyz/reference/json-rpc/overview

## Method-aware routing

Not added yet.

The existing action pool already maintains health/latency EWMA, cooldowns, freshness penalties, hedged latency-sensitive reads, multi-endpoint raw-transaction broadcast and receipt hedging. Adding method-specific scores before measuring FastLane and the final mainnet providers would create complexity without evidence.

The provider capability measurements and later mainnet action measurements will determine whether `eth_estimateGas`, fee reads, receipt reads or broadcast paths benefit from separate rankings.

## Priority-fee benchmark

`npm run benchmark:priority` is read-only by default. It reads current mainnet fee data and prints the 0 / 1 / 2 / 5 gwei priority matrix with exact 21,000-gas self-transfer envelopes.

Monad currently documents:

- gas charged = transaction gas limit
- EIP-1559 priority fee contributes to transaction ordering
- default client ordering is descending total gas price
- `eth_maxPriorityFeePerGas` currently returns a temporary hardcoded 2 gwei suggestion

Therefore the benchmark measures actual observed behavior rather than treating 2 gwei or a premium RPC tier as magic priority.

Real sends are intentionally gated and have not been executed. Transaction mode requires all of:

```bash
PRIORITY_BENCH_PRIVATE_KEY=... \
PRIORITY_BENCH_CONFIRM=YES_MAINNET_SPEND \
npm run benchmark:priority -- --send
```

Every sample is a zero-value self-transfer with exactly 21,000 gas. The script waits until that sample is canonically finalized before sending the next priority level, preventing same-account nonce ordering from trivially invalidating the comparison. This still remains an empirical launch-time sample, not a network guarantee.

No transaction benchmark should be run until the user explicitly approves that mainnet-spend step.

## Remaining 9B work after local capability results

1. Run the FastLane capability probe locally without sharing its endpoint.
2. Resolve provider credential policy from FastLane's account documentation/support.
3. Benchmark Boot Packet/public provider combinations on mainnet.
4. Decide whether FastLane joins `VITE_RPC_URLS`; if not, retain direct public providers.
5. Measure method-specific action behavior before deciding whether method-aware scoring is justified.
6. Execute the priority-fee transaction matrix only after explicit approval.
7. Consider fixed gas envelopes for known r3OS actions only after mainnet simulation distributions prove conservative limits.
