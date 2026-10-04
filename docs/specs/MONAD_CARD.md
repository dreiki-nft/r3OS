# Monad Card / CARD.DRV

Phase MONAD CARD plugs the official Monad Card into r3OS as a hardware identity device without modifying the card contract. `R3tardsCardMemory` is a separate, ownerless driver: every card id addresses one raw 4 KiB storage page and only the card's current `ownerOf(cardId)` may write it.

The driver is registered in the Paint experiment registry as `card-drv`. The frontend program is `CARDMEM.EXE`. PAGE.EXE, Kernel Debugger, Block Camera, Monad Hardware, the Painter Pass and Quests all consume the same driver/page state.

The official card contract is never wrapped, escrowed, transferred or modified by this feature.

## Trust and authority

`R3tardsCardMemory` has:

- no owner or admin;
- no upgrade path;
- no payable function and no funds;
- no token, wrapper, points or leaderboard;
- no allowlist or backend;
- no signature, approval or Paint-session-key write path.

A write succeeds only when `msg.sender == ownerOf(cardId)`. Contract-wallet owners work because the contract wallet itself may be `msg.sender`.

The constructor requires a non-zero contract address. On chain id 143 it additionally requires the immutable card address to equal:

```text
0x0000CA12D5c07085022eBC74867157449919Fd67
```

Testnet and local deployments use `MockMonadCard`; Monad Cards are mainnet-only.

## Page placement

Every card id receives one 128-word, 4,096-byte page:

```text
base = uint256(keccak256(abi.encode("r3tards.card.drv.v1", cardId))) & ~uint256(127)
page = base >> 7
```

The card id is a full `uint256`; CARD.DRV does not assume sequential ids or impose an id bound. The base is always 128-word aligned. Distinct ids therefore map to disjoint pages except for a 249-bit aligned-keccak collision.

The owner-to-card convenience index uses an explicit set marker, so `type(uint256).max` remains a valid card id.

## Page format v1

Bytes are offsets inside the 4 KiB page. Bytes inside each 32-byte word are displayed big-endian.

| Bytes | Words | Region | Convention |
|---|---:|---|---|
| `0x000–0x01F` | W0 | HEADER | driver-owned; users can never write it |
| `0x020–0x03F` | W1 | LABEL | 32 printable ASCII bytes, left-aligned and zero-padded |
| `0x040–0x23F` | W2–W17 | ICON | 32×32 pixels, 4-bit r3tards palette, row-major, high nibble first |
| `0x240–0x2BF` | W18–W21 | MESSAGE | 128 printable ASCII bytes, zero-padded |
| `0x2C0–0x2DF` | W22 | FLAGS | byte 0 boot flags; byte 1 accent+1; remaining bytes user flags |
| `0x2E0–0x2FF` | W23 | reserved | zero by convention |
| `0x300–0x37F` | W24–W27 | CARD BUS reserve | zero this phase; draft below |
| `0x380–0x3FF` | W28–W31 | reserved | zero by convention |
| `0x400–0xFFF` | W32–W127 | USER | 3,072 free-form bytes |

Only W0 is enforced by the contract. W1–W127 are raw EEPROM. CARDMEM.EXE respects the v1 regions and does not write reserved words, but a direct owner call may write any non-header word. Non-zero reserved words are displayed as `non-standard`; they are not censored or rewritten.

### Header W0

The driver owns W0. A zero header means `UNFORMATTED`. The first successful write formats the page.

```text
bits 255..224  magic            0x43415244  "CARD"
bits 223..216  version          1
bits 215..208  header flags     0 (reserved)
bits 207..176  writes           uint32
bits 175..128  firstWriteBlock  uint48
bits 127..80   lastWriteBlock   uint48
bits 79..0     zero
```

Every successful `write` increments the trusted write counter and updates `lastWriteBlock`; the first write also records `firstWriteBlock`.

## Writes and replay

`write(cardId, wordOffset, words)` requires:

- `wordOffset >= 1` because W0 is driver-owned;
- `wordOffset < 128`;
- at least one word;
- the complete range to fit through W127;
- a real `ownerOf(cardId)` result;
- `msg.sender` to equal that owner exactly.

The owner lookup is a bounded `staticcall`. Revert, short returndata and `address(0)` are all treated as a nonexistent card.

Every successful write emits:

```solidity
CardWritten(cardId, owner, wordOffset, writes, words)
```

