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

## Post-acceptance EIP-7702 Live Mode recovery

On October 7, 2026, post-acceptance production use exposed a frontend-only compatibility issue in Live Mode's native-MON burner sweep. This incident did **not** modify or require redeployment of any production contract and is intentionally recorded separately from the immutable Phase 9D acceptance evidence above.

The affected sweep recipient was an EIP-7702 delegated account. Monad returned executable account code beginning with `0xef0100`, while the frontend's legacy native-transfer path assumed every MON transfer required exactly `21,000` gas.

A read-only `eth_estimateGas` probe against the actual burner, recipient and native transfer measured:

- legacy hardcoded limit: `21,000` gas
- actual recipient estimate: `21,212` gas

Two production sweep attempts therefore exhausted their complete hardcoded gas limits and reverted:

- [failed sweep #1](https://monadvision.com/tx/0x8f05351300fe6c529f122e02180bd9480257a6a44cd3b51d26a8369a21933b2c) — nonce `2`, gas limit `21,000`, gas used `21,000`, status failed
- [failed sweep #2](https://monadvision.com/tx/0x28acbdabb9de50fc24d46fa622e60b20708ff1d0f8fb76f296c0d31934274ce6) — nonce `3`, gas limit `21,000`, gas used `21,000`, status failed

The frontend was patched so native transfers use recipient-aware `eth_estimateGas` rather than universally assuming `21,000` gas. Live Mode now reserves the quoted gas requirement when calculating the recoverable burner balance. Regression coverage was added for executable/EIP-7702 recipients while preserving the normal `21,000` path for ordinary EOAs.

Post-fix local validation reported:

- production build: PASS
- frontend tests: **507/507 PASS** across **112/112** test files
- speculation suite: **18/18 PASS**
- torture suite: **15/15 PASS**
- repository doctor: PASS
- `git diff --check`: PASS

The patched production frontend then successfully recovered the burner balance:

- burner: `0x3eF384DF7dDd523fBfA268E20a2128eA3A038cCA`
- [successful patched sweep](https://monadvision.com/tx/0xe9ac9f4ea4c7f24d34bce54d5a17d0eeba91a9ab14bd964a2522aed61eefb508)
- burner balance before recovery: `0.966982294 MON`
- burner balance after recovery: `0.000466680 MON`

This is post-acceptance operational evidence. It must not be interpreted as changing the Phase 9D accepted source commit, deployment addresses, canonical evidence hashes, renderer freeze state, experiment-registry policy, or System Event state.

## Historical materials are deliberately preserved

`artifacts/mainnet-deployment-addresses.json` in the original accepted source snapshot is an earlier, incomplete **v1** recovery-stage artifact. The final authoritative **v2** address record for submission is published here. Historical broadcast journals, recovery reports, incomplete snapshots and previous checks are **not deleted, normalized, or overwritten**.

The later Phase 9E frontend Judge Mode validation of **505/505 tests** is separate from the Phase 9D accepted deployment baseline (reported **502/502** in the acceptance log). The local acceptance JSON demonstrates that the test command succeeded, but does not itself contain that 502 count.
