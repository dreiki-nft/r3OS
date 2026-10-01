# ROUTER.EXE

ROUTER.EXE is a read-only execution-routing laboratory for r3tardOS. It demonstrates MRC-17-style propAMM quoting inside one EVM execution without moving user assets. The lab compares adapter quotes at one block state, isolates every quote in an always-reverting child frame, and returns diagnostics to an `eth_call` caller.

## MRC-17 revision

This phase targets **MRC-17 DRAFT**, Monad MIPs PR #91 at commit `6e4f86333923f0c4ec77bc92b3702f1b21f37446`. The two-function `IPropAMMRouter` ABI is copied locally and pinned in source. The interface remains a draft; a later MRC revision may require replacing the isolated ABI file and adapter metadata.

Reference adapter behavior was studied at `haythemsellami/mrc-17-adapters` commit `2f1400d17c262cec6c4860a99916accf7f3044d8`. The deployed adapter list is taken from the Monoper deployment manifest referenced by this phase. The adapters are third-party integration code under active development and are not treated as trusted r3tards contracts.

## Isolation model

`R3tardsRouterLab.compare` evaluates all configured venues in one top-level call. Each adapter quote is sent through `quoteFrame`, an external self-call that uses an ordinary gas-capped `CALL` and then reverts unconditionally with a structured envelope containing the quote result or bounded failure data. The parent catches that envelope and continues to the next venue.

The self-call/revert pattern follows the architecture demonstrated by Monoper, with two additional resource limits here: adapter gas is capped and revert/success returndata is bounded. A venue cannot make quote-side state persist, and a revert from one venue does not by itself discard reports from the others.

The UI's `rolled back` label is **by construction**, not an RPC measurement. Foundry isolation tests are the proof. ROUTER.EXE does not use `debug_*` or trace RPC methods.

## Same-state comparison

A RUN first reads a block number and then performs one `eth_call` of `compare` pinned to that block. All venue frames therefore see the same EVM block state and the same router-lab caller. If an RPC cannot serve a pinned block, the frontend may retry once at `latest` and must display that the block pin was unavailable.

The optional Monoper cross-check is a separate `eth_call` pinned to the same block number. It is therefore a same-block comparison, not part of the lab's single top-level call.

The selected venue is labelled **HIGHEST QUOTED OUTPUT**. Selection compares raw positive `amountOut` only. Gas is displayed separately and is never folded into an invented economic score. Equal outputs keep the lower candidate index.

## Resource policy

The lab supports at most eight venues. Each frame receives a caller-selected gas cap between 50,000 and 5,000,000 gas. Before entering the loop, the lab checks that enough top-level gas remains to fund every requested frame plus fixed envelope overhead. The STATICCALL probe is included in that budget when enabled.

Adapter revert data is truncated to 512 bytes while the full `returndatasize` is preserved. Successful quote returndata larger than 4,192 bytes is classified `OVERSIZED` without being copied in full. A successful result must strictly match the ABI shape `(uint256 amountOut, bytes swapData)`, including an offset of 64 and exact padded length.

`REVERTED_AT_GAS_CAP` is a measured heuristic: the adapter failed with empty returndata and consumed approximately the EIP-150-adjusted cap. It is not a statement about the venue's intent or general availability.

Measured locally (Monad-mode anvil, `monad:MonadTen`): `compare` over five mock venues costs 166k gas without the probe; the probe adds the full cap of any venue whose quote path writes state, because a state write inside STATICCALL halts the frame. `testWorstCaseVenuesFitPreflightBudget` runs eight hostile venues at the 5M cap (four burn their whole quote frame, return the largest accepted payload and then burn the whole probe; four revert with 1 MiB) with exactly the preflight budget plus 20k, and every row still comes back. Above about 3.5M per frame the 63/64 rule gives the adapter slightly less than the nominal cap (about 4.97M at 5M). Public Monad RPCs accept `eth_call` up to 200M gas, but calls above 8.1M gas run in the providers' smaller high-gas pool. Mainnet quotes measured on 2026-10-01 (1 WMON → USDC) used 55k–723k gas, so ROUTER.EXE defaults to 1M per frame with the STATICCALL probe off: a five-venue RUN asks for about 5.9M and stays in the low-gas pool. The INPUT DEVICE shows the request size, and a row that hits its cap suggests raising Gas / frame. Kernel `quote` (one venue) always includes the probe.

## Status taxonomy

Per-venue quote status is one of:

