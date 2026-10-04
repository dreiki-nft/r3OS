# Static analysis (forge-lint) review

`forge build` runs forge-lint on `src/`. Before launch (2026-10-01) every finding was reviewed. The build is
now silent: compiler warnings were fixed, by-design categories are excluded in `contracts/foundry.toml`, and the
security-relevant categories stay **on**, silenced only at the reviewed lines with
`// forge-lint: disable-next-line(...)` or a `disable-start` / `disable-end` range. A new instance of those
categories anywhere else will show up in the build output.

Note: the standalone `forge lint` command (Foundry 1.8.3) fails to parse `Ownable(...)` base-constructor
arguments ("expected base class or modifier"). That is a Foundry parser issue; use `forge build --force` to see
lint output.

## Line-level suppressions (reviewed, kept on project-wide)

| Lint                                  | Where                                                                                                                       | Why it is safe                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reentrancy-eth`, `reentrancy-no-eth` | FinaleAuction withdrawals, Sleepwalker sleep/resume/step/wake/refunds, KernelDebugger run/withdraw, Forks, Flipbook         | Pull payments; balances are zeroed and state is final before the external call; every entry point is `nonReentrant`. External calls go to the core or the lab's own clone.                                                                                                                             |
| `arbitrary-send-eth`                  | Sleepwalker refunds / tips, RouterLab `simFrame`                                                                            | Sleepwalker pays the owner's own deposit or the keeper's tip. RouterLab sends only inside `simulateNativeIn`, which always reverts, so no value leaves.                                                                                                                                                |
| `msg-value-loop`                      | RouterLab `simulateNativeIn`                                                                                                | Each venue frame reverts, so `msg.value` is reused per frame on purpose and the whole call reverts.                                                                                                                                                                                                    |
| `return-bomb`                         | tokenURI renderer / lab / stamp-source reads, OperatorRecord reads, MonadHW precompile reads, RouterLab adapter/token reads | Gas-capped staticcalls. Return size is bounded by the callee's gas cap; covered by `testReadFailuresAreConditionFailuresAndReturnBombIsBounded` and `test_FailingAndGasHungryLabsStillReturnValidJson`. Targets are owner-registered, fixed precompiles, or used only in always-reverting simulations. |
| `missing-zero-check`                  | BlockCamera `cardMemory`, RouterLab                                                                                         | `CARD_MEMORY` is optional by design (see PRE_MAINNET_CHECKLIST F1); RouterLab inputs are simulation-only.                                                                                                                                                                                              |

## Excluded categories (by design here)

`unsafe-typecast`, `uninitialized-local`, `boolean-cst`, `reentrancy-events`, `calls-loop`,
`require-revert-in-loop`, `encode-packed-collision` (only JSON/SVG string building, never hashed),
`block-timestamp` (season/open times and signature deadlines), `unused-return`, `unsafe-oz-erc721-mint`
(`_mint` on purpose: no receiver callbacks in the paint path), `weak-prng` (block-number buckets, storm
schedule and visual seeds; nothing of value depends on them), `divide-before-multiply` (pixel quantisation in
art libraries), `incorrect-strict-equality` (`balanceOf != 0` holder checks). The reason for each is also
next to it in `foundry.toml`.

## Compiler warnings fixed

- `R3OSSleepwalker`: two `uint128(1) << i` shifts rewritten as `uint256` shifts. Behaviour is identical
  (`i < MAX_SURVIVAL_SAMPLES = 128`).
- `MockMonadCard` (test / testnet mock): soulbound check moved to `_update`, removing OpenZeppelin's
  "unreachable code" warning. Transfers and safe transfers still revert `Soulbound()`.
- Tests: view mutability, unused locals, named returns on the gas-burner mock, and `vm.getBlockNumber()`
  instead of `block.number` after `vm.roll`.
