snapshot-28 cache isolation + Recycle Bin visual fix

Apply these files over the repo root.

What changed
- Persistent frame info, frame image and ownership caches are now namespaced by chain ID + Paint contract address.
- Hidden/unhidden frame preferences use the same deployment namespace.
- Remembered CD-ROM disc state is also namespaced by Paint deployment.
- Recycle frame picker gets a dedicated wide dialog instead of overflowing the 430px generic MessageBox.
- Picker cards are 2-column, responsive, have real frame thumbnails, correctly sized checkboxes and clearer selected states.
- MessageBox accepts an optional className so programs can opt into a larger dialog without changing every message box.
- Added a small deploymentScope test.

No Solidity changes. No ABI changes. No deployment changes.

Validation performed here
- TypeScript/TSX syntax transpilation passed for every changed TS/TSX file.
- CSS brace balance = 0.
- git diff --check clean.

Run locally after applying
  npm run test:web
  npm run build

Browser check
- Recycle Bin -> Recycle frames… should fit entirely inside the dialog at desktop width.
- Cards should show thumbnails in a 2-column grid; phone width collapses to 1 column.
- A future testnet redeploy on the same chain should no longer resurrect old frames/CD state from the previous Paint address.
