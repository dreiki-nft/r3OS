# Pre-mainnet checklist

The single canonical launch list. Other docs link here instead of repeating it. Order after this phase: **TESTNET → SOAK → MAINNET PRE-FLIGHT → LAUNCH**.

Tools: the **Launch Doctor** (`npm run launch:doctor -- --rpc <url> --paint <0x…> --expected-owner <0x…> --expected-chain <id> [--json]`) checks deployment wiring read-only; **DXDIAG.EXE** reports what a browser can see; the two mainnet fork tests check real third-party contracts. None of them turns code presence into proof of chain behaviour; the TESTNET items below need real Monad data.

## F0. Architecture decisions (already made; changing one needs a documented decision)

- Operator Record v1 is fixed at 16 domains. Future history uses companion / versioned records, never v1's unused words.
- The final two Painter Pass visual pins (14, 15) are reserved. No new stamp source for ROUTER or DXDIAG.
- The experiment registry is intentionally **not frozen** at initial launch (discovery headroom).
- CARD BUS (CARD.DRV W24–W27) stays reserved. DEVICE 07's next stage stays unknown. ROUTER.EXE stays diagnostic.

## F1. Deployment

- [ ] Suite: `Deploy.s.sol` (Paint, Labs, Pass, renderers, nine Labs, quests).
- [ ] CARD.DRV: `DeployMonadCard.s.sol` (official card `0x0000CA12D5c07085022eBC74867157449919Fd67` on 143; `MockMonadCard` on testnet).
- [ ] Monad Hardware: `DeployMonadHW.s.sol` **with** `CARD_MEMORY_ADDRESS` (it is optional in the script; a missing value leaves Block Camera without CARD.DRV).
- [ ] Operator Record + System Event: `DeployOperator.s.sol` (verified MON/USD proxy `0xBcD78f76005B7515837af6b50c7C52BCf73822fb` on 143).
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
- [ ] MIP-4 reserve enforcement: Kernel Debugger SINGLE, BURST GRACEFUL, BURST NAIVE (paste receipts).
- [ ] Production-like gas and every fixed gas limit (F8).
- [ ] Websocket failure falls back to polling; public RPC throttling; long soak.

## F8. Gas (TESTNET REQUIRED unless marked)

- [ ] Core paint (preflight + DF1 headroom).
- [ ] Flipbook paint (fixed 240K).
- [ ] Fork paint (fixed 250K).
- [ ] Sleepwalker step (fixed 1M; worst path session start + 64 px + completion + refund).
- [ ] Auction list / bid / settle / withdrawals.
- [ ] CARD.DRV write, Block Camera capture, Operator RECORD.
- [ ] ROUTER.EXE RUN `eth_call` accepted by the production RPCs (about 5.9M gas for 5 venues at defaults).
- Details and current numbers: `docs/specs/GAS_LIMITS.md`. Do not write a final number without real data.

## F9. Mainnet fork (MAINNET FORK REQUIRED)

Run from `contracts/` with Foundry ≥ 1.8.3 after `npm install` in the repo root, and save the output:

- [ ] `MONAD_MAINNET_RPC=… CARD_ID=<id> forge test --match-contract MonadCardFork -vv` (2026-10-01: passed with card #307; transfers revert `Soulbound()`).
- [ ] `MONAD_MAINNET_RPC=… forge test --match-contract RouterLabFork -vv` (2026-10-01: passed; all 5 WMON/USDC code hashes matched).

## F10. Oracle (MAINNET REQUIRED)

- [ ] MON/USD proxy address, `description()`, `decimals()` = 8.
- [ ] Freshness and heartbeat against `MAX_AGE`; latest answer sane.
- [ ] Condition state, and System Event still **not activated** unless the real threshold has occurred.

## F11. Release schedule

- [ ] `public/releases.json` dates are intentional (currently `forks` 2026-11-08, `brushes` 2026-11-15); the Launch Doctor WARNs on dates already in the past and FAILs on unknown ids or malformed dates.
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

- [ ] Desktop and narrow/mobile layout; reload; deep links (`#/…`).
- [ ] Start → Run… commands, including that an unreleased program still says "not installed yet".
- [ ] DXDIAG.EXE report copies cleanly (no RPC URL, no wallet) and shows the deployed `VITE_BUILD_ID` (public; set it per deploy, e.g. the snapshot or commit you deployed).
- [ ] Program release gating with reveal-all off.

## F15. Content / operational (decisions, not code)

- [ ] Offensive canvas content: written policy. Canvas pixels are permissionless and frames are immutable; there is no and will be no onchain censorship mechanism. UI-only hiding (if any) must be documented as such.
- [ ] Session-key user warnings: final wording reviewed (hot browser key, revoke + sweep).
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