- `OK`: the call returned a strictly positive amount and valid ABI data;
- `ZERO OUTPUT`: valid ABI with zero output;
- `MALFORMED`: successful call whose returndata does not match the required ABI shape;
- `OVERSIZED`: successful quote returndata exceeded the lab's cap;
- `REVERTED`: the adapter reverted and bounded revert diagnostics were captured;
- `REVERTED AT GAS CAP`: the empty revert matched the gas-cap heuristic;
- `NO CODE`: the adapter address has no runtime code;
- `FRAME ERROR`: the self-call failed to produce the lab's expected sandbox envelope.

MRC-17 defines no generic distinction between an unsupported pair, temporarily unavailable liquidity, and an internal failure. Adapter-specific selectors may provide more context, but ROUTER.EXE labels those decodes as adapter-specific and otherwise shows the raw selector. A Metric `FeedStalled()` revert, for example, is reported as the decoded provider condition rather than converted into a judgment about the adapter.

## STATICCALL probe

When enabled, an `OK` quote is repeated with a gas-capped `STATICCALL`. `STATIC OK` means the same quote entry point completed in a static context. `STATIC FAILED` proves only that the path requires a non-static frame under that state and input; it may have attempted persistent or transient storage, logs, creation, or another operation forbidden by static execution.

Metric's legacy quote path is the important reference case: its quote mechanism is non-view and can fail under `STATICCALL`. The probe makes that property visible without tracing.

## Validity and expiry

The draft contains no generic quote-expiry field. The reference adapters in this phase return empty `swapData`; for them ROUTER.EXE shows `VALIDITY: not exposed (swapData empty)`.

For non-empty `swapData`, the lab reports its length and hash but treats its contents as opaque. The UI shows `VALIDITY: UNKNOWN (opaque swapData, N bytes)`. It does not invent a TTL or decode adapter-specific expiry unless a future standardized field exists.

## QUOTE SCOPE

QUOTE SCOPE is a WMON-input execution preview. It exists to compare a quote with the output delivered by an immediate same-state adapter call without requiring user funds to be transferred or approved persistently.

`simulateNativeIn` is payable only because an `eth_call` can supply temporary MON. The function **always reverts** with a `Simulation` report. For each venue, a self-only frame:

1. wraps the temporary MON into WMON;
2. obtains its quote through another isolated quote frame;
3. approves exactly the input amount to that adapter;
4. invokes the adapter's MRC-17 execution entry point with `amountOutMin = 1` and the returned `swapData`;
5. measures the lab's output-token balance delta;
6. reverts with the report.

The frame revert unwinds the WMON deposit, approval, venue call and received output. The top-level `Simulation` revert then unwinds the entire preview. A real transaction cannot leave value or tokens in the lab.

The frontend first tries a fixed throwaway sender with an `eth_call` balance override. If the RPC does not support state overrides, it may use the connected wallet as the call sender only when that wallet's *read* balance is sufficient. No signature is requested and no transaction is submitted.

This phase supports only wrapped-native input. Simulating arbitrary ERC-20 input would require token-storage overrides whose layout is not generic.

A same-state preview is not a guarantee for a later block. Hanji's reference adapter is specifically documented as using a quote ladder that is not itself an execution preview, so a quote may still differ from execution behavior.

## Mainnet venue configuration

Market discovery is outside MRC-17. ROUTER.EXE therefore does not invent a registry. Monad mainnet uses a static per-chain manifest of known adapter addresses, token pairs and expected runtime-code hashes. Before display, the frontend reads adapter runtime code and classifies it as `code hash matches manifest`, `code differs`, or `no code`.

A code-hash mismatch is a warning, not an automatic accusation and not an execution block: the address remains quotable so diagnostics can show what is actually deployed. Thog's underlying venue is upgradeable; the configured hash is for the adapter runtime itself.

The pinned Monad-mainnet directory is:

