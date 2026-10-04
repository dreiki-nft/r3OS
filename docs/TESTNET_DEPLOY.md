# Testnet deploy runbook (Monad testnet, chain 10143)

Run this from your own machine. No raw private keys: every command uses a Foundry keystore (`--account`) or `--ledger`.

## 0. Tools

```bash
foundryup -i 1.8.3          # the repo builds with Foundry 1.8.3
cd contracts && forge build  # first build takes a few minutes (via-IR)
```

Every `forge script` below runs with `FOUNDRY_PROFILE=deploy`: same compiler settings, separate artifact folders (`out-deploy/`, `cache-deploy/`), so test-only build artifacts never mix with deployment artifacts and the script output stays warning-free.

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

These are the **snapshot-28 launch-candidate values**. Existing testnet Paint deployments keep their older immutable budget; redeploy the suite if the rehearsal must match mainnet exactly.

`SEASON_START` below is set **29 days 20 hours in the past**, so the first season ends about 4 hours after the deploy. That lets the soak test the whole finale path within two days, instead of waiting 30 days: paint for 4 hours, then mint the finale (holder of #0), list it in the Auction, bid for 24 hours, and settle with the keeper. The next season then runs a normal 30 days. On mainnet, use the real launch time instead.

```bash
DEPLOYER_ADDRESS=$DEPLOYER \
R3TARDS_ADDRESS=$MOCK \
SEASON_START=$(( $(date +%s) - 29*86400 - 20*3600 )) \
BASE_PIXELS_PER_HOUR=512 PIXELS_PER_ACTIVE_DAY=32 MAX_PIXELS_PER_HOUR=2048 \
MIN_PIXELS_FOR_ACTIVE_DAY=16 HOLDER_PIXELS_PER_DAY=512 \
FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --account r3tards-deployer --broadcast --slow
```

On testnet, `TOKEN_ZERO_RECIPIENT`, `ROYALTY_RECEIVER` and `FINAL_OWNER` can stay unset (they default to the deployer). On mainnet they must be the Safe.

The script prints every address. The deploy block is the first receipt's block:

```bash
python3 -c "import json;d=json.load(open('broadcast/Deploy.s.sol/10143/run-latest.json'));print(min(int(r['blockNumber'],16) for r in d['receipts']))"
```

### 3b. Monad Card driver

Monad Cards do not exist on testnet, so deploy the local-only mock, claim one card, then deploy CARD.DRV and append its experiment, Pass stamp source and quest. Use the same deployer/owner account and no raw private key:

```bash
forge create test/MockMonadCard.sol:MockMonadCard \
  --rpc-url $RPC --account r3tards-deployer --broadcast
export MONAD_CARD=<MockMonadCard deployed address>

cast send $MONAD_CARD "claim()" --rpc-url $RPC --account r3tards-deployer

export PAINT_ADDRESS=<R3tardsPaint from step 3>
export PASS_ADDRESS=<R3tardsPainterPass from step 3>
export QUESTS_ADDRESS=<R3tardsQuests from step 3>

MONAD_CARD_ADDRESS=$MONAD_CARD \
PAINT_ADDRESS=$PAINT_ADDRESS PASS_ADDRESS=$PASS_ADDRESS QUESTS_ADDRESS=$QUESTS_ADDRESS \
FOUNDRY_PROFILE=deploy forge script script/DeployMonadCard.s.sol:DeployMonadCard \
  --rpc-url $RPC --account r3tards-deployer --broadcast --slow

export CARD_MEMORY_ADDRESS=<R3tardsCardMemory from DeployMonadCard output>
```

CARD.DRV is now discoverable as `card-drv`. On testnet the hardware screen must label the card as a mock/unknown manufacturer rather than presenting it as the official chain-143 device.

### 3c. Monad hardware experiments

After CARD.DRV is deployed, run the Monad Hardware add-on so Block Camera receives the CARD.DRV address in its constructor:

```bash
export LABS_ADDRESS=<R3tardsLabs from step 3>

PAINT_ADDRESS=$PAINT_ADDRESS LABS_ADDRESS=$LABS_ADDRESS CARD_MEMORY_ADDRESS=$CARD_MEMORY_ADDRESS \
FOUNDRY_PROFILE=deploy forge script script/DeployMonadHW.s.sol:DeployMonadHW \
  --rpc-url $RPC --account r3tards-deployer --broadcast --slow
```

Save the three hardware addresses and experiment ids. Browser-check the active surfaces: **Explore Monad**, **System Information** and **Block Camera**. The PAGE.EXE backend is verified through Explore Monad → Storage race; CARD.DRV is verified through System Information / Block Camera. The direct PAGE.EXE, CARDMEM.EXE and Kernel Debugger windows are retired.

For MIP-4 reserve behaviour, use the retained Kernel contract tests/direct smoke path to run SINGLE, BURST GRACEFUL and BURST NAIVE and save the actual receipts/statuses. This is a contract verification step, not a reason to restore the retired Kernel Debugger UI. The local Monad anvil exposes the probe but did not enforce the end-of-transaction revert.

### 3d. Operator record and system event

Testnet uses the mock MON/USD feed. Deploy it with the same keystore account used for the suite, then deploy the two additive Operator contracts:

```bash
forge create test/MockMonUsdFeed.sol:MockMonUsdFeed \
  --rpc-url $RPC --account r3tards-deployer --broadcast
export MON_USD_FEED=<MockMonUsdFeed deployed address>

PAINT_ADDRESS=$PAINT_ADDRESS \
MON_USD_FEED=$MON_USD_FEED \
MON_PRICE_TRIGGER_MILLI_USD=333 \
MON_FEED_MAX_AGE=90000 \
FOUNDRY_PROFILE=deploy forge script script/DeployOperator.s.sol:DeployOperator \
  --rpc-url $RPC --account r3tards-deployer --broadcast --slow
```

Save the `R3tardsOperatorRecord` and `R3tardsSystemEvent` addresses and experiment ids. If the broadcaster is not the Paint owner, the script prints the exact `addExperiment` calldata for the Safe instead of pretending registration succeeded.

Soak the latch through all three visible states:

```bash
cast send $MON_USD_FEED "setAnswer(int256)" 3000000 \
  --rpc-url $RPC --account r3tards-deployer
# r3OS: DEVICE 07 must show ARMED.

cast send $MON_USD_FEED "setAnswer(int256)" 33300000 \
  --rpc-url $RPC --account r3tards-deployer
# r3OS: DEVICE 07 must show CONDITION MET before activation.
```

Use the active System Information DEVICE 07 action, or send `activate()` permissionlessly from a test account. After the receipt, System Information and the My Pass Operator tab must show the same permanent activation block. Reload the app and verify the state remains activated.

For Operator Record, use several real test actions, open **My Pass → Operator**, press `RECORD`, then confirm a second `RECORD` changes only `lastRecordBlock` and emits no `OperatorRecorded` event when no new subsystem or season was added. Compare the displayed OPR1 header with a direct `eth_getStorageAt` read for W0.
### 3e. Router lab

Deploy the read-only router lab after Operator. Off mainnet the script deploys its own mock wrapped-native token, mock USD token, diagnostic venue set and `router-mock-venues` directory by default:

```bash
PAINT_ADDRESS=$PAINT_ADDRESS DEPLOY_MOCK_VENUES=true \
FOUNDRY_PROFILE=deploy forge script script/DeployRouterLab.s.sol:DeployRouterLab \
  --rpc-url $RPC --account r3tards-deployer --broadcast --slow
```

Save the `R3tardsRouterLab` address and experiment id. If the broadcaster is not the Paint owner, the script prints the exact `addExperiment` calldata for the Safe. On mainnet, run the same script without mock venues; Explore Monad's Liquidity race uses the pinned mainnet adapter manifest and Router Lab verifies runtime-code hashes through RPC reads.

Contract-check Router Lab on testnet with the mock directory: `compare` must preserve each mock's exact status and a gas-burning venue must not hide later rows. The old ROUTER.EXE and Kernel Debugger command UIs remain retired. Browser-check **Explore Monad → Liquidity race** as the supported surface and confirm System Information reports the routing backend as expected.

Explore Monad Liquidity race must produce zero idle Router Lab polling. A user-triggered comparison is one pinned Router Lab `eth_call` plus only the metadata/code reads needed by the configured venue cache.


## 4. Chain checks (paste the output to Claude)

Run the read-only Launch Doctor against the deployment. It never signs or sends anything and never prints the RPC URL:

```bash
RPC_URL=$RPC npm run -s launch:doctor -- --paint $PAINT_ADDRESS --expected-owner $DEPLOYER --expected-chain 10143
RPC_URL=$RPC npm run -s launch:doctor -- --paint $PAINT_ADDRESS --expected-owner $DEPLOYER --expected-chain 10143 --json > launch-doctor-testnet.json
```

`FAIL` must be 0 before the soak starts. Review every `WARN` and `UNKNOWN`; the canonical list of what still needs real-chain proof is [`docs/PRE_MAINNET_CHECKLIST.md`](PRE_MAINNET_CHECKLIST.md). The two raw checks below are also covered by the doctor:

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
VITE_BUILD_ID=<public build label, e.g. snapshot-24>
```

`VITE_REVEAL_ALL=true` is useful on testnet for release-gated **active** programs. Retired programs are absent from the production registry regardless of reveal-all. Leave reveal-all unset on mainnet.

Leave the other `VITE_*_ADDRESS` overrides blank: the app finds every Lab through the core registry. Multicall3 defaults to the canonical address on 10143.

## 6. Soak checklist

- Paint and every active transaction path must confirm under the production gas policy. Retained retired-contract gas regressions (Flipbook 240K, fork paint 250K, Sleepwalker 1M) remain contract compatibility checks, not active UI paths. Any out-of-gas revert: keep the tx hash with the test record.
- Sleep a dream overnight with a tip; crank from a second wallet in Night Shift; mint it in the morning.
- About 4 hours after the deploy, season 1 ends: mint its finale from My Frames (you hold #0), list it in the Auction, and have testers bid.
- Run `scripts/auction-keeper.sh` for that auction (`KEEPER_ACCOUNT` = a keystore name). Bidding lasts 288,000 blocks: about 23 hours at the 0.29 s block time measured on testnet (2026-10-01), about 32 hours at 0.4 s.
- Watch the browser console in dev (`npm run dev` with the same env) for `[r3os rpc / 10s]`: an idle desktop should stay around 1 call/s with the websocket on.
- Open **Start → System Tools → DXDIAG.EXE** on each tester device and use **Copy Report** when something looks wrong; it contains no RPC URL and no wallet.
- **Start → Run…** with `forks` must still show "not installed yet" when `VITE_REVEAL_ALL` is off and the release date is in the future.

