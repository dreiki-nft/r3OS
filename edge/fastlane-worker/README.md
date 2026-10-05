# r3OS FastLane read accelerator

This Worker is optional transport acceleration. It stores no canonical state, has no database, signs nothing and is never required for r3OS correctness.

It exposes only:

- `GET /health`
- `POST /v1/boot-rpc`

`/v1/boot-rpc` accepts only the exact ten-member r3OS Boot Packet shape. It rejects arbitrary JSON-RPC, transaction submission, arbitrary contract targets and non-allowed browser origins.

## Before deployment

1. Copy `wrangler.jsonc.example` to a local `wrangler.jsonc`.
2. Set the production r3OS origin and the deployed mainnet `R3OSPaint` address.
3. Keep the canonical Multicall3 address unless Monad changes it.
4. Pick a rate-limit `namespace_id` unique within the Cloudflare account if `900901` is already used.
5. Store the FastLane Enterprise URL as a Cloudflare secret, never as `vars` and never in any `VITE_` variable.

Cloudflare currently recommends Worker secrets for API tokens/credentials and supports native rate-limit bindings. The checked-in example intentionally contains no FastLane credential.

Example secret setup from this directory:

```bash
npx wrangler@latest secret put FASTLANE_RPC_URL --config wrangler.jsonc
```

Then deploy only after reviewing the generated Worker configuration:

```bash
npx wrangler@latest deploy --config wrangler.jsonc
```

No Worker deployment is part of the repository patch itself.

## Browser configuration

After deployment, the only public browser value is the Worker route:

```text
VITE_FASTLANE_ACCELERATOR_URL=https://<worker-host>/v1/boot-rpc
```

If the Worker is absent, rate-limited, unhealthy or returns malformed data, r3OS falls back to its direct public Monad RPC Boot Packet and the normal public-client path. Losing this Worker may make startup slower; it must never make canonical application state unavailable.
