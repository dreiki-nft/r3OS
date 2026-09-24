# contracts

`R3tardsPaint.sol` is the canonical onchain state machine.

## Foundry

From this folder, after root `npm install`:

```bash
forge install foundry-rs/forge-std --no-commit
forge test -vvv
```

The OpenZeppelin remapping points at the root npm dependency so Remix and local compilation can use the same published package rather than copied source.

## Remix

The production deployment has **no constructor arguments**.

Compile `src/R3tardsPaint.sol` with:

- Solidity `0.8.28`
- optimizer enabled, 200 runs
- EVM version `prague`

Deploy to Monad testnet first (chain ID `10143`), exercise the full app, then compile the exact same source/settings and deploy on Monad mainnet (chain ID `143`).

The contract deliberately rejects deployment on unrelated production chains. Chain ID `31337` is allowed solely for local Foundry/Anvil testing.
