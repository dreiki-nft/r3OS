# Phase 9C — Monad Mainnet Deployment Runbook

Status: **PREPARED / NOT DEPLOYED**.

This runbook stops at every irreversible boundary. A successful dry-run, green preflight, or green Launch Doctor is evidence for a human decision; none of them is permission to broadcast.

## 1. Safety model

The deployment scripts now distinguish Foundry dry-run context from actual `--broadcast` / `--resume` context.

- Dry-run on chain 143: allowed without `CONFIRM_MAINNET`.
- Actual chain-143 broadcast/resume: requires `CONFIRM_MAINNET=true` in the executing shell.
- Ownership acceptance by an EOA additionally requires `CONFIRM_ACCEPT_OWNERSHIP=true`.
- Renderer freeze by an EOA additionally requires `CONFIRM_FREEZE_RENDERERS=true`.
- A contract final owner such as a Safe is never impersonated with `startBroadcast(address)`. The helper scripts print target + calldata for execution through the contract owner's normal flow.
- The reviewed deployment manifest remains `approvalState: PLAN_ONLY`. It never stores a standing mainnet approval.

Never store a private key, mnemonic, FastLane Enterprise URL, or unrestricted RPC credential in the repository.

## 2. Deployment order

The exact order is:

1. read-only mainnet preflight;
2. core `Deploy.s.sol`;
3. CARD.DRV `DeployMonadCard.s.sol`;
4. Monad Hardware `DeployMonadHW.s.sol`;
5. Operator / System Event `DeployOperator.s.sol`;
6. Router Lab `DeployRouterLab.s.sol`;
7. pre-acceptance Finalized Launch Doctor;
8. ownership acceptance;
9. optional renderer freeze, only if the reviewed manifest says so;
10. post-acceptance Finalized Launch Doctor;
11. Phase 9D independent-provider canary / split-brain acceptance;
12. Flight Recorder and `R3OS_MAINNET_GENESIS` evidence hash.

CARD.DRV must precede Monad Hardware because Block Camera stores `CARD_MEMORY` immutably. Ownership acceptance must remain after all owner-only Paint registration. Experiments stay open under the reviewed launch policy.

## 3. Prepare local inputs

Copy, do not edit, the checked-in example:

```bash
cp docs/MAINNET_DEPLOYMENT_INPUT.example.json docs/MAINNET_DEPLOYMENT_INPUT.local.json
```

Keep the local file uncommitted. Fill every value and set:

```json
"schema": "r3os-mainnet-deployment/v2",
"approvalState": "PLAN_ONLY",
"reviewed": true
```

The final input must contain the exact deployer, final owner, token #0 recipient, royalty receiver, season start, System Event feed policy, public RPC/WS topology and freeze intention. The optional FastLane accelerator URL may remain blank until the real `R3OSPaint` address exists and the Worker is deployed.

Copy `contracts/.env.example` to `contracts/.env` and fill the matching deployment values locally. Keep all confirmation flags false.

## 4. Re-run the accepted code gate

```bash
npm run launch:gates
```

Do not proceed if any gate is red.

## 5. Generate the reviewed plan

```bash
npm run mainnet:manifest -- --input docs/MAINNET_DEPLOYMENT_INPUT.local.json
```

Review all three outputs:

- `artifacts/mainnet-deployment-manifest.json`
- `artifacts/mainnet-deployment-manifest.sha256`
- `artifacts/MAINNET_DEPLOYMENT_PLAN.md`

The generator rejects a stored `confirmMainnet` field. Approval belongs at the exact transaction step, not in a JSON file that can survive longer than human attention.

## 6. Read-only chain-143 preflight

Supply an RPC only in the local shell:

```bash
read -rsp "Monad Mainnet RPC URL: " RPC_URL
echo
export RPC_URL
npm run mainnet:preflight -- --input docs/MAINNET_DEPLOYMENT_INPUT.local.json
unset RPC_URL
```

Preflight pins dependency/oracle code reads to one Finalized block and checks:

- chain 143;
- Finalized anchor availability;
- r3tards, Skrumpeys, Monad Cards, MON/USD feed and Multicall3 code;
- MON/USD feed description, decimals, round validity and configured freshness;
- season start is still in the future;
- deployer has a nonzero MON balance;
- current priority-fee suggestion as evidence only.

A priority-fee suggestion is not an inclusion guarantee. A nonzero deployer balance is not proof that deployment is affordable; exact transaction gas limits must still be reviewed from dry-runs because Monad charges the gas limit.

Outputs:

- `artifacts/mainnet-preflight.json`
- `artifacts/MAINNET_PREFLIGHT.txt`

A green result says `READY FOR HUMAN DEPLOYMENT APPROVAL`. It does not broadcast.

## 7. Dry-run the deployment scripts

Run from the repository root. Load your local Foundry environment first using your normal local workflow. Do **not** set `CONFIRM_MAINNET=true` for dry-runs.

Core:

```bash
FOUNDRY_PROFILE=deploy forge script contracts/script/Deploy.s.sol:Deploy --root contracts --rpc-url "$RPC_URL" -vvvv
```

