# Pre-mainnet checklist

The canonical launch list. Order: **TESTNET → SOAK → MAINNET PRE-FLIGHT → LAUNCH**.

Tools: **Launch Doctor** (`RPC_URL="$MONAD_RPC_URL" npm run -s launch:doctor -- --paint <0x…> --expected-owner <0x…> --expected-chain <id> [--json]`) checks deployed wiring read-only. **DXDIAG.EXE** reports what one browser can measure. Fork tests validate real third-party contracts. None of those turns code presence into proof of live chain behavior, so the TESTNET/MAINNET items below still need real Monad data.

## F0. Architecture decisions

- Fresh mainnet omits discontinued experiments entirely. Git history is their archive; do not recreate an `/archive` or `/deprecated` source tree in the submission branch.
- The existing snapshot-28 testnet is untouched and may still contain historical registry entries. `src/os/retired.ts` exists only to hide those legacy entries/quests/stamps/subsystems when connected to that deployment.
- PAGE.EXE, CARD.DRV and Router Lab **remain production backends**: Explore Monad uses PAGE.EXE and Router Lab; Monad Card / Block Camera / Pass flows use CARD.DRV.
- Operator Record keeps its v1 fixed layout for compatibility. Fresh mainnet passes zero addresses for its retired source slots; new history uses a versioned/companion record rather than repurposing v1 fields.
- The experiment registry is intentionally **not frozen** at initial launch. Registration grants no Paint write privilege.
- CARD BUS words remain reserved. DEVICE 07's next stage stays unknown.

## F1. Deployment

- [ ] Paint budget immutables: `BASE_PIXELS_PER_HOUR=512`, `PIXELS_PER_ACTIVE_DAY=32`, `MAX_PIXELS_PER_HOUR=2048`, `MIN_PIXELS_FOR_ACTIVE_DAY=16`, `HOLDER_PIXELS_PER_DAY=512`.
- [ ] Partner constants: Skrumpeys `0xB0DAD798C80e40Dd6b8E8545074C6a5B7B97D2c0` +128 px/day; Monad Cards `0x0000CA12D5c07085022eBC74867157449919Fd67` +128 px/day; both mainnet-only.
- [ ] `Deploy.s.sol`: Paint, Labs, Pass, 3 renderers, Finale Auction, Quests, Recycle Bin, CD Burner.
- [ ] Core deploy registers exactly **4** experiments, **2** initial Pass stamp sources and **7** day-one quests.
- [ ] `DeployMonadCard.s.sol`: official Monad Card on 143; test mock only on testnet. Confirm CARD.DRV, MONAD CARD stamp and CARD CARRIER quest.
- [ ] `DeployMonadHW.s.sol`: PAGE.EXE + Block Camera, with `CARD_MEMORY_ADDRESS` wired.
- [ ] `DeployOperator.s.sol`: Operator Record + System Event. Mainnet requires explicit `MON_FEED_MAX_AGE`; retired v1 source slots must be zero.
- [ ] `DeployRouterLab.s.sol`: production adapters only on 143; no mock venue registry.
- [ ] Record every address, experiment id and deploy block.
- [ ] Run Launch Doctor with the intended chain explicitly (`10143` rehearsal, `143` mainnet) and keep its JSON report.

## F2. Ownership

- [ ] Paint, Labs, Painter Pass and Quests `owner()` equal the intended project wallet / Safe.
- [ ] Every `pendingOwner()` transfer has been accepted; no deployer ownership remains accidentally.
- [ ] Launch Doctor `OWNERSHIP` section is all OK with `--expected-owner`.

## F3. Immutables and fixed links

- [ ] Paint `R3TARDS`, `painterPass`, royalty receiver/BPS and token #0 owner.
- [ ] Mainnet Paint identity: ERC-721 `r3OS paint` / `R3OSPAINT`, EIP-712 `r3OS paint`, version `2`. Chain 10143 intentionally keeps `r3tards paint`.
- [ ] `SKRUMPEYS` / `MONAD_CARDS` addresses have code and both bonus constants equal `128`.
- [ ] Labs `CORE` and royalties; Pass `PAINT`; Quests `PAINT`.
- [ ] CARD.DRV points to the official Monad Card contract on 143.
- [ ] Block Camera `PAINT`, `LABS`, `CARD_MEMORY` match the live suite.
- [ ] Operator active source pointers match Paint/Pass/Quests/Auction/Recycle/PAGE.EXE/Block Camera/CARD.DRV/Monad Card; retired v1 pointers are zero on fresh mainnet.
- [ ] System Event feed, threshold and max age are intentional.
- [ ] Router Lab interface/adapters/code hashes match the pinned manifest.

## F4. Registries

- [ ] Active experiment names are exactly: `finale auction`, `quests`, `recycle-bin`, `cd-burner`, `card-drv`, `page-exe`, `block-camera`, `operator-record`, `system-event`, `router-lab` (plus test-only entries only on testnet when intentionally configured).
- [ ] No discontinued experiment name is present in the fresh mainnet registry.
- [ ] No active zero address, duplicate active name or missing runtime code.
- [ ] Renderers: built-in, `diff`, `season timelapse`, `df1`.
- [ ] Bound Labs: Recycle Bin, CD Burner and Block Camera report the correct registry id where binding applies.
- [ ] Mixed-CD smoke test: capture a Block Camera portrait, burn a CD containing it (optionally with a Paint frame), play it in CD-ROM, and confirm source NFTs remain owned.

## F5. Freeze policy

- **Renderers:** freeze only after every expected renderer has been verified on mainnet.
- **Experiments:** leave unfrozen at initial launch for discovery headroom. Changing this requires a documented decision.
- Operator Record v1 remains fixed; extensions are separate/versioned contracts.

