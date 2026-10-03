# Monad hardware experiments

Phase MONAD-HW treats Monad as the hardware underneath r3tardOS 98. The feature is intentionally an add-on: no existing core, Pass or Lab contract is modified. Removing all three new contracts and all four frontend programs leaves the rest of the system unchanged.

The four programs share one frontend hardware probe layer and one `HardwareBus` strip:

| Program | Device | Purpose |
|---|---|---|
| PAGE.EXE | STORAGE | measure and use MIP-8 4 KiB storage pages |
| Block Camera | CONSENSUS + CLOCK | turn proposer, epoch, parent hash and block number into an onchain portrait |
| Kernel Debugger | EXECUTION | demonstrate the MIP-4 reserve condition and the documented isolate/check/unwind pattern |
| Monad Hardware | all | System Information / Device Manager for the measured hardware model |

Nothing in these screens is presented as measured or present unless the app actually probed it. Protocol constants are labelled `spec`; chain values are labelled `onchain`; gas/timing/runtime-size measurements are labelled `measured`; unavailable devices are `absent` or `unknown`.

## Monad facts used by this phase

These are the facts supplied and verified for this phase before testnet deployment:

- **MIP-8 / MONAD_TEN:** a storage page is 128 consecutive 32-byte slots, or 4,096 bytes. `page = slot >> 7`. The first SLOAD on a page is cold (about 8,100 gas under the measured local Monad mode); later slots on that same page are warm (about 100 gas) for the rest of the transaction. Mapping keys hash to independent pages. MIP-8 was live on testnet from 2026-08-12 and mainnet from 2026-09-02.
- **MIP-3:** transaction memory has linear pricing up to 8 MiB. The supplied mainnet activation date is 2026-03-12.
- **MIP-4 reserve device:** `0x0000000000000000000000000000000000001001`, selector `0x3a61584e`, `CALL` only. `STATICCALL`, `DELEGATECALL` and `CALLCODE` are not valid access paths.
- **Reserve rule:** for EOAs, transaction-end balance may not finish below `min(balance at transaction start, 10 MON)`, except for an allowed emptying transaction. The supplied emptying condition is an undelegated sender that sent no other transaction in the previous `k = 3` blocks. The reserve precompile evaluates the condition on current state, so restoring the balance inside the same transaction clears it.
- **Staking device:** `0x0000000000000000000000000000000000001000`, `CALL` only. `getEpoch()` returns `(uint64 epoch, bool inEpochDelayPeriod)` and `getProposerValId()` returns a `uint64` validator id. Solidity `view` wrappers would use `STATICCALL`, so the contract adapter deliberately uses non-view low-level `CALL`.
- **EIP-2935 history:** `0x0000F90827F1C53a10cb7A02335B175320002935`, with the 8,191-block history window used elsewhere by the auction.
- **P256 / RIP-7212:** `0x0000000000000000000000000000000000000100`. The hardware screen probes it with the fixed 160-byte vector recorded in `src/chain/monadHardware.ts`; a valid vector returns a 32-byte `1`, while invalid input returns empty data.

## Local Monad-mode measurements

The supplied pre-testnet measurements came from:

```bash
anvil --network monad --hardfork monad:MonadTen
```

Observed MIP-8 measurements:

| Operation | contiguous | scattered | observation |
|---|---:|---:|---|
| 128 reads | 40,552 gas | 1,072,745 gas | ~26× difference |
| 16 reads | 12,104 gas | 134,129 gas | same-page warming is already obvious |
| 128 fresh writes | 2,218,710 gas | 3,607,527 gas | ~1.6×, not 26× |

Fresh SSTORE dominates write cost. The PAGE.EXE UI therefore never claims that a 4 KiB page makes fresh writes 26× cheaper.

Local Monad-mode reserve observations from a 1 MON EOA sending 0.2 MON:

- one transaction by itself: `dippedIntoReserve() == false` because the transaction qualifies as an emptying transaction;
- `ping()` followed immediately by the value-moving transaction with consecutive nonces: `true`;
- after refunding the value inside the transaction: `false`.

The local anvil implementation exposes the reserve precompile but did **not** enforce the transaction-end revert in the supplied check. Testnet must establish the real receipt behavior for the naive burst. The UI always reports the actual receipt status rather than assuming the result.

Local Monad mode returned epoch/proposer zero values from the staking stub, supported the P256 vector, and did not expose the EIP-2935 history contract.

## Shared contract hardware adapter

