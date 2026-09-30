# Testnet deploy runbook (Monad testnet, chain 10143)

Run this from your own machine. No raw private keys: every command uses a Foundry keystore (`--account`) or `--ledger`.

## 0. Tools

```bash
foundryup -i 1.8.3          # the repo builds with Foundry 1.8.3
cd contracts && forge build  # first build takes a few minutes (via-IR)
```

## 1. Deployer key and test MON

```bash
cast wallet import r3tards-deployer --interactive   # paste the key once; stored encrypted
cast wallet address --account r3tards-deployer      # fund this address at https://faucet.monad.xyz
export RPC=https://testnet-rpc.monad.xyz
export DEPLOYER=$(cast wallet address --account r3tards-deployer)
```

## 2. Mock r3tards (testnet only)

```bash
forge create test/MockR3tards.sol:MockR3tards --rpc-url $RPC --account r3tards-deployer --broadcast
export MOCK=<Deployed to address>
# give testers some ids (anyone can mint on the mock)
cast send $MOCK "mint(address,uint256)" $DEPLOYER 1 --rpc-url $RPC --account r3tards-deployer
```

## 3. Deploy the suite

These pixel numbers are **testnet values** (the same as the core tests). Pick the real launch numbers before mainnet.

`SEASON_START` below is set **29 days 20 hours in the past**, so the first season ends about 4 hours after the deploy. That lets the soak test the whole finale path within two days, instead of waiting 30 days: paint for 4 hours, then mint the finale (holder of #0), list it in the Auction, bid for 24 hours, and settle with the keeper. The next season then runs a normal 30 days. On mainnet, use the real launch time instead.

```bash
DEPLOYER_ADDRESS=$DEPLOYER \
R3TARDS_ADDRESS=$MOCK \
SEASON_START=$(( $(date +%s) - 29*86400 - 20*3600 )) \
BASE_PIXELS_PER_HOUR=32 PIXELS_PER_ACTIVE_DAY=16 MAX_PIXELS_PER_HOUR=256 \
MIN_PIXELS_FOR_ACTIVE_DAY=16 HOLDER_PIXELS_PER_DAY=256 \
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --account r3tards-deployer --broadcast --slow
```

On testnet, `TOKEN_ZERO_RECIPIENT`, `ROYALTY_RECEIVER` and `FINAL_OWNER` can stay unset (they default to the deployer). On mainnet they must be the Safe.

The script prints every address. The deploy block is the first receipt's block:

```bash
python3 -c "import json;d=json.load(open('broadcast/Deploy.s.sol/10143/run-latest.json'));print(min(int(r['blockNumber'],16) for r in d['receipts']))"
```

## 4. Chain checks (paste the output to Claude)

```bash
cast code 0x0000F90827F1C53a10cb7A02335B175320002935 --rpc-url $RPC | head -c 20   # EIP-2935 history: 0x… = present
cast code 0xcA11bde05977b3631167028862bE2a173976CA11 --rpc-url $RPC | head -c 20   # Multicall3
```

## 5. Vercel environment (testnet)

```text
VITE_CHAIN_ID=10143
VITE_RPC_URLS=https://testnet-rpc.monad.xyz,https://rpc.ankr.com/monad_testnet,https://rpc-testnet.monadinfra.com
VITE_LOGS_RANGE=100
VITE_RPC_RPS=12
VITE_RPC_BATCH_SIZE=10
VITE_DEPLOY_BLOCK=<deploy block from step 3>
VITE_WS_URL=wss://testnet-rpc.monad.xyz
VITE_WALLET_RPC_URL=https://testnet-rpc.monad.xyz
VITE_EXPLORER_URL=https://testnet.monadvision.com
VITE_PAINT_ADDRESS=<R3tardsPaint address>
VITE_REVEAL_ALL=true
```

`VITE_REVEAL_ALL=true` matters on testnet: without it, the production build follows `public/releases.json` and hides Forks and Block DNA until their November dates, so testers could never reach them. Leave it unset on mainnet.

Leave the other `VITE_*_ADDRESS` overrides blank: the app finds every Lab through the core registry. Multicall3 defaults to the canonical address on 10143.

## 6. Soak checklist

- Paint, Flipbook (240K fixed), fork paint (250K fixed) and Sleepwalker steps (1M fixed) all confirm. Any out-of-gas revert: send Claude the tx hash.
- Sleep a dream overnight with a tip; crank from a second wallet in Night Shift; mint it in the morning.
- About 4 hours after the deploy, season 1 ends: mint its finale from My Frames (you hold #0), list it in the Auction, and have testers bid.
- Run `scripts/auction-keeper.sh` for that auction (`KEEPER_ACCOUNT` = a keystore name). Bidding lasts 288,000 blocks (about 24 hours).
- Watch the browser console in dev (`npm run dev` with the same env) for `[r3os rpc / 10s]`: an idle desktop should stay around 1 call/s with the websocket on.