## F6. Painter Pass capacity

- [ ] Fresh mainnet starts with 6 built-ins + Quests + Recycle Bin + MONAD CARD = **9 / 16** visual pins used after CARD.DRV wiring.
- [ ] Any later stamp source is reviewed before addition. Sources beyond visual capacity are metadata-only.

## F7. Monad behavior

- [ ] Verify the meaning of `block.coinbase` before finalizing any “validator/proposer” wording.
- [ ] Verify EIP-2935 presence/behavior and the effective history window; compare contract history reads with RPC hashes.
- [ ] Exercise Finale Auction settlement through native `blockhash`, EIP-2935 history and the documented late fallback.
- [ ] Verify PAGE.EXE MIP-8 measurements on the live target chain.
- [ ] Verify Block Camera proposer/epoch device behavior and unknown fallbacks.
- [ ] WebSocket failure falls back cleanly; public RPC throttling and long soak are stable.

## F8. Gas and transaction policy

- [ ] Core Paint: preflight + DF1 headroom policy measured under calm/storm and representative crowd pressure.
- [ ] Frame/Pass/Quest/session actions measured with exact-action estimate + 10% policy.
- [ ] Finale Auction list/bid/settle/withdraw paths measured.
- [ ] Recycle representative batch sizes; CD Burner representative track counts including 12 tracks.
- [ ] CARD.DRV write, PAGE.EXE write, Block Camera capture and Operator RECORD measured.
- [ ] Explore Monad Router Lab `compare` and PAGE.EXE benchmark `eth_call`s accepted by production RPCs.
- [ ] Every wallet prompt shows maximum MON cost. Do not promote a local number to a production guarantee without live evidence.

See `docs/specs/GAS_LIMITS.md`.

## F9. Mainnet fork / third-party dependencies

Run from `contracts/` and save output:

- [ ] `MONAD_MAINNET_RPC=… CARD_ID=<id> forge test --match-contract MonadCardFork -vv`.
- [ ] `MONAD_MAINNET_RPC=… forge test --match-contract RouterLabFork -vv`.
- [ ] Skrumpeys address has code and a known holder `balanceOf(address)` succeeds.
- [ ] Monad Cards address has code and a known holder `balanceOf(address)` succeeds.
- [ ] Mainnet r3tards collection is verified as the intended ERC-721 dependency and its `balanceOf` behavior is stable.
- [ ] `cast code 0x0000F90827F1C53a10cb7A02335B175320002935 --rpc-url "$MONAD_MAINNET_RPC"` is non-empty before relying on the extended auction history window.

## F10. Oracle

- [ ] MON/USD proxy address, description and decimals verified.
- [ ] `MAX_AGE` matches observed heartbeat + buffer; latest answer/freshness sane.
- [ ] System Event remains unlatched unless the real condition has actually occurred.

## F11. Release/build configuration

- [ ] `public/releases.json` contains only intentional active-program release gates; no discontinued program ids.
- [ ] `VITE_REVEAL_ALL` is testnet/preview only and unset on production mainnet.
- [ ] `VITE_DEPLOY_BLOCK` is the real mainnet Paint deploy block.
- [ ] `VITE_BUILD_ID` identifies the deployed revision.

## F12. Public RPC soak

- [ ] No history scans from block 0; every `eth_getLogs` window is bounded by `VITE_LOGS_RANGE`.
- [ ] Idle and active RPC rates stay within configured per-endpoint budgets.
- [ ] Degraded primary RPC, fallback RPC and websocket→polling transitions recover cleanly.
- [ ] Remembered-wallet boot latency and action-RPC readiness are measured on at least two browsers.
- [ ] Long session, reload, wallet switch and multiple-tab behavior remain stable.

## F13. Wallet matrix

- [ ] Normal EOA, Live session-key start/revoke/sweep, disconnected mode.
- [ ] Rejected signature, rejected transaction and wrong-network paths.
- [ ] Contract wallet where relevant to Operator/CARD.DRV reads or writes.
- [ ] r3tards, Skrumpeys and Monad Cards holder-budget paths checked on mainnet/fork with known holders.

## F14. Browser / judge path

- [ ] Desktop + narrow layout, reload and deep links.
- [ ] Disconnected user can boot, open Paint and inspect Monad before connecting.
- [ ] Two-browser Live test shows remote strokes and separate receipt/commit-state proof.
- [ ] DXDIAG report contains no wallet or RPC URL and shows the deployed build id.
- [ ] Historical discontinued program commands/deep links do not open a production program.
- [ ] Fresh r3OS OG image and submission screenshots match the actual shipped UI.

## F15. Operational/content decisions

- [ ] Permissionless-canvas/offensive-content policy documented; onchain frames remain immutable.
- [ ] Live burner warning reviewed: hot browser key, 1 MON app-managed balance cap, revoke + sweep.
- [ ] Launch-week community CD and shareable read-only link prepared.
- [ ] Auction keeper responsibility assigned.
- [ ] User support path asks for DXDIAG output first.

## F16. Final Launch Doctor

```bash
RPC_URL="$MONAD_MAINNET_RPC" npm run -s launch:doctor -- \
  --paint "$PAINT_ADDRESS" \
  --expected-owner "$EXPECTED_OWNER" \
  --expected-chain 143 \
  --json > launch-doctor-mainnet.json
```

- [ ] Run once human-readable, once as JSON; pass RPC via `RPC_URL` so shell/npm output never exposes a provider key.
- [ ] Chain match is OK.
- [ ] **FAIL = 0.**
- [ ] Every WARN/UNKNOWN is manually reviewed and explained or fixed.
- [ ] JSON report saved with deployment records.