`contracts/src/lib/MonadHW.sol` contains only internal helpers and constants:

- staking `0x1000`;
- reserve `0x1001`;
- P256 `0x0100`;
- EIP-2935 history address;
- `PAGE_SLOTS = 128` and `PAGE_BYTES = 4096`;
- `proposerValId()` and `epoch()` through bounded low-level `CALL`;
- `dippedIntoReserve()` through bounded low-level `CALL`;
- `pageOf(slot) = slot >> 7`.

Missing/reverting/empty precompiles produce `ok = false` and zero values. The helpers do not turn absence into a revert.

`contracts/src/lib/R3tardsPalette.sol` is a pure copy of the core's exact 16 RGB values for Block Camera. The core itself is not modified merely to expose an internal palette helper.

## PAGE.EXE

Contract: `R3tardsPageExe`

Registry name: `page-exe`

There is no owner, admin, minting or fund custody.

### Benchmark storage

`BENCH_BASE` is 128-slot aligned. The three benchmark patterns are:

- contiguous: `BENCH_BASE + i`;
- scattered: `BENCH_BASE + 128 * (i + 1)`;
- mapping-style: `keccak256(abi.encode(i, BENCH_BASE))`.

`probePage()` measures a cold read, a second slot on the same page, and the first slot of the next page with `gasleft()` and reports the empty measurement overhead separately.

`benchRead(pattern, n)` supports `n <= 128`.

`benchWrite(pattern, n)` performs the writes, measures them, then **always reverts** with:

```solidity
BenchWriteResult(uint256 gasUsed, uint256 overhead)
```

The frontend performs that method through `eth_call`, decodes the custom error and displays the measurement. The revert guarantees that benchmark writes never persist.

### One real page per wallet

`USER_BASE` reserves the low 167 bits for `address << 7`, producing one aligned page per 160-bit wallet:

```text
pageBaseSlot(owner) = USER_BASE + (uint160(owner) << 7)
```

`writePage(offset, words)` can write only the caller's own 128-word page and emits the written words in `PageWritten`, so every page version is reconstructible from logs.

The frontend exposes:

- the page index and base slot;
- a 128-row × 32-byte hex/ASCII viewer;
- a 4,096-byte 4bpp interpretation as a 128×64 image, high nibble first;
- a tiny pencil + 16-colour palette editor;
- a write that submits only the minimal covering word range containing changes;
- read-only viewing of any address's page.

## Block Camera

Contract: `R3tardsBlockCamera`

Registry name: `block-camera`

Block Camera mints through the existing `R3tardsLabs` collection. It does not create another NFT collection.

`bindExperimentId` follows the same one-time registry validation pattern as Flipbook. `capture()` permits at most one capture per wallet per block and seals:

- the capture block number;
- **parent hash** `blockhash(block.number - 1)`; a contract cannot read its own block hash;
- timestamp;
- current Paint season;
- proposer validator id plus known/unknown flag;
- epoch, delay flag and known/unknown flag;
- capturer address.

Proposer and epoch are read with non-view `CALL`s during the capture transaction. Proposer identity is art/provenance, **not randomness**.

### Portrait rules

The portrait is a deterministic 32×32 grid using the r3tards 16-colour palette and rendered as crisp SVG horizontal rect runs.

- validator id → a 12×12 mirror-symmetric glyph and deterministic two-colour pair;
- unknown proposer → one fixed dithered-grey question-mark glyph using only palette black/white;
- `epoch % 4` → solid, horizontal scanline, vertical scanline or checker background;
- epoch hash → two background colours;
- epoch-delay period → alternating top warning row;
- parent hash → 16 one-pixel stars outside the validator glyph;
- `blockNumber & 0xffffffff` → literal 32-bit barcode across the bottom two rows;
- capturer → a 2×2 corner mark;
- season → 1px frame colour.

The timestamp is metadata only because second-resolution timestamps repeat across many fast blocks.

Labs metadata reports Block, Epoch, Epoch Delay, Proposer, Parent Hash, Season, Captured By and Staking Device. Block Camera artifacts cannot themselves be burned through Labs. They may be referenced as immutable tracks on a mixed CD; burning that CD does not transfer or destroy the photo NFT.

The live viewfinder is only a preview of the current head. The actual NFT is rebuilt from the inclusion block captured onchain.

## Kernel Debugger

Contract: `R3tardsKernelDebugger`

Registry name: `kernel-debugger`

The contract has no owner/admin. The only funds it can retain are explicit `credits[msg.sender]`, withdrawable only by that same address.

