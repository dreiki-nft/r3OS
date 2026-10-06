# Phase 9D — Mainnet Acceptance

Phase 9D proves the accepted r3OS deployment through two independent public Monad RPC paths and one live WebSocket path before `R3OS_MAINNET_GENESIS` is allowed to exist.

The sequence is intentionally split into a read-only gate and a separately approved transaction gate.

## 1. Read-only split-brain canary

Load the generated mainnet address file, then set the two reviewed public endpoints and WebSocket endpoint in the shell:

```bash
set -a
source artifacts/mainnet-addresses.env
set +a

export RPC_URL="https://rpc.monad.xyz"
export RPC_URL_SECONDARY="https://rpc1.monad.xyz"
export WS_URL="wss://rpc.monad.xyz"
export EXPECTED_CHAIN_ID=143
export EXPECTED_OWNER="$FINAL_OWNER"

npm run -s launch:canary -- --json
```

Default mode is read-only. It never asks for a wallet and never signs or sends.

It must prove:

- both providers independently pass the finalized Launch Doctor checks;
- both providers produce the same stable deployment-evidence hash;
- both providers agree on the hash at their highest shared finalized height;
- `budgetOf` and `partnerBudgetOf` agree across providers at the shared finalized block;
- Painter Pass resolves back to the exact Paint address through both providers;
- PAGE.EXE returns the same 128-word page through both providers;
- WebSocket requests are healthy;
- a real `newHeads` notification is observed;
- a `monadLogs` subscription can be established;
- a blank low-pressure pixel exists for the transaction canary.

Provider lag by itself is not treated as a split. The guard compares the block hash at the highest height finalized by both providers. A hash disagreement at that shared finalized height fails closed.

The read-only run writes `artifacts/mainnet-canary-readonly.json`. This file is evidence only and is **not** sufficient for the Flight Recorder.

## 2. Transaction canary design

`contracts/script/MainnetCanaryPaint.s.sol` performs one real Paint transaction with a visually-idempotent patch:

```text
blank -> selected color -> blank
```

Both writes target the same pixel inside the same transaction. The final canvas image is therefore unchanged. Painter accounting, heat, region counters and the `Painted` event still advance, proving the real mainnet write path.

The script refuses to run unless:

- chain id is 143;
- Paint code and owner are correct;
- the painter is `FINAL_OWNER`;
- the chosen pixel is blank and outside the outline;
- the selected color is 1–15;
- the current block is not a storm;
- the next storm is more than 64 blocks away;
- the selected region has DF1 pressure no greater than 2.

The last conditions keep the canary out of the DF1 corruption path. The read-only canary suggests a candidate coordinate, but the transaction must still be dry-run immediately before approval because canvas/region state is live.

## 3. Dry-run the exact candidate

Take the exact `suggestedTransactionCanary` values from the successful read-only artifact:

```bash
export CANARY_PAINTER="$FINAL_OWNER"
export CANARY_X=<suggested x>
export CANARY_Y=<suggested y>
export CANARY_COLOR=<suggested color>

unset CONFIRM_MAINNET
unset CONFIRM_MAINNET_CANARY

FOUNDRY_PROFILE=deploy forge script \
  contracts/script/MainnetCanaryPaint.s.sol:MainnetCanaryPaint \
  --root contracts \
  --rpc-url "$RPC_URL" \
  -vvvv
```

The dry-run must end with `canary visual state restored` and must simulate exactly one `paint(bytes,uint256[])` transaction.

A successful dry-run is **not** permission to broadcast.

## 4. STOP — explicit transaction approval

The Phase 9D transaction is a real mainnet Paint and requires a fresh explicit approval immediately before broadcast.

After approval, transaction mode is run through the canary orchestrator so the `monadLogs` subscription is already live before Forge sends:

```bash
export CONFIRM_MAINNET=true
export CONFIRM_MAINNET_CANARY=true
export CANARY_KEYSTORE_ACCOUNT=r3os-deployer

npm run -s launch:canary -- --transaction --json

unset CONFIRM_MAINNET
unset CONFIRM_MAINNET_CANARY
```

Transaction mode starts the commit-state feed first, then invokes the guarded Forge script. It must capture and certify:

- successful Paint receipt;
- `Painted` event in the receipt;
- `Proposed` through `monadLogs`;
- `Finalized` through `monadLogs`;
- `Voted` when exposed by the live feed (missing `Voted` is a warning, not a fabricated signal);
- transaction finalized through both providers;
- receipt visible through the secondary provider;
- canonical transaction block identical through both providers;
- canary pixel restored to blank through the secondary provider.

Never rerun transaction mode blindly after an ambiguous send. Inspect the Forge broadcast artifact, nonce, receipt and chain state first.

## 5. Flight Recorder gate

`flight:record` now requires the successful transaction-mode `artifacts/mainnet-canary.json` via `--canary`.

A read-only canary, provider mismatch, missing commit-state proof, failed receipt, or non-restored visual pixel blocks `R3OS_MAINNET_GENESIS`.

Only after Phase 9D is green should the Flight Recorder be run and its deterministic SHA-256 promoted to the canonical `R3OS_MAINNET_GENESIS` evidence marker.
