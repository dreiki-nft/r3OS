# Pre-mainnet checklist

The single canonical launch list. Other docs link here instead of repeating it. Order after this phase: **TESTNET → SOAK → MAINNET PRE-FLIGHT → LAUNCH**.

Tools: the **Launch Doctor** (`RPC_URL="$MONAD_RPC_URL" npm run -s launch:doctor -- --paint <0x…> --expected-owner <0x…> --expected-chain <id> [--json]`) checks deployment wiring read-only; **DXDIAG.EXE** reports what a browser can see; the two mainnet fork tests check real third-party contracts. None of them turns code presence into proof of chain behaviour; the TESTNET items below need real Monad data.

## F0. Architecture decisions (already made; changing one needs a documented decision)

- Operator Record v1 is fixed at 16 domains. Future history uses companion / versioned records, never v1's unused words.
- The final two Painter Pass visual pins (14, 15) are reserved. No new stamp source for ROUTER or DXDIAG.
- The experiment registry is intentionally **not frozen** at initial launch (discovery headroom).
- CARD BUS (CARD.DRV W24–W27) stays reserved. DEVICE 07's next stage stays unknown. Router Lab remains read-only research behind Explore Monad; the ROUTER.EXE window stays retired.

- **Retired from the interface (2026-10-01):** Flipbook, Weeds, Forks, Block DNA, Sleepwalker, Lanes, Disk Defragmenter, PAGE.EXE, CARDMEM.EXE, Kernel Debugger, ROUTER.EXE (`src/os/retired.ts`). Their contracts **will stay deployed and registered unchanged on mainnet**; this is a UI retirement only. Do not call `retireExperiment` before the hackathon. The app hides their direct programs and the retired quests, Pass stamps and Operator subsystems. CARD.DRV stays deployed (MONAD CARD stamp, CARD CARRIER quest, Block Camera).
- **Security audit 2026-10-02** ([`SECURITY_AUDIT_2026-10-02.md`](SECURITY_AUDIT_2026-10-02.md)): before mainnet, (1) `cast code 0x0000F90827F1C53a10cb7A02335B175320002935 --rpc-url "$MONAD_MAINNET_RPC"` is non-empty (EIP-2935 history, auction settle window); (2) the mainnet r3tards collection is a plain non-upgradeable, non-pausable ERC-721 (frame/finale mint calls its `balanceOf`); (3) keep the UI-retired Labs deployed/registered unchanged for launch; (4) explicitly set `MON_FEED_MAX_AGE` to the observed feed heartbeat + buffer; (5) the Vercel CSP is live (`curl -sI <site> | grep -i content-security-policy`).
- **PAGE.EXE and ROUTER-LAB must still be deployed on mainnet:** Explore Monad's Storage race calls PAGE.EXE `benchRead`/`probePage`, and its Liquidity race calls ROUTER-LAB `compare` (no mock venues on 143). After deploy, open Explore Monad on mainnet, press Run test and Compare, and confirm real numbers (Storage race ratio ≫ 1; at least one venue quoting).

## F1. Deployment

- [ ] **Pixel budget immutables:** `BASE_PIXELS_PER_HOUR=512`, `PIXELS_PER_ACTIVE_DAY=32`, `MAX_PIXELS_PER_HOUR=2048`, `MIN_PIXELS_FOR_ACTIVE_DAY=16`, `HOLDER_PIXELS_PER_DAY=512`. Verify the exact env before `Deploy.s.sol`; these cannot be changed after deploy.
- [ ] Suite: `Deploy.s.sol` (Paint, Labs, Pass, renderers, nine Labs, quests).
- [ ] CARD.DRV: `DeployMonadCard.s.sol` (official card `0x0000CA12D5c07085022eBC74867157449919Fd67` on 143; `MockMonadCard` on testnet).
- [ ] Monad Hardware: `DeployMonadHW.s.sol` **with** `CARD_MEMORY_ADDRESS` (it is optional in the script; a missing value leaves Block Camera without CARD.DRV).
- [ ] Operator Record + System Event: `DeployOperator.s.sol` (verified MON/USD proxy `0xBcD78f76005B7515837af6b50c7C52BCf73822fb` on 143). **Mainnet requires an explicit `MON_FEED_MAX_AGE`; the script intentionally has no 25 h fallback on chain 143.**
- [ ] Router Lab: `DeployRouterLab.s.sol` (no mocks on 143).
- [ ] Record every address, experiment id and the deploy block with the deployment records.
- [ ] Run the Launch Doctor with the chain you **intend** (`--expected-chain 10143` on testnet, `143` on mainnet) and keep its JSON report. A different actual chain is a FAIL; omitting the flag is only a WARN, so never omit it for the real check.

