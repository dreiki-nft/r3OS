# System Event

`R3OSSystemEvent` is the permanent `.333` system-event latch used by r3OS DEVICE 07. It has one job: once a fresh Chainlink MON/USD round reports a value at or above the configured threshold, anyone can permanently latch that fact onchain.

The frontend discovers it through the Paint experiment name `system-event`.

## Trigger

The contract exposes:

```text
TRIGGER = "MON_PRICE_TRIGGER"
THRESHOLD_MILLI_USD = 333
```

With the launch value of 333 milli-USD, the condition is MON/USD >= $0.333. The deployed contract value is authoritative; the frontend reads it instead of hard-coding the price.

`THRESHOLD` is converted to the feed's native decimals in the constructor.

## Oracle trust

Mainnet uses the Chainlink MON / USD proxy at:

```text
0xBcD78f76005B7515837af6b50c7C52BCf73822fb
```

On chain id 143 the constructor rejects every other feed address. The deploy script additionally checks that the proxy reports description `MON / USD` and 8 decimals before deployment.

The latch trusts one fresh Chainlink round. It does not calculate a price from DEX pools, browser APIs or an off-chain backend.

## Freshness

`condition()` returns:

```text
met
fresh
answer
updatedAt
roundId
```

The read never reverts. A failed feed call produces false/zero values.

A round is fresh only when all of these are true:

- `updatedAt != 0`;
- `updatedAt <= block.timestamp`;
- `block.timestamp - updatedAt <= MAX_AGE`;
- `answeredInRound >= roundId`.

The condition is met only when the round is fresh, the answer is positive and the answer is at least the configured threshold.

`MAX_AGE` is deployment configuration. Local/testnet deploys default to 90,000 seconds. **Mainnet has no default:** `DeployOperator.s.sol` requires `MON_FEED_MAX_AGE` to be supplied explicitly after checking the live feed heartbeat, so an old permissive test value cannot leak into launch.

## Activation

`activate()` is permissionless. No privileged account is required to latch the event once the oracle condition is true.

On the first valid activation the contract stores:

- activation block;
- activation timestamp;
- Chainlink round id;
- Chainlink answer.

It emits `SystemEventActivated` with the trigger hash and activator.

After activation the state is permanent. A second call reverts.

## No owner, reset or fallback

The contract deliberately has:

- no owner;
- no admin role;
- no pause;
- no reset;
- no oracle-migration function;
- no Safe override;
- no payable function.

That removes discretionary activation, but accepts a liveness risk: if the configured Chainlink proxy stops providing fresh rounds before the condition is reached, this deployment cannot be repaired and the event never fires.

The mainnet design accepts that tradeoff. Chainlink proxy upgrades can change the underlying aggregator while retaining the proxy address, but the contract itself has no migration assumption or back door.

## Testnet and local chains

Monad Cards are mainnet-only, but this event also needs a deterministic local/testnet path. `MockMonUsdFeed` provides the same V3 read surface with 8 decimals and description `MOCK MON / USD`.

For local or testnet checks:

```text
3,000,000  = $0.03000000 -> ARMED
33,300,000 = $0.33300000 -> CONDITION MET
activate()                -> ACTIVATED permanently
```

`setUpdatedAt` exists only on the test mock for stale-round checks.

## Frontend states

DEVICE 07 presents four truthful states:

- driver not installed;
- ARMED;
- CONDITION MET, not yet latched;
- ACTIVATED at block N.

The oracle meeting the condition and the onchain latch are intentionally separate states. The UI only offers ACTIVATE while the feed currently reports the condition and the event has not yet been latched.

After activation, DEVICE 07 still reports `Driver: Not installed` and `Next stage: Unknown`. The current product does not invent a post-activation stage.

## Future hook

Future contracts can read only the permanent fact they need:

```solidity
SYSTEM_EVENT.activatedBlock();
SYSTEM_EVENT.activatedBefore(blockNumber);
```

Combined with Operator Record, a future experiment can query whether a specific fact was proven by the activation block while preserving the distinction between exact and observed history.