The event carries the full changed words. Page history is therefore public and replayable forever even after later overwrites. Do not store secrets, private keys, passwords or private messages in CARD.DRV.

## Reads and hashes

The driver exposes:

- `cardOwner(cardId)`;
- `cardInfo(cardId)`;
- `readPage(cardId)`;
- `readWords(cardId, offset, count)`;
- `pageBaseSlot(cardId)` and `pageIndexOf(cardId)`;
- `cardOf(owner)` for the most recently written card that the owner still owns;
- `pageHash(cardId)` over the raw 4,096-byte page;
- `readCost(cardId)` for an isolated, cold-page gas measurement.

The hash of a completely empty 4 KiB page is:

```text
0xa8bae11751799de4dbe638406c5c9642c0e791f2a65e852a05ba4fdf0d88e3e6
```

`readCost` XOR-accumulates all 128 SLOAD results and consumes the accumulator before the second `gasleft()` so the optimizer cannot delete the reads. The frontend invokes it as its own `eth_call`, never inside a multicall where another call could warm the page.

## Discovery

The frontend deliberately does not scan historical card `Transfer` or claim events. Months of 300 ms blocks are not compatible with the app's bounded Phase-5 log policy, and the official card ABI was not available when this phase was written.

Discovery order is:

1. `R3tardsCardMemory.cardOf(wallet)`, then verify the id with the card's `ownerOf`;
2. a per-chain/per-wallet id remembered in localStorage, then verify it with `ownerOf`;
3. the Found New Hardware flow in CARDMEM.EXE, where the user enters an id and the app verifies `ownerOf`.

If `balanceOf(wallet) > 0` but no id can be resolved, the truthful state is `card detected, number unknown`.

LocalStorage is convenience only. It grants no authorization and a stale remembered id is ignored when `ownerOf` no longer matches.

## CARDMEM.EXE

CARDMEM.EXE is the structured EEPROM programmer.

It provides:

- a generic r3OS cartridge drawing, not official Monad Card artwork;
- capacity, used/free bytes, writes, page, slot, owner and last-write block;
- label and message ASCII editors;
- a 32×32 palette icon editor;
- boot-banner and accent fields;
- 3,072 bytes of free-form USER hex memory;
- a raw 128-word hexdump with region labels and pending changes;
- one `WRITE TO CARD` operation using the minimal contiguous changed word range;
- a receipt-derived write log with block, word range, gas used and status.

When the owner is a contract wallet and the connected EOA is not the owner, CARDMEM.EXE stays read-only and can copy the exact `write` calldata for submission through that contract wallet.

## PAGE.EXE and private-page traffic

PAGE.EXE can switch between `WALLET PAGE` and `CARD PAGE`.

The card page reuses the same 128×64 nibble view and hexdump but is read-only there. Programming stays centralized in CARDMEM.EXE.

CARD READ shows the standalone `readCost(cardId)` result next to PAGE.EXE's measured 128-scattered-slot benchmark.

`CARD TRAFFIC · PRIVATE PAGES` runs only when the user presses SCAN. It reads `CardWritten` logs for the last 3,000 blocks through `src/chain/logs.ts`, then fetches at most 50 transaction receipts and groups real writes by block.

The table can report where writes landed, distinct pages, words written, receipt gas and status. Monad RPC does **not** expose conflict or re-execution counts, so the UI does not pretend to measure them. The aggregation helper is generic so a future shared/contended page source can use the same table.

## Kernel Debugger

Kernel Debugger adds a local command line:

```text
C:\KERNEL>help
C:\KERNEL>device <id>
C:\KERNEL>dump <id> [word] [count]
```

`device` prints CARD.DRV ownership, page, slot, format, write blocks and page hash.

`dump` reads the requested words and prints their absolute storage slots, raw hex, ASCII and v1 region. It separately calls `eth_getStorageAt` for the CARD.DRV base slot and compares that value to `readPage[0]`, making the storage inspector a real RPC cross-check rather than a rendered copy of the same frontend state.

## Block Camera commitment

Plain `capture()` remains a normal Block Camera shot.

`captureCard(cardId, withCanvas)` is available only when Block Camera was constructed with a CARD.DRV address and only to the card's current owner. It commits:

- the card id;
- the CARD.DRV page hash at capture time;
- the trusted CARD.DRV write counter;
- optionally, `keccak256(PAINT.getCanvas(season))`.