## F2. Ownership

- [ ] Paint, Labs, Painter Pass and Quests: `owner()` is the intended project wallet / Safe.
- [ ] No `pendingOwner()` left dangling: every two-step transfer has been **accepted** (a pending owner is not an owner).
- [ ] The deployer key retains no ownership it should not have.
- [ ] Launch Doctor `OWNERSHIP` section: all OK with `--expected-owner`.

## F3. Immutables

- [ ] Paint `R3TARDS`, `painterPass`, `ROYALTY_RECEIVER` / `ROYALTY_BPS` (5%), token #0 owner.
- [ ] Labs `CORE`, `ROYALTY_RECEIVER` / `ROYALTY_BPS`; Pass `PAINT`; Quests `PAINT`.
- [ ] CARD.DRV `MONAD_CARD` is the official card on 143 (Launch Doctor FAILs otherwise).
- [ ] Block Camera `PAINT`, `LABS`, `CARD_MEMORY` match the live suite.
- [ ] Operator Record: every source pointer matches the live registry / core (Launch Doctor `OPERATOR → Sources: MATCH`).
- [ ] System Event `FEED` is the verified proxy on 143; threshold and max age are the intended values.
- [ ] Router Lab `INTERFACE` names the pinned MRC-17 revision; mainnet adapter code hashes match the manifest.

## F4. Registries

- [ ] Every expected experiment present and active, exact names (note `finale auction` has a space), no duplicate active names, no active zero address, every entry has code.
- [ ] No test-only entry (`router-mock-venues`) on mainnet.
- [ ] Renderers: built-in, `diff`, `season timelapse`, `df1`.
- [ ] Labs bound to their registry id: Flipbook, Forks, Sleepwalker, Recycle Bin, CD Burner, Block Camera.
- [ ] Mixed-CD smoke test: capture a Block Camera photo, burn a v3 CD containing that photo (optionally plus a Paint frame), open it in CD-ROM, and confirm both source NFTs remain owned. Legacy v2 frame-only CDs must still open.

## F5. Freeze policy

- **Renderers:** review after complete verification. Freeze only once every expected renderer is confirmed; the Launch Doctor reports `REVIEW BEFORE MAINNET` until then.
- **Experiments: do not freeze at initial launch.** The registry is left open **intentionally** for discovery headroom (it grants no Paint permissions). Trade-off: the owner can still append/retire entries. Changing this requires a deliberate, documented decision.
- Operator Record v1 stays fixed at 16 subsystems; extensions are separate contracts (`docs/specs/OPERATOR_RECORD.md`).

## F6. Pass capacity

- [ ] Launch Doctor `PASS`: 6 built-in pins + 8 sources = **14 / 16 visual pins, 2 remaining**.
- [ ] The final two visual pins stay **reserved**. Extra stamp sources beyond capacity are metadata-only. ROUTER and DXDIAG get no pin.

## F7. Monad testnet behaviour (TESTNET REQUIRED)

- [ ] `block.coinbase` meaning for frame "Sealed by".
- [ ] EIP-2935 behaviour and the 8,191-block window; contract `blockhash(n)` vs RPC hashes.
- [ ] Auction settle via native hash, via EIP-2935, and the candle-start fallback.
- [ ] MIP-4 reserve enforcement for the retained Kernel experiment: run the Foundry/direct-contract SINGLE, BURST GRACEFUL and BURST NAIVE smoke tests and save receipts. The retired Kernel Debugger UI is not part of this check.
- [ ] Production-like gas and every fixed gas limit (F8).
- [ ] Websocket failure falls back to polling; public RPC throttling; long soak.

## F8. Gas (TESTNET REQUIRED unless marked)

- [ ] Core paint (preflight + DF1 headroom).
- [ ] Retained Flipbook contract paint (fixed 240K; historical/compatibility regression, UI retired).
- [ ] Retained Fork contract paint (fixed 250K; historical/compatibility regression, UI retired).
- [ ] Retained Sleepwalker contract step (fixed 1M; historical/compatibility regression, UI retired).
- [ ] Auction list / bid / settle / withdrawals.
- [ ] CARD.DRV write, Block Camera capture, Operator RECORD.
- [ ] Explore Monad Liquidity race / Router Lab `compare` `eth_call` accepted by the production RPCs (about 5.9M gas for 5 venues at defaults).
- Details and current numbers: `docs/specs/GAS_LIMITS.md`. Do not write a final number without real data.

