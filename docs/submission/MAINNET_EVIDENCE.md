# r3OS mainnet acceptance evidence (Phase 9F)

This directory publishes the **final Phase 9D accepted Monad mainnet evidence**, captured against source commit `42a17e62140d474d59922bb922599defac39d856`.

**Chain:** Monad mainnet `143`

**Paint:** [`0x5102de3817ae16b3afaeb9d180130669a70787b3`](https://monadvision.com/address/0x5102de3817ae16b3afaeb9d180130669a70787b3)

**Finalized acceptance block:** `111045783`, hash `0x1a333ec173b4f667ec9d36269b458501b70b446c68744ca31e2998352dada3bd`

**Canary:** [`0x71821fedd32fbacd582d76fbb4a1ddd767e3590f6d779ea6131ad0f96221eb8c`](https://monadvision.com/tx/0x71821fedd32fbacd582d76fbb4a1ddd767e3590f6d779ea6131ad0f96221eb8c), block `111045205`.

## Canonical hashes

| Evidence | SHA-256 of the **exact original JSON bytes** |
| --- | --- |
| `mainnet-launch.json` | `0x6b07e83382d4f06d03620084b2b13205768f8b081e88c27661fee8c2d3a2a137` |
| `mainnet-deployment-manifest.json` | `0x307580c4fc98f28cee605a5a5bd348f08a9f1eba71788bd26eaced86e0cf67f1` |

The label **`R3OS_MAINNET_GENESIS`** belongs to the offchain Flight Recorder evidence marker. **It is not an onchain event, log, registration or System Event activation.**

## Files

| File | What it proves |
| --- | --- |
| [`mainnet-launch.json`](mainnet-evidence/mainnet-launch.json), [`.sha256`](mainnet-evidence/mainnet-launch.sha256) and [text digest](mainnet-evidence/mainnet-launch.txt) | Canonical Flight Recorder snapshot, accepted commit, contracts, gates, hash |
| [`mainnet-deployment-manifest.json`](mainnet-evidence/mainnet-deployment-manifest.json) and [`.sha256`](mainnet-evidence/mainnet-deployment-manifest.sha256) | Reviewed configuration/intent. `approvalState: PLAN_ONLY` describes the input plan, not the final deployed state |
| [`mainnet-deployment-addresses.json`](mainnet-evidence/mainnet-deployment-addresses.json) | **Final v2** list of **16/16** contracts; `complete: true`, `missing: []` |
| [`doctor-finalized.json`](mainnet-evidence/doctor-finalized.json) | Original `launch-doctor-finalized.json` bytes, renamed only to avoid the repository's `launch-doctor-*.json` ignore rule; finalized block `111045783`, 106 OK / 0 WARN / 0 FAIL / 1 UNKNOWN |
| [`mainnet-canary.json`](mainnet-evidence/mainnet-canary.json) | One real Paint transaction: receipt, Painted event, commitment observations, independent provider agreement, 21 OK / 0 WARN / 0 FAIL |
| [`local-acceptance-gates.json`](mainnet-evidence/local-acceptance-gates.json) | Nine local build/test/speculation/torture/generation gate commands with exit code 0. It records exit codes, not individual test counts |
| [`SHA256SUMS`](mainnet-evidence/SHA256SUMS) | Separate file-by-file custody hashes for the nine above evidence files; not a substitute for the two canonical hashes |

## Offline independent consistency check

From the root of a cloned repository, run:

```bash
node scripts/verify-mainnet-evidence.mjs
```

This command uses **Node built-ins only**, reads local evidence files, crosschecks the canonical byte hashes, 16 contract addresses/code hashes, accepted block anchors, freeze intentions and final states, provider/canary flags and local gate exit codes. **It never connects to Monad, uses wallet credentials, performs transactions, or changes mainnet state.**

This is an **offline evidence consistency check, not fresh independent blockchain verification**. Verify live explorer state separately if desired; these snapshots document what the Phase 9D tools reported at the time.

## State distinctions that must not be collapsed

- Renderer registry: permanently frozen, entries `0..3` (built-in, Diff, Season Timelapse, DF1).
- Experiment registry: intentionally **not frozen**; preserving future discovery headroom is the intended production state.
- `R3OSSystemEvent`: **ARMED** at acceptance, **not activated**. Do not invoke its irreversible public `activate()` latch merely for submission evidence.
- The real Paint canary briefly changed pixel `(0,0)` and restored its visible color within one transaction. Its events and accounting were not state-idempotent.
- X-Ray intentionally distinguishes **local UI response**, **protocol observation (`monadLogs`/remote propagation)** and **actual settlement (`Finalized`)**. A receipt is not the same as finality.
- The doctor's one **UNKNOWN** is the documented EIP-2935 historical/testnet semantics check. It is not a failure and should not be quietly represented as 107 OK.
- Automated tests do not constitute a professional third-party security audit.

## Historical materials are deliberately preserved

`artifacts/mainnet-deployment-addresses.json` in the original accepted source snapshot is an earlier, incomplete **v1** recovery-stage artifact. The final authoritative **v2** address record for submission is published here. Historical broadcast journals, recovery reports, incomplete snapshots and previous checks are **not deleted, normalized, or overwritten**.

The later Phase 9E frontend Judge Mode validation of **505/505 tests** is separate from the Phase 9D accepted deployment baseline (reported **502/502** in the acceptance log). The local acceptance JSON demonstrates that the test command succeeded, but does not itself contain that 502 count.
