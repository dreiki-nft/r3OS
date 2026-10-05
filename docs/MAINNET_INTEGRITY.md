# Phase 9 mainnet integrity

r3OS deliberately consumes low-latency Monad data before final settlement. The safety rule is therefore not “never speculate”; it is “never confuse speculation with canonical certification, and always have a deterministic repair path.”

## Runtime consistency policy

| Layer | Policy |
|---|---|
| local interaction | immediate local UI; no chain round trip is placed in the pointer/render loop |
| shared observation | low-latency WebSocket / Monad commitment feed may surface non-final state |
| confidence-sensitive display | use Voted/safe semantics where the feature actually needs more confidence |
| critical certification | deployment, admin, launch evidence and canonical repair use Finalized state |

`latest` is never accepted as a launch-certification synonym. The Launch Doctor CLI pins its state reads, bytecode checks and raw calls to one finalized block.

## Speculative proposal reconciliation

Monad proposal identity is tracked with `blockId`, separately from transaction/log identity. Multiple proposals can exist at one height and a losing proposal has no required explicit “abandoned” notification.

The Paint store therefore has two repair signals:

1. The app-wide `monadLogs` feed records proposal lifecycle. If a different block at the same height Finalizes after a Paint-relevant sibling proposal was observed, Paint schedules an immediate finalized reconciliation.
2. A periodic finalized overlap reconciliation remains in place as the backstop. This matters when the winning block contains no Paint log and therefore cannot itself produce a matching `monadLogs` notification for the Paint address.

Log de-duplication prefers `blockHash + transactionHash + logIndex` when available. `transactionHash + logIndex` alone is not sufficient to distinguish the same transaction/log appearing in sibling proposals.

The authoritative repair reads Paint state at the finalized block, replaces any losing speculative state, then catches up the post-finalized tail so low-latency observation can continue.

Target regression command:

```bash
npm run test:speculation
```

## Launch Doctor

`npm run launch:doctor` is read-only and does not touch a wallet. For critical certification it now:

- resolves one `finalized` block;
- pins contract reads, code reads, code hashes and raw calls to that block number;
- reports the finalized block/hash in human and JSON output;
- fails mainnet certification when a finalized reference cannot be established.

## Mainnet Flight Recorder

The final accepted launch evidence is assembled from a human-reviewed JSON input and written as:

```text
artifacts/mainnet-launch.json
artifacts/mainnet-launch.txt
artifacts/mainnet-launch.sha256
```

The JSON is recursively key-sorted and serialized deterministically. The SHA-256 is computed over those exact JSON bytes.

The required label is:

```text
R3OS_MAINNET_GENESIS
```

The label and hash form the canonical launch marker in the Flight Recorder evidence set.

The existing `R3OSSystemEvent` contract is a fixed MON/USD price-trigger latch. It has no generic bytes32/message field. Phase 9 must **not** invent a hash encoding or overload that event merely to force the Flight Recorder hash onchain. If an explicit generic onchain genesis marker is desired later, it requires a separately reviewed mechanism and its own approval gate.

Example command after mainnet acceptance data has been collected:

```bash
npm run flight:record -- --input artifacts/mainnet-launch-input.json
```

The recorder validates chain ID 143, a finalized block/hash, at least one contract entry and a green finalized Launch Doctor result. It does not query RPC, sign, or send transactions.

## Structured finalized evidence

Launch Doctor JSON now includes a structured `evidence` object in addition to the human report. The evidence is gathered at the same finalized anchor and includes, where available:

- all 16 intended launch contract addresses and deployed-code hashes;
- active Paint registry entries and their code hashes;
- renderer entries and hashes;
- Paint/Labs/Pass/Quests owner and pending-owner state;
- renderer/experiment freeze state;
- Paint schedule/budget configuration;
- partner code/hash/budget checks.

This prevents the Flight Recorder from relying on hand-copied addresses or hashes.

## Local acceptance artifact

Run:

```bash
npm run launch:gates
```

It executes the non-RPC launch gates and records their exit status in `artifacts/local-acceptance-gates.json`. It does not install dependencies or modify package files.

## Final Flight Recorder assembly

The preferred Phase 9 path is:

```bash
# 1. Generate the reviewed deployment plan before any broadcast.
npm run mainnet:manifest -- --input <reviewed-deployment-input.json>

# 2. After accepted deployment and ownership state, capture a finalized Doctor report.
RPC_URL="$MONAD_RPC_URL" \
EXPECTED_CHAIN_ID=143 \
PAINT_ADDRESS=<paint> \
EXPECTED_OWNER=<final-owner> \
npm run launch:doctor -- --json > artifacts/launch-doctor-finalized.json

# 3. Capture local regression/build evidence.
npm run launch:gates

# 4. Only after mainnet acceptance, assemble the canonical Flight Recorder.
npm run flight:record -- \
  --input <base-flight-input.json> \
  --doctor artifacts/launch-doctor-finalized.json \
  --manifest artifacts/mainnet-deployment-manifest.json \
  --acceptance artifacts/local-acceptance-gates.json
```

The recorder fails closed if any intended launch contract or code hash is missing, if the finalized Doctor anchor differs, if required local gates are red, if ownership is not finalized to the reviewed final owner, if required registry entries are missing, if test-only Router mocks are active, if partner evidence is incomplete, or if finalized freeze state contradicts the reviewed manifest.

`R3OS_MAINNET_GENESIS` remains an evidence label over the deterministic recorder hash. It is not emitted onchain by `R3OSSystemEvent`.