This is **not a new execution primitive**. It demonstrates the documented MIP-4 pattern: isolate an optional step, check the reserve condition, and unwind value before commit when necessary.

### Process flow

`ping()` only emits the sender and block. Its purpose is to make the following transaction non-emptying when the same low-balance key sends both transactions back-to-back.

`run(graceful, failOptional)`:

1. writes the primary process counter / last-run block;
2. checks the reserve device;
3. executes an external self-call for the optional state step, so failure rolls back only that frame;
4. if value was supplied and the graceful path sees a reserve dip, returns the value with a 10,000-gas refund call, then re-checks the reserve device;
5. otherwise records the value as withdrawable credit;
6. emits a `ProcessReport` with exactly what happened.

"Deferred" in the UI means **not done in this transaction; the value was returned**. Nothing can collect that payment later without a new user-signed transaction.

### Process key

The frontend uses a throwaway process key stored separately from the Paint live burner:

```text
r3os.kernel.key.<chainId>.<owner>
```

The key uses the app's own fallback/rate-limited transport. It is intentionally funded with only 0.05 MON and must remain below 10 MON for the reserve condition experiment to be meaningful. "Sweep back" returns the remaining key balance to the connected wallet.

Scenarios use 0.01 MON by default:

- **SINGLE**: one graceful `run`; normally emptying, therefore no reserve condition;
- **BURST GRACEFUL**: send `ping` and graceful `run` with consecutive nonces without waiting for the ping receipt;
- **BURST NAIVE**: same burst, but no refund/unwind. On Monad this is expected to revert if the reserve rule is enforced.

The fixed gas limits are:

```text
ping = 40,000
run  = 160,000
```

The app intentionally does not call `eth_estimateGas` for these two operations because estimation would simulate a different emptying context. The Kernel screen is built only from actual receipts and `ProcessReport` logs. If the naive run reverts there is no surviving report, so any reserve explanation is explicitly labelled as an **inference** from the reverted receipt, never fabricated as measured contract output.

## Monad Hardware / Device Manager

The shared frontend probe layer is `src/chain/monadHardware.ts`.

Session-cached probes:

- reserve precompile by `eth_call`;
- EIP-2935 history by `eth_getCode`;
- P256 by the fixed valid vector;
- client version;
- Paint, Pass, Labs and registered Lab runtime code sizes;
- PAGE.EXE `probePage`, when deployed;
- chain id.

Epoch and proposer are refreshed every 30 blocks. The system screen also consumes the normal block clock EMA and the last Monad X-ray transaction trace when available.

The five bus devices are:

```text
CLOCK · STORAGE · CONSENSUS · EXECUTION · ROM
```

A status light is never shown as present unless the corresponding value was probed/measured. Clicking a bus device opens Monad Hardware focused on that device row.

## Testnet confirmations still required

The local measurements deliberately do not substitute for Monad testnet. Before mainnet, testnet must confirm:

1. MIP-8 read/write benchmark ratios under the deployed PAGE.EXE contract.
2. Staking precompile epoch/proposer values and the interpretation of proposer id.
3. Whether a BURST NAIVE reserve dip actually produces a reverted receipt and full gas-limit charge.
4. Whether graceful refund clears the reserve condition and commits successfully under the live rule.
5. P256 availability and EIP-2935 presence on the target network.
6. Runtime code sizes against the 128 KiB limit.
7. Block Camera full Labs `tokenURI` stays comfortably below the existing Labs render cap and the phase's 3M regression target.

## Benchmark pitfalls (found in local verification)

The optimizer will quietly delete the thing a gas benchmark is measuring:

- **An SLOAD whose result is unused is removed.** `probePage()` first reported 2 gas for cold, warm and next-page reads. The load now feeds a branch *before* the second `gasleft()`, and `testProbePageMeasuresColdWarmAndNextPage` guards it. Measured on Monad-mode anvil: cold 8,157 / warm 128 / next page 8,134.
- **SSTOREs followed by a provably unconditional revert are removed,** because the revert discards them anyway. `benchWrite` first reported about 285 gas per fresh write. The revert is now guarded by a `gasleft()`-derived condition the compiler cannot prove, and `testBenchWriteMeasuresRealStores` guards it. Measured: 128 fresh writes cost 2,232,279 gas contiguous vs 3,615,911 scattered.
- **Every measurement must be its own `eth_call`.** Inside a multicall, an earlier call can warm the page first.
