# r3tards paint

> one r3tard. one paint file. anyone can edit it. mint to save. it never ends.
>
> r3tards is not a r3al proj3ct.

A shared 256×256 Paint-style artwork on Monad. Anyone can edit the same living r3tard and mint their contribution. Every NFT shows the **current** shared artwork, so old NFTs keep changing as the painting changes.

The visual frontend deliberately resembles ancient desktop Paint software because apparently we reached 2026 only to rebuild a program from the 90s inside a blockchain. Sensible.

## What is onchain

- 256×256 canonical canvas
- 16 fixed r3tards colors
- 4 bits per pixel
- 32,768 bytes of image state
- 1,024 consecutive EVM storage slots
- exactly 8 aligned 128-slot MIP-8 storage pages
- infinite ERC-721 mints
- mint provenance and mutation events
- BMP renderer
- SVG wrapper
- base64 JSON metadata
- DF1 calculation
- DF1 entropy
- final pixel writes

There is no image server, IPFS dependency, oracle, admin image updater, or backend deciding how the canvas looks.

## How Paint tools work

The browser is an editor/preview, not the source of truth.

All classic tools are functional in the UI:

- free-form select
- rectangular select
- eraser
- fill bucket
- eyedropper
- magnifier
- pencil
- brush
- airbrush
- text
- line
- curve
- rectangle
- polygon
- ellipse
- rounded rectangle

The frontend rasterizes pending edits locally so drawing does not require a wallet signature for every mouse movement. When the user chooses **MINT / SAVE**, the app diffs the pending image against the last onchain canvas and encodes the intended changes as compact horizontal runs:

```text
[y, xStart, xEnd, colorIndex]
```

Each run is exactly four bytes. The contract validates and applies every intended pixel itself. The canonical image changes only inside `R3tardsPaint.sol`.

A full 256-pixel horizontal fill is therefore one four-byte run instead of 768 bytes of `[x,y,color]` tuples. Human beings accidentally discover compression once in a while.

## DF1

Users **cannot control DF1**.

The contract derives a 0–100 DF1 intensity entirely from `block.basefee`. The current curve is:

```text
1× documented floor ->   0
2×                  ->  20
4×                  ->  40
8×                  ->  60
16×                 ->  80
32×+                -> 100
```

At full intensity the corruption preserves the DF1 enhancer's core behavior:

- RGB noise up to ±25 per channel
- ~0.9919% random RGB replacement
- deterministic onchain seed
- output quantized back to the fixed 16-color r3tards palette

The authoritative DF1 value is taken from the block that includes the mint. The UI may display an estimate from the latest block, but cannot choose the final value.

## Palette

| # | Hex | Name |
|---:|---|---|
| 0 | `#FFFFFF` | white |
| 1 | `#000000` | black |
| 2 | `#965E4B` | trippie brown |
| 3 | `#877549` | old man olive |
| 4 | `#C52020` | juicy red |
| 5 | `#FEC343` | gold |
| 6 | `#EE93E3` | og pink |
| 7 | `#E6A3C6` | tongue pink |
| 8 | `#07992F` | green |
| 9 | `#A0055D` | nad magenta |
| 10 | `#694B87` | purple |
| 11 | `#5FEDDF` | DF1 cyan |
| 12 | `#F7931A` | BTC orange |
| 13 | `#C864AA` | waifu pink |
| 14 | `#9F70DA` | pill purple |
| 15 | `#D47827` | emoji orange |

## Repo

```text
r3tards-paint/
├─ contracts/
│  ├─ src/R3tardsPaint.sol
│  ├─ test/R3tardsPaint.t.sol
│  ├─ foundry.toml
│  └─ README.md
├─ scripts/
│  └─ compile-contract.mjs
├─ src/
│  ├─ components/PaintApp.tsx
│  ├─ lib/
│  │  ├─ abi.ts
│  │  ├─ chain.ts
│  │  ├─ genesis.ts
│  │  ├─ paintEngine.ts
│  │  ├─ palette.ts
│  │  └─ patch.ts
│  ├─ index.css
│  └─ main.tsx
├─ .env.example
├─ package.json
└─ vercel.json
```

