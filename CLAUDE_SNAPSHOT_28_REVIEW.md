# Snapshot 28 candidate — review, build, test, fix, package

This is a **candidate**, not a verified snapshot. ChatGPT patched it from snapshot 27 but could not install npm dependencies or Foundry in its container, so **do not commit it before you compile/test it**. Fix small issues directly, regenerate generated ABI, browser-test, then package one verified `r3tards-paint-snapshot-28.zip` for dreiki.

## Hard rules

- Do not use GitHub. Do not commit or push. dreiki commits locally.
- Do not ask for private keys or Privy secrets.
- The frozen **R3tardsPaint core source is unchanged**. Do not modify it for this batch.
- Never hand-edit `src/lib/generated/abi.ts`. After contracts build, run `node scripts/export-abi.mjs` and include the generated diff.
- Retired programs remain retired.

## User requests implemented

1. Higher launch pixel budget:
   - base `512 px/hour`
   - `+32 px/hour` per active day
   - max `2048 px/hour`
   - active-day threshold remains `16`
   - holder daily quota `512`
   These are deploy-time Paint immutables, not a core logic change.

2. Burn a CD no longer appears dead/disallowed just because a wallet is disconnected.
   - My Frames `Burn CD` opens the wizard.
   - Empty CD-ROM always shows `Burn a CD`.
   - The wizard itself explains connection requirements.

3. Block Camera photos can be burned onto CDs.
   - Legacy `burnCD(frameIds,label)` remains v2 and must remain byte/metadata compatible.
   - New `burnMixedCD(trackIds,trackKinds,label)` creates v3 snapshots.
   - kind `0` = Paint frame; kind `1` = Block Camera Labs token.
   - v3 uses flag bit `0x04` for photo tracks and header bytes 74/75 for frame/photo counts.
   - The CD Burner proves a photo by Labs ownership + `sourceOf` + `experimentOf` + registry name `block-camera`.
   - Block Camera adds read-only `cdTrackData()` returning season, capture block and packed exact portrait colour counts.
   - Burning a CD **does not transfer/burn either source**.
   - CD art seed sets bit 255 on photo ids only for seed disambiguation. Stored ids are unchanged.
   - CD-ROM and Imaging accept both v2/v3 and display `TRACKnn.BMP` or `PHOTOnn.SVG`.
   - Block Camera developed-photo actions include `Burn to CD…` (`#/cd?photo=<labsId>`).

4. Paint should not reopen after every boot.
   - Normal `openProgram('paint')` no longer writes `#/paint` into the URL.
   - Explicit/shared `#/paint` deep links still route normally.
   - Confirm root boot shows a bare desktop after the boot screen, then opening Paint, reloading root, and booting again does **not** reopen Paint.

5. Desktop order is exactly:
   1. My Pass
   2. My Frames
   3. Paint
   4. Block Camera
   5. CD-ROM
   6. Explore Monad
   7. Quests
   8. Recycle Bin
   Live Auction, if present, is appended after those eight.

## Contract changes to review first

### `contracts/src/labs/R3tardsCDBurner.sol`

Review especially:
- no regression whatsoever in legacy `burnCD` snapshot v2;
- v3 header layout: label max ends at byte 73, counts at 74/75, track records still start at 80;
- duplicate check is `(kind,id)`;
- `ownerOf` for both source types at burn time;
- experiment/source verification cannot accept arbitrary Labs tokens;
- packed uint16 colour lanes cannot overflow: max 12 × 1024 = 12,288 per lane;
- photo-only v3 has oldest frame = 0 but valid season stats;
- `_artIds` high-bit marker only affects art seed;
- old v2 metadata attribute positions remain unchanged (existing tests depend on them);
- code size and gas are acceptable under Monad rules.

### `contracts/src/monadhw/R3tardsBlockCamera.sol`

`cdTrackData(tokenId)` must:
- revert for nonexistent shots;
- reconstruct exactly the portrait used by Labs metadata;
- apply CARD.DRV page-hash pixels when the shot has them;
- pack exactly 1024 pixels into sixteen uint16 count lanes;
- remain read-only and not change capture behavior.

## Required contract verification

From repo root install deps as usual, then from `contracts/`:

1. `forge build --force` under the repo's Monad config. **Zero compiler warnings/lint output expected.**
2. Run at minimum:
   - `forge test --match-contract RecycleBinCDBurnerTest -vv`
   - `forge test --match-contract MonadHWTest -vv`
3. Then run the full contract suite under the same Monad rules used by the project.
4. Pay attention to new tests:
   - `testCDBurnerMixedBlockPhotoWritesV3AndKeepsSources`
   - `testBlockCameraCdTrackDataCountsExactlyPortraitPixels`
