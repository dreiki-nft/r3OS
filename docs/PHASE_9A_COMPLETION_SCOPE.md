# Phase 9A completion scope

Phase 9A is complete when the following are green on the user's local checkout:

1. speculation integrity / sibling-proposal reconciliation;
2. finalized Launch Doctor behavior;
3. machine-validated mainnet deployment manifest tests;
4. structured Launch Doctor evidence tests;
5. deterministic Flight Recorder assembly/validation tests;
6. local acceptance-gate evidence tests;
7. full frontend regression/build and contract regression gates.

No mainnet transaction, ownership acceptance, freeze or genesis declaration belongs to this phase's code patch.

## New commands

```bash
npm run mainnet:manifest -- --input <reviewed-json>
npm run launch:gates
npm run flight:record -- --input <base-json> --doctor <doctor-json> --manifest <manifest-json> --acceptance <gates-json>
```

## Approval boundaries preserved

- mainnet deployment broadcast: explicit approval at the exact step;
- `acceptOwnership()`: separate explicit approval after pre-acceptance finalized certification;
- renderer/experiment freeze: separate explicit approval;
- canonical `R3OS_MAINNET_GENESIS` declaration: only after post-deploy acceptance evidence is complete.