## Run the frontend

```bash
npm install
cp .env.example .env.local
npm run dev
```

With no RPC/contract configured the app runs in **demo mode**, using the exact same genesis drawing as the Solidity constructor. Drawing tools work, but minting is disabled.

## Contract compilation check

The repo includes a plain solc check using the same compiler target intended for Remix:

```bash
npm run contract:compile
```

Expected settings:

- Solidity `0.8.28`
- optimizer: on
- runs: `200`
- EVM version: `prague`

The script also prints deployed bytecode size so it can be checked against Monad's larger contract-size ceiling.

## Foundry tests

Foundry is only for local testing. Deployment is intended to be done with Remix.

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge test -vvv
```

## Deploy with Remix: TESTNET FIRST

Do **not** use mainnet as the test suite.

1. Open Remix.
2. Create `R3tardsPaint.sol` and paste `contracts/src/R3tardsPaint.sol`.
3. Compile using Solidity `0.8.28`.
4. Enable optimizer with `200` runs.
5. Select EVM version `prague`.
6. Connect MetaMask to Monad **testnet**, chain ID `10143`.
7. Deploy `R3tardsPaint`.
8. There are **no constructor arguments**.
9. Put the deployed address in Vercel as `VITE_CONTRACT_ADDRESS`.
10. Put a current Monad testnet RPC in `VITE_RPC_URL`.
11. Exercise every drawing tool, fill large regions, move selections, mint repeatedly, transfer NFTs, inspect `getCanvas`, `renderBMP`, `renderSVG`, `tokenURI`, and DF1 behavior.
12. Only after the exact source/settings/app have survived testnet should the same contract be deployed on Monad mainnet, chain ID `143`.

Current RPC/explorer information should be taken from the official Monad docs rather than fossilized into this repository:

- mainnet: `https://docs.monad.xyz/developer-essentials/network-information`
- testnet: `https://docs.monad.xyz/developer-essentials/testnet`

## Vercel

Push this folder to GitHub and import the repository into Vercel.

Vercel should detect Vite automatically. If it asks:

```text
Build command:   npm run build
Output directory: dist
Install command: npm install
```

Set these environment variables:

```text
VITE_CHAIN_ID=10143
VITE_RPC_URL=<current Monad testnet RPC>
VITE_CONTRACT_ADDRESS=<your testnet deployment>
VITE_EXPLORER_URL=<optional explorer base URL>
```

After the mainnet deployment, change `VITE_CHAIN_ID` to `143` and update the RPC/contract/explorer values, then redeploy Vercel.

## Gas-limit behavior

Monad charges transactions based on the declared gas limit rather than simply the gas ultimately used. The frontend therefore:

1. calls `eth_estimateGas` for the exact patch,
2. adds only a small `2% + 10,000` buffer,
3. explicitly sends that tight limit.

Do not replace this with a giant hardcoded gas limit.

Large operations can legitimately be expensive. The contract permits up to 65,536 intended pixel writes in one mint so a whole-canvas operation is representable, but a huge operation still needs to fit Monad's per-transaction limits. Test worst-case fills on testnet before production.

## Genesis art

The current contract includes a deliberately simple black line-art placeholder r3tard on white. It is implemented in `_drawGenesis()` and mirrored by `src/lib/genesis.ts` for demo mode.

**Replace/refine the genesis drawing before the production deployment if you want the exact collection character.** Once deployed, that starting state becomes permanent history.

## Security / launch status

This is a complete working repository, **not an audit**. Do not treat successful compilation or frontend operation as a smart-contract security review. The intended path is:

```text
local compile/tests
→ Monad testnet
→ adversarial/manual testing
→ independent contract review
→ mainnet
```

There are intentionally no owner-only canvas controls, no upgrade proxy, and no backend mutation endpoint.