5. Add/fix tests if the mixed path exposes anything. In particular, measure a photo-heavy mixed CD (ideally 12 photos) and report mint gas; do not silently inherit the legacy 3.5M target.
6. Confirm legacy CD tests and `CDArt.t.sol` hashes remain unchanged.

After a successful contracts build:

```bash
cd ..
node scripts/export-abi.mjs
```

Do **not** manually edit `src/lib/generated/abi.ts`.

## Required frontend verification

Run:

```bash
npx tsc -b
npm test -- --run
npm run build
```

Then browser-test on the local Monad-mode chain.

### Shell / boot

- Root URL → boot → bare desktop, no Paint window.
- Open Paint normally. Verify it does not persist `#/paint` as a boot route.
- Reload root / reboot. Paint stays closed.
- Explicitly visit `#/paint`; it should still deep-link into Paint.
- Confirm desktop order exactly matches the eight-item list above on desktop and does not break mobile layout.
- If Auction is live, it appears after Recycle Bin.

### Burn a CD UX

Disconnected:
- My Frames → Burn CD opens the burner instead of looking disabled.
- Empty CD-ROM → Burn a CD opens the burner.
- Burner says connect wallet to list sources; no crash.

Connected, frame-only:
- Existing frame-only flow still calls legacy `burnCD`, creates snapshot v2, and plays in CD-ROM.
- Existing v2 testnet fixture/parser behavior remains valid.

Connected, photo-only:
- Capture Block Camera photo.
- `Burn to CD…` preselects it.
- Preview gets colors from `cdTrackData`.
- Burn calls `burnMixedCD`, creates v3.
- CD-ROM lists `PHOTO01.SVG`, Imaging displays the immutable Block Camera image + block/timestamp metadata.
- Source photo remains owned after burn.

Connected, mixed:
- Add at least one Paint frame + one Block Camera photo.
- Reorder them; filenames/index order must follow CD order.
- Burn succeeds as v3.
- CD art preview should match minted CD art (photo ids use the same high-bit seed marker in frontend and Solidity).
- CD-ROM Previous/Next crosses frame/photo boundaries correctly.
- Wallpaper and floppy actions work for both source kinds.
- Paint source frame remains owned; photo remains owned.

Public CD path:
- `#/cdrom?cd=<v2 id>` still works without wallet.
- `#/cdrom?cd=<v3 id>` works without wallet and plays photo tracks.

Failure paths:
- Old snapshot-27 testnet CD Burner does not have `burnMixedCD`; frontend should show the explicit snapshot-28 deployment message, not spin forever.
- A random/non-Block-Camera Labs token must be rejected by contract.
- A Block Camera token owned by another wallet must be rejected.

## Pixel-budget deployment consequence

The currently deployed testnet Paint has older immutable pixel values, and the current testnet Block Camera/CD Burner lack the new interfaces. For an exact mainnet rehearsal, **redeploy the testnet suite from snapshot 28** instead of trying to patch old addresses. The Paint *source logic* is unchanged; only constructor values differ. The add-on Block Camera and CD Burner bytecode changed.

Rehearsal values:

```text
BASE_PIXELS_PER_HOUR=512
PIXELS_PER_ACTIVE_DAY=32
MAX_PIXELS_PER_HOUR=2048
MIN_PIXELS_FOR_ACTIVE_DAY=16
HOLDER_PIXELS_PER_DAY=512
```

Run Launch Doctor with `--expected-chain 10143` after redeployment and require FAIL 0.

## Files ChatGPT changed from snapshot 27

- `contracts/src/labs/R3tardsCDBurner.sol`
- `contracts/src/monadhw/R3tardsBlockCamera.sol`
- `contracts/test/RecycleBinCDBurner.t.sol`
- `contracts/test/MonadHW.t.sol`
- `src/labs/CDBurnerProgram.tsx`
- `src/cdrom/cdrom.ts`
- `src/cdrom/CdromProgram.tsx`
- `src/cdrom/ImagingProgram.tsx`
- `src/cdrom/cdrom.test.ts`
- `src/frames/FramesProgram.tsx`
- `src/monadhw/BlockCameraProgram.tsx`
- `src/os/layout.ts`
- `src/os/layout.test.ts`
- `src/os/programs.ts`
- `src/chain/contracts.ts`
- docs for deploy/checklist/CD/Block Camera/brush budget

ChatGPT did parser-level TypeScript validation on all changed TS/TSX files and delimiter/static review on Solidity, but **did not execute Forge, Vitest, typecheck, build, ABI export or browser tests** due unavailable dependencies/network. Treat all of those as mandatory.

## Deliverable back to dreiki

After fixing anything found, send:
- one verified `r3tards-paint-snapshot-28.zip`;
- exact test/build counts;
- mixed-CD gas measurements;
- browser test result for boot, desktop order, frame-only CD, photo-only CD, mixed CD and public v3 CD link;
- any deviations you made from this candidate and why.

Then STOP. Do not commit or push.
