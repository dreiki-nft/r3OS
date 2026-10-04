# Monad hardware experiments

r3OS exposes Monad-specific chain behavior as parts of the computer rather than hiding it behind generic web3 UI.

Fresh mainnet keeps two contract-backed hardware experiments:

| Surface | Device | Purpose |
| --- | --- | --- |
| PAGE.EXE backend | STORAGE | measure and use MIP-8 4 KiB storage pages |
| Block Camera | CONSENSUS / ROM | turn inclusion-block and staking context into an onchain artifact |

The standalone PAGE.EXE window was folded into **Explore Monad → Storage race**. Block Camera remains a first-class program. CARD.DRV is specified separately in `MONAD_CARD.md`.

## Monad facts used by r3OS

- **MIP-8 / MonadTen:** one storage page is 128 consecutive 32-byte slots, or 4,096 bytes. `page = slot >> 7`. The first access to a page is cold; later accesses to the same page are cheaper for the rest of the transaction.
- **Staking device `0x1000`:** Block Camera uses bounded low-level calls for proposer/epoch information. Missing or reverting device calls are represented as unknown rather than causing the artifact flow to fail.
- **P256 `0x0100` and EIP-2935 history:** detected by System Information as network capabilities. EIP-2935 is also relevant to the finale auction.
- **Runtime limit:** launch tooling checks deployed bytecode against Monad's 128 KiB contract-size ceiling.

Exact network behavior and public-RPC support are treated as live observations; local Monad-mode measurements are evidence, not a mainnet guarantee.

## Shared contract hardware adapter

`contracts/src/lib/MonadHW.sol` contains bounded helpers/constants used by active contracts:

- staking `0x1000`;
- P256 `0x0100`;
- EIP-2935 history address;
- `PAGE_SLOTS = 128` and `PAGE_BYTES = 4096`;
- proposer/epoch reads;
- `pageOf(slot) = slot >> 7`.

Missing/reverting/empty device calls produce an unavailable result rather than fabricating support.

`contracts/src/lib/R3tardsPalette.sol` is a pure copy of the core's exact 16 RGB values for Block Camera. The collection name here describes the actual palette asset, not the r3OS product brand.

## PAGE.EXE backend

Contract: `R3OSPageExe`

Registry name: `page-exe`

There is no owner, admin, minting or fund custody.

### Benchmark storage

`BENCH_BASE` is 128-slot aligned. The benchmark patterns are:

- contiguous: `BENCH_BASE + i`;
- scattered: `BENCH_BASE + 128 * (i + 1)`;
- mapping-style: `keccak256(abi.encode(i, BENCH_BASE))`.

`probePage()` measures a cold read, another slot on the same page, and the first slot of the next page with `gasleft()`, reporting measurement overhead separately.

`benchRead(pattern,n)` supports `n <= 128`.

`benchWrite(pattern,n)` performs the writes, measures them, then always reverts with:

```solidity
BenchWriteResult(uint256 gasUsed, uint256 overhead)
```

The frontend calls it through `eth_call`, decodes the custom error and displays the measurement. The revert guarantees benchmark writes never persist.

### One real page per wallet

`USER_BASE` reserves the low 167 bits for `address << 7`, producing one aligned page per 160-bit wallet:

```text
pageBaseSlot(owner) = USER_BASE + (uint160(owner) << 7)
```

`writePage(offset,words)` can write only the caller's own 128-word page and emits the written words, so every page version is reconstructible from logs.

Explore Monad exposes the page index/base slot, a hex/ASCII viewer, a 4bpp interpretation and minimal covering-word writes.

## Block Camera

Contract: `R3OSBlockCamera`

Registry name: `block-camera`

Block Camera mints through `R3OSLabs`; it does not create another NFT collection. `bindExperimentId` validates the registry entry once. `capture()` permits at most one capture per wallet per block and seals:

- inclusion block number;
- parent hash `blockhash(block.number - 1)`;
- timestamp;
- current Paint season;
- proposer validator id + known/unknown flag;
- epoch + delay/known flags;
- capturer address.

Proposer/epoch context is provenance and art input, **not randomness**.

### Portrait rules

The portrait is a deterministic 32×32 grid using the r3tards 16-colour palette:

- validator id → mirror-symmetric glyph + deterministic colour pair;
- unknown proposer → fixed grey question-mark glyph;
- epoch → background pattern/colours;
- epoch-delay period → warning row;
- parent hash → stars outside the glyph;
- block number → literal barcode across the bottom;
- capturer → corner mark;
- season → frame colour.

Labs metadata reports Block, Epoch, Epoch Delay, Proposer, Parent Hash, Season, Captured By and Staking Device. Block Camera artifacts cannot be recycled, but can be referenced as immutable CD tracks without transferring or destroying the portrait NFT.

The live viewfinder is only a preview. The NFT is rebuilt from the inclusion block captured onchain.

## System Information

`src/chain/monadHardware.ts` is the shared frontend probe layer. Session-cached probes include network/device capability checks, contract runtime sizes, PAGE.EXE `probePage` when deployed, chain id and client information. Epoch/proposer refresh on a bounded cadence. System Information also consumes the normal block-clock EMA and the last X-ray trace when available.

The device bus is a UI representation of measured/probed capabilities. A device is never shown as present merely because the code knows its expected address.


## Benchmark pitfalls

The optimizer will remove work that cannot affect observable output. PAGE.EXE tests therefore guard the benchmark implementation itself:

- loaded storage values feed observable branches before the next `gasleft()` so SLOADs are not optimized away;
- benchmark SSTOREs sit behind a condition the compiler cannot prove before the deliberate revert;
- every measurement is its own `eth_call`, because earlier calls inside a multicall could warm a page and poison the comparison.