| Label | Pair | Adapter | Expected runtime code hash |
|---|---|---|---|
| `poe-mon-usdc` | WMON / USDC | `0xa13FEdc8f6Ae3b197F0aF0eF34a3E6F08fd999E1` | `0xa4372be09d0fe3ad470d5a9986841bf2ead48a3d7068c84297fae22716925148` |
| `clober-mon-usdc` | WMON / USDC | `0x438e3C0F7C66e8B4d788C743559D5076226A96D2` | `0x90c7b5cf315562ba81ed40559e0391ce2efe07796205486ea70a0b3963d4c927` |
| `metric-mon-usdc` | WMON / USDC | `0x63f951E2C726215a719aC4d8F7Ad6B1cA9dcAd3B` | `0x9ca7cec898e31cf9ffc6d1bb88aa53409e7c5ccdde8a4bbf2e8af9f24bdef33b` |
| `hanji-mon-usdc` | WMON / USDC | `0xFAAE283A98274a6c788dcBb66760EC4B76c48EB6` | `0x0b502bff967d1f4b0e7eca5f82bf007ba9a1027105ae3481c56761090d4cc497` |
| `thog-mon-usdc` | WMON / USDC | `0x7c87E2dFD32BDeEa11654866F5199E3aC9CC92eB` | `0xdcb04f597fcd089b13ca2fe213defc963d776c4fde428af3e99092ddd900906f` |
| `clober-weth-usdc` | WETH / USDC | `0xb465A460b40A35CBB422Ef8f442AD3Fe75A884Fb` | `0x56f025c7ec5d76c0eec1c6cbb7c37e1a4ec0e06baab38689b5b25fb14735bb8a` |
| `metric-weth-usdc` | WETH / USDC | `0x1925562a8FAFF1559C739965978045a3D3C5e2Fa` | `0xa117cb8b1b7a4b92de87d53f0fef062267776c2f943a9e4460e2ce52f033d432` |
| `hanji-weth-usdc` | WETH / USDC | `0x6F34F44D8B166F7EaC3fBaF9882a725F67C36f84` | `0xa39130853f18e9d595a720b9a99bc1e7994a217c98fb3b6fcd0b7df72ddb9dde` |
| `clober-wbtc-usdc` | WBTC / USDC | `0x8ec90365d48Fde3dF780ad54326e555B897beF1a` | `0x89e8663049e696422f7c342d6867deb19a50944fd5f784ceb8593fa837dc7898` |
| `metric-wbtc-usdc` | WBTC / USDC | `0xf4CD6a9f68BF052e3E90f8Bab304e75d374993aA` | `0x1f7fbb960a237e87e6f5f247621bf2c5d3f37123a3bc606b9607ad0d861d1311` |
| `hanji-cbbtc-usdc` | cbBTC / USDC | `0xB565572277898dA8E4aFfF88FBfC79d9Bd57c9c3` | `0x231c703bf3a8cba001b1f7ff3e6f8e13205c6c3701f95fd76941f9a610891f78` |
| `hanji-mon-weth` | WMON / WETH | `0x624E92EfA1D6A2A6ce3625B9a6480C3EbE52643C` | `0x0205a8a5214fff33d411b968bfb62929a76402e33bb1ed4720d09e9f0c55b33a` |
| `hanji-cbbtc-mon` | cbBTC / WMON | `0xb84baD3443e59bde160E3EB4a6ae1087a6a444B5` | `0xc93c632ac236dd3499318cd3fd27a867b2e0a13a67ee80f8ca465c31c3405d1a` |
| `hanji-cbbtc-weth` | cbBTC / WETH | `0xB0262e43A36C4Fc1B38d47B623d22c327523b705` | `0xf531cbcc8b2774a4c5cd5eac9a39cce4b16cbf6722d8b3585166a5c4159bc66c` |

All entries are attributed to the pinned Monoper deployment manifest. They are not r3tards deployments and no audit status is inferred; the reference adapter repository describes the integration code as active development.

Local/testnet deployments use `MockVenueDirectory`, registered as `router-mock-venues`, so no mainnet address is pretended to exist on those chains.

## What the lab can prove

It can show, for one block state and one caller context:

- which configured adapter calls returned a valid MRC-17 quote;
- the raw quoted output;
- bounded call gas consumption;
- bounded revert diagnostics;
- whether the successful quote also completes under `STATICCALL`;
- that quote frames are architecturally reverted;
- for WMON input, a same-state execution-preview output inside an always-reverting frame.

It cannot prove future execution quality, future liquidity, absence of front-running/sandwiching, adapter honesty, oracle correctness inside a venue, quote validity at a later block, or what a proprietary opaque `swapData` payload means.

## No-asset-execution decision

ROUTER.EXE is not a production exchange interface. The lab exposes no persistent execution entry point, performs no user token pull, takes no fee, stores no balances, and has no owner or mutable configuration. The frontend never sends a transaction to it. The one payable diagnostic entry point always reverts.