## F9. Mainnet fork (MAINNET FORK REQUIRED)

Run from `contracts/` with Foundry ≥ 1.8.3 after `npm ci` in the repo root, and save the output:

- [ ] `MONAD_MAINNET_RPC=… CARD_ID=<id> forge test --match-contract MonadCardFork -vv` (2026-10-01: passed with card #307; transfers revert `Soulbound()`).
- [ ] `MONAD_MAINNET_RPC=… forge test --match-contract RouterLabFork -vv` (2026-10-01: passed; all 5 WMON/USDC code hashes matched).

## F10. Oracle (MAINNET REQUIRED)

- [ ] MON/USD proxy address, `description()`, `decimals()` = 8.
- [ ] Freshness and heartbeat against `MAX_AGE`; latest answer sane.
- [ ] Condition state, and System Event still **not activated** unless the real threshold has occurred.

## F11. Release schedule

- [ ] `public/releases.json` dates are intentional (currently empty: Forks and Block DNA were retired from the interface on 2026-10-01, see `src/os/retired.ts`); the Launch Doctor WARNs on dates already in the past and FAILs on unknown ids or malformed dates.
- [ ] `VITE_REVEAL_ALL` is set **only** on testnet / preview; unset on mainnet.

## F12. Public RPC soak

- [ ] No scans from block 0 (`VITE_DEPLOY_BLOCK` set); every `eth_getLogs` ≤ `VITE_LOGS_RANGE`.
- [ ] Idle call rate within budget (dev `rpcStats`).
- [ ] Degraded RPC, fallback RPC, websocket failure → polling.
- [ ] Long browser session, reload, wallet switch, multiple tabs.

## F13. Wallet matrix

- [ ] Normal EOA; session-key (Live mode) flows including revoke and sweep.
- [ ] Disconnected; rejected signature; rejected transaction; wrong network.
- [ ] Contract wallet where relevant (Operator Record, CARD.DRV writes).

## F14. Browser / device

- [ ] Desktop and narrow/mobile layout; reload; deep links (`#/…`). While disconnected, open a real `#/cdrom?cd=<id>` and confirm the public community CD plays read-only with no wallet.
- [ ] Start → Run… commands; retired programs (`flipbook`, `router`, `kernel`, `page`, …) say "cannot find" and their deep links open nothing.
- [ ] DXDIAG.EXE report copies cleanly (no RPC URL, no wallet) and shows the deployed `VITE_BUILD_ID` (public; set it per deploy, e.g. the snapshot or commit you deployed).
- [ ] Program release gating with reveal-all off.

## F15. Content / operational (decisions, not code)

- [ ] Offensive canvas content: written policy. Canvas pixels are permissionless and frames are immutable; there is no and will be no onchain censorship mechanism. UI-only hiding (if any) must be documented as such.
- [ ] Session-key user warnings: final wording reviewed (hot browser key, 1 MON app-managed balance cap, revoke + sweep).
- [ ] Burn the launch-week community CD and keep its public `#/cdrom?cd=<id>` link for the submission/demo.
- [ ] Auction keeper: who runs `scripts/auction-keeper.sh` for every finale auction.
- [ ] Recovery / support process: where users report problems; DXDIAG report as the first artifact.

## F16. Final Launch Doctor

Before the public mainnet announcement:

```bash
RPC_URL="$MONAD_MAINNET_RPC" npm run -s launch:doctor -- \
  --paint "$PAINT_ADDRESS" \
  --expected-owner "$EXPECTED_OWNER" \
  --expected-chain 143 \
  --json > launch-doctor-mainnet.json
```

- [ ] Run once without `--json` to read it, once with `--json` to keep it. Pass the RPC through `RPC_URL` with `npm run -s` (as above): the doctor never prints it, but `npm run` without `-s` echoes every `--rpc` argument, which would leak a private provider key.
- [ ] `Chain match` is OK (actual chain 143 = expected 143).
- [ ] **FAIL = 0.**
- [ ] Every WARN manually reviewed and either fixed or explained.
- [ ] Every UNKNOWN manually reviewed: UNKNOWN means a required read failed, not that it passed.
- [ ] The JSON report saved with the deployment records.
