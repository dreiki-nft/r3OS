# Recycle Bin

`R3OSRecycleBin` is the adminless graveyard for ordinary saved Paint frames. It burns through the frozen core's existing ERC-721 approval path, records who recycled what, and exposes the `RECYCLER` Pass stamp.

## Recycling with approval

`recycle(ids)` accepts 1–50 frame ids. The caller must currently own every id and must have either approved the Bin for that token or approved it as an operator with `setApprovalForAll`.

The Bin then calls `R3OSPaint.burn(id)`. It intentionally does not duplicate the core's token #0 or finale rules: those calls reach the core and revert with the core's canonical `NonBurnableToken` error.

Active core session keys cannot recycle.

## Drop one frame without approval

The Bin implements `IERC721Receiver` for the Paint collection only. A frame owner may call the core's `safeTransferFrom(owner, bin, id)` without a prior approval. During the receiver callback the Bin snapshots the tombstone, burns the frame it just received, and credits the original `from` address.

Other ERC-721 collections are rejected. Session keys are rejected on this path as well.

## Records

For each successful burn the Bin stores:

- `burnedBy(owner)` lifetime count;
- `totalBurned()`;
- `lastBurnBlock(owner)`;
- `tombstone(frameId)` containing minter, season, saved-frame block and storm state.

It emits:

`Recycled(owner, frameId, season, blockNumber)`

The contract also keeps an onchain `topBurners()` top 10. Counts are sorted descending. Equal counts preserve the wallet that reached that count first.

### What the frozen core serves after a burn

`R3OSPaint.burn` only destroys ERC-721 ownership; it does not delete the `_frames` snapshot or its `FrameStore` pointer. As a result, `frameInfo(id)` and `frameData(id)` remain readable after an ordinary frame is burned even though `ownerOf(id)` reverts.

The Bin still stores the small tombstone because the Recycle Bin UI needs a cheap, purpose-built historical record and should not depend on undocumented storage persistence in the core. The tombstone contains only the requested identifying fields, not another 32 KB frame copy.

## Pass stamp and quest

`stamp(painter)` returns `("RECYCLER", true)` once `burnedBy(painter) >= 100`.

The day-one quest board adds quest #13 (zero-based id 12): `RECYCLER`, goal `burn 100 frames`, reading `burnedBy(address)` directly from this contract.

## Authority and value

The Bin has no owner/admin and no payable entry point. It cannot move a frame without the normal ERC-721 approval or safe-transfer action initiated by the owner. It holds no MON and has no canvas-write authority.
