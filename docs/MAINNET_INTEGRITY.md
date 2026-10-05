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