The page hash is always included because reading/hashing one MIP-8 page is cheap relative to the 32 KiB canvas. The canvas hash is opt-in because the measured full-canvas hash is much heavier.

Card-shot metadata is immutable with respect to later CARD.DRV edits: rendering reads the stored capture commitment, never the card's current mutable page. The visual remains a Block Camera portrait; its bottom row is replaced by the first 32 nibbles of the stored card-page hash. It is never presented as official Monad Card artwork.

## Painter Pass and CARD CARRIER

`R3tardsCardMemory` implements the existing stamp interface:

```text
MONAD CARD = balanceOf(painter) > 0
```

Failures return false instead of reverting. The Pass already gas-caps and validates external stamp-source returndata.

`DeployMonadCard.s.sol` appends the `MONAD CARD` stamp source and the `CARD CARRIER` quest. With the current deployment order the card source is source id 7, so its Pass pin is 13 (`6 + sourceId`) and two pin positions remain.

CARD CARRIER has two immutable onchain conditions:

1. Monad Card `balanceOf(painter) >= 1`;
2. Paint `painterStats(painter)` return word 2 (`totalPixelsPainted`) >= 143.

It is quest id 13 in the current suite and is added by the CARD.DRV add-on script, not by the base day-one deploy script.

## Device Manager provenance

The hardware screen separates chain facts from supplied specifications:

- card contract, page, writes and driver version come from chain reads when CARD.DRV is installed;
- code size is measured with `eth_getCode`;
- ERC-5192 `locked(id)` is `onchain` only when `supportsInterface(0xb45a3c0e)` answers true;
- `Manufacturer: Monad` is `spec` only on chain 143 at the official address;
- soulbound status may fall back to `spec` only for that same official address;
- mocks without an ERC-5192 result remain `unknown`, never silently promoted to official facts.

## Measurements supplied for this phase

Under `monad:MonadTen` with Foundry 1.8.3:

- `keccak256(PAINT.getCanvas(season))`: 589,537 gas for the 32 KiB canvas;
- one full 128-word CARD.DRV-style page read plus keccak: about 32,000 gas;
- earlier MONAD-HW measurement: 128 fresh contiguous SSTOREs about 2.23M gas;
- earlier MONAD-HW measurement: 128 contiguous reads about 50k vs about 1.08M scattered.

These local measurements explain why the page hash is always captured but the canvas hash is opt-in. Live UI values still come from chain reads/receipts rather than these prose numbers.

Measured on the assembled phase (Monad-mode anvil, mock card, 2026-09-30):

| Operation | Gas |
|---|---:|
| `readCost` (full 4 KiB page, cold, standalone `eth_call`) | 35,826 |
| first `write` (words 1–19: label, blank icon, message; formats the page) | 182,724 receipt |
| second `write` (words 5–15, 11 fresh icon words) | 259,007 receipt |
| `captureCard(id, false)` | 477,390 |
| `captureCard(id, true)` | 1,012,258 |

Zero→zero words inside a written range are nearly free, so a write's cost tracks how many words actually change from zero, not the range length.

## CARD BUS draft, not implemented

W24–W27 are reserved so a later phase can define a card-to-card signal without replacing CARD.DRV.

Draft encoding only:

| Word | Draft fields |
|---:|---|
| W24 | `signal uint16`, `callsign` 8 printable ASCII bytes, flags with bit 0 = `BROADCAST` |
| W25 | target card id |
| W26 | payload hash |
| W27 | reserved |

No contract or frontend in this phase interprets or sends CARD BUS messages. These four words must remain described as a draft reserve until a future protocol actually defines their behavior.

## Mainnet confirmations

Before deploying CARD.DRV against the official card, run `MonadCardFork.t.sol` with `MONAD_MAINNET_RPC` and a real `CARD_ID`.

The fork test confirms or records:

1. the official address has working ERC-721 `ownerOf` and `balanceOf` behavior;
2. a real owner can write and a non-owner cannot;
3. how `ownerOf` handles a nonexistent id: revert or zero;
4. `supportsInterface(0xb45a3c0e)` behavior;
5. `name()` and `symbol()` when available;
6. the real id supplied to the test without assuming a sequential width.

No fork test broadcasts to mainnet.

Testnet cannot validate the official card contract because Monad Cards exist only on mainnet. Testnet validates CARD.DRV with `MockMonadCard`; the mainnet fork is the compatibility gate for the official contract.