After core is eventually broadcast, collect its public addresses before dry-running add-ons:

```bash
npm run mainnet:collect-addresses
```

The collector reads only local Foundry `contracts/broadcast/**/143/run-latest.json` files and writes:

- `artifacts/mainnet-deployment-addresses.json`
- `artifacts/mainnet-addresses.env`

It is safe to source the generated address file because it contains public contract addresses only:

```bash
set -a
source artifacts/mainnet-addresses.env
set +a
```

Then dry-run each add-on in order:

```bash
FOUNDRY_PROFILE=deploy forge script contracts/script/DeployMonadCard.s.sol:DeployMonadCard --root contracts --rpc-url "$RPC_URL" -vvvv
FOUNDRY_PROFILE=deploy forge script contracts/script/DeployMonadHW.s.sol:DeployMonadHW --root contracts --rpc-url "$RPC_URL" -vvvv
FOUNDRY_PROFILE=deploy forge script contracts/script/DeployOperator.s.sol:DeployOperator --root contracts --rpc-url "$RPC_URL" -vvvv
FOUNDRY_PROFILE=deploy forge script contracts/script/DeployRouterLab.s.sol:DeployRouterLab --root contracts --rpc-url "$RPC_URL" -vvvv
```

The chain-143 scripts fail closed if critical predecessor contracts, ownership, immutable inputs, partner addresses, budgets, or registry sources are wrong.

## 8. STOP — first deployment broadcast

**Do not add `--broadcast` yet.**

Immediately before the first real mainnet transaction:

1. review the manifest hash;
2. review the read-only preflight;
3. review dry-run traces and gas limits;
4. confirm signer/deployer identity and MON balance;
5. obtain explicit human approval for the exact deployment step.

Only then should `CONFIRM_MAINNET=true` exist in the executing shell. Do not persist it in `.env`.

Repeat the approval/review discipline for each deployment stage. After every successful stage, run `npm run mainnet:collect-addresses` again so later steps consume addresses from Foundry's actual broadcast artifacts rather than manual transcription.

## 9. Pre-acceptance certification

After all 16 intended contracts are deployed and Router Lab is registered, the collector must report `16/16` and no missing contracts.

Run Launch Doctor against chain 143 using the actual deployment addresses. Certification reads are pinned to Finalized state. Expected pre-acceptance facts include:

- all intended bytecode exists;
- Paint registry is exactly the reviewed renderer/experiment surface;
- no `router-mock-venues` entry exists;
- Pass has exactly the three launch stamp sources;
- CARD.DRV / Hardware / Operator / Router wiring is correct;
- System Event feed/config is correct;
- current owners are still the deployer where expected;
- pending owners equal `FINAL_OWNER` if ownership is transferring;
- experiments remain open.

Do not accept ownership until this passes.

### Source verification

Verify every deployed production contract before final acceptance. Keep verification separate from signing/broadcast so a verifier outage cannot blur whether a deployment transaction succeeded. The current MonadVision/Sourcify command shape is:

```bash
forge verify-contract <address> <source-path:ContractName> \
  --chain 143 \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --watch
```

Record the verified MonadVision page for each production address. Constructor-bearing contracts may require ABI-encoded constructor arguments when the verifier cannot derive them; use the exact reviewed deployment inputs and Foundry artifacts, never retype from memory.

## 10. STOP — ownership acceptance

Dry-run the helper first:

```bash
FOUNDRY_PROFILE=deploy forge script contracts/script/AcceptOwnership.s.sol:AcceptOwnership --root contracts --rpc-url "$RPC_URL" -vvvv
```

If `FINAL_OWNER` is an EOA, an actual mainnet broadcast requires both exact-step shell flags:

```text
CONFIRM_MAINNET=true
CONFIRM_ACCEPT_OWNERSHIP=true
```

If `FINAL_OWNER` is a contract/Safe, the script does not impersonate it. It prints the four `acceptOwnership()` target/calldata pairs. Execute those through the Safe/account's normal approval flow after explicit approval.

If the deployer is also the final owner, the helper validates the launch registry and exits without an ownership transaction.

## 11. STOP — optional renderer freeze

Experiments remain open. Renderer freeze is optional and only applies if the reviewed manifest says `freeze-after-acceptance`.

Dry-run:

```bash
FOUNDRY_PROFILE=deploy forge script contracts/script/FreezeRenderers.s.sol:FreezeRenderers --root contracts --rpc-url "$RPC_URL" -vvvv
```

An EOA broadcast requires both `CONFIRM_MAINNET=true` and `CONFIRM_FREEZE_RENDERERS=true`. A Safe/contract owner receives target + calldata instead.

Do not freeze before post-deployment behavior is verified.

## 12. What waits for 9D

Do not emit/treat a genesis evidence hash as canonical yet. Phase 9D must still add/run the independent-provider split-brain guard and mainnet canary, including the explicitly enabled harmless Paint transaction path. Only after 9D acceptance should the Flight Recorder hash become the `R3OS_MAINNET_GENESIS` evidence marker.

The optional FastLane Worker is also deployed only after the real Paint address exists. Its failure must remain performance-only: direct public Monad RPC/WS continues to work without it.
