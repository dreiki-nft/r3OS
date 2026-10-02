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

These pixel numbers are **testnet values** (the same as the core tests). Pick the real launch numbers before mainnet.

`SEASON_START` below is set **29 days 20 hours in the past**, so the first season ends about 4 hours after the deploy. That lets the soak test the whole finale path within two days, instead of waiting 30 days: paint for 4 hours, then mint the finale (holder of #0), list it in the Auction, bid for 24 hours, and settle with the keeper. The next season then runs a normal 30 days. On mainnet, use the real launch time instead.

```bash
DEPLOYER_ADDRESS=$DEPLOYER \
R3TARDS_ADDRESS=$MOCK \
SEASON_START=$(( $(date +%s) - 29*86400 - 20*3600 )) \
BASE_PIXELS_PER_HOUR=32 PIXELS_PER_ACTIVE_DAY=16 MAX_PIXELS_PER_HOUR=256 \
MIN_PIXELS_FOR_ACTIVE_DAY=16 HOLDER_PIXELS_PER_DAY=256 \
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

Save the three hardware addresses and experiment ids. Browser-check PAGE.EXE, CARDMEM.EXE, Block Camera, Kernel Debugger and Monad Hardware. Program the mock card once, confirm the same page appears in PAGE.EXE and Kernel Debugger, and capture a card-enabled Block Camera shot both with and without the optional canvas hash.

In Kernel Debugger, also fund the process key with 0.05 MON and run SINGLE, BURST GRACEFUL and BURST NAIVE. Paste back the actual receipts/statuses; the local Monad anvil exposes the reserve probe but did not enforce the end-of-transaction revert.

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
# r3tardOS: DEVICE 07 must show ARMED.

cast send $MON_USD_FEED "setAnswer(int256)" 33300000 \
  --rpc-url $RPC --account r3tards-deployer
# r3tardOS: DEVICE 07 must show CONDITION MET before activation.
```

Use DEVICE 07's `ACTIVATE` button, or send `activate()` permissionlessly from a test account. After the receipt, Monad Hardware, the Operator tab and Kernel Debugger `event` command must all show the same permanent activation block. Reload the app and verify the state remains activated.

For Operator Record, use several real test actions, open **My Pass → Operator**, press `RECORD`, then confirm a second `RECORD` changes only `lastRecordBlock` and emits no `OperatorRecorded` event when no new subsystem or season was added. Kernel Debugger `operator <address>` must show the same OPR1 header as `eth_getStorageAt` for W0.
### 3e. Router lab

Deploy the read-only router lab after Operator. Off mainnet the script deploys its own mock wrapped-native token, mock USD token, diagnostic venue set and `router-mock-venues` directory by default:

```bash
PAINT_ADDRESS=$PAINT_ADDRESS DEPLOY_MOCK_VENUES=true \
FOUNDRY_PROFILE=deploy forge script script/DeployRouterLab.s.sol:DeployRouterLab \
  --rpc-url $RPC --account r3tards-deployer --broadcast --slow
```

Save the `R3tardsRouterLab` address and experiment id. If the broadcaster is not the Paint owner, the script prints the exact `addExperiment` calldata for the Safe. On mainnet, run the same script without mock venues; ROUTER.EXE uses its pinned mainnet adapter manifest and verifies runtime-code hashes through RPC reads.

Browser-check ROUTER.EXE on testnet with the mock directory. One RUN must show each mock's exact status while the gas-burning venue does not hide later rows. Enable the STATICCALL probe and confirm the stateful mock reports `STATIC FAILED` while its normal quote remains `OK`. QUOTE SCOPE must show the under-delivering mock's quoted/delivered delta and leave no persistent balances or approvals. Kernel Debugger `venues`, `route` and `quote` must use the same directory. Monad Hardware must show the MRC-17 DRAFT router row and the transaction-forwarding research section.

ROUTER.EXE should produce zero idle polling with Auto disabled. A normal RUN is one block-number read plus one lab `eth_call`; the optional Monoper and QUOTE SCOPE checks are separate calls. Token metadata and adapter code are session-cached.


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

`VITE_REVEAL_ALL=true` matters on testnet: without it, the production build follows `public/releases.json` and hides Forks and Block DNA until their November dates, so testers could never reach them. Leave it unset on mainnet.

Leave the other `VITE_*_ADDRESS` overrides blank: the app finds every Lab through the core registry. Multicall3 defaults to the canonical address on 10143.

## 6. Soak checklist

- Paint, Flipbook (240K fixed), fork paint (250K fixed) and Sleepwalker steps (1M fixed) all confirm. Any out-of-gas revert: send Claude the tx hash.
- Sleep a dream overnight with a tip; crank from a second wallet in Night Shift; mint it in the morning.
- About 4 hours after the deploy, season 1 ends: mint its finale from My Frames (you hold #0), list it in the Auction, and have testers bid.
- Run `scripts/auction-keeper.sh` for that auction (`KEEPER_ACCOUNT` = a keystore name). Bidding lasts 288,000 blocks: about 23 hours at the 0.29 s block time measured on testnet (2026-10-01), about 32 hours at 0.4 s.
- Watch the browser console in dev (`npm run dev` with the same env) for `[r3os rpc / 10s]`: an idle desktop should stay around 1 call/s with the websocket on.
- Open **Start → System Tools → DXDIAG.EXE** on each tester device and use **Copy Report** when something looks wrong; it contains no RPC URL and no wallet.
- **Start → Run…** with `forks` must still show "not installed yet" when `VITE_REVEAL_ALL` is off and the release date is in the future.

