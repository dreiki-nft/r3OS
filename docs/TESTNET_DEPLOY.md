# Testnet deploy runbook (Monad testnet, chain 10143)

Use this for a **fresh rehearsal deployment** of the current r3OS mainnet surface. The older snapshot-28 testnet suite remains useful for historical/live regression checks, but it is not the canonical deployment topology after Phase 7.6.

Run from your own machine. No raw private key is required: use a Foundry keystore or Ledger.

## 0. Tools

```bash
foundryup -i 1.8.3
cd contracts && forge build
```

Deployment commands use `FOUNDRY_PROFILE=deploy`, which keeps deployment artifacts separate from the normal test build.

## 1. Deployer and test MON

```bash
cast wallet import r3os-deployer --interactive
cast wallet address --account r3os-deployer
export RPC=https://testnet-rpc.monad.xyz
export DEPLOYER=$(cast wallet address --account r3os-deployer)
```

Fund that address from the official Monad testnet faucet.

## 2. Mock r3tards (testnet only)

```bash
forge create test/MockR3tards.sol:MockR3tards --rpc-url $RPC --account r3os-deployer --broadcast
export MOCK=<deployed address>
cast send $MOCK "mint(address,uint256)" $DEPLOYER 1 --rpc-url $RPC --account r3os-deployer
```

## 3. Deploy the active core suite

For a finale-path rehearsal you can set `SEASON_START` about 29 days 20 hours in the past so the first season ends roughly four hours after deployment. Mainnet uses the real launch schedule.

```bash
DEPLOYER_ADDRESS=$DEPLOYER \
R3TARDS_ADDRESS=$MOCK \
SEASON_START=$(( $(date +%s) - 29*86400 - 20*3600 )) \
BASE_PIXELS_PER_HOUR=512 PIXELS_PER_ACTIVE_DAY=32 MAX_PIXELS_PER_HOUR=2048 \
MIN_PIXELS_FOR_ACTIVE_DAY=16 HOLDER_PIXELS_PER_DAY=512 \
FOUNDRY_PROFILE=deploy forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC --account r3os-deployer --broadcast --slow
```

The canonical Phase 7.6 core deployment contains Paint, Labs, Painter Pass, three renderers, Finale Auction, Quests, Recycle Bin and CD Burner. It registers **4** core experiments, **2** initial Pass stamp sources and **7** day-one quests.

On testnet, token #0 recipient, royalty receiver and final owner can default to the deployer. Mainnet uses the intended Safe/roles.

Get the first deploy block from the broadcast record:

```bash
python3 -c "import json;d=json.load(open('broadcast/Deploy.s.sol/10143/run-latest.json'));print(min(int(r['blockNumber'],16) for r in d['receipts']))"
```

Export the printed Paint/Pass/Labs/Quests addresses before continuing.

### 3b. Monad Card driver

Monad Cards are mainnet assets, so testnet uses `MockMonadCard`:

```bash
forge create test/MockMonadCard.sol:MockMonadCard \
  --rpc-url $RPC --account r3os-deployer --broadcast
export MONAD_CARD=<mock address>
cast send $MONAD_CARD "claim()" --rpc-url $RPC --account r3os-deployer

export PAINT_ADDRESS=<R3OSPaint>
export PASS_ADDRESS=<R3OSPainterPass>
export QUESTS_ADDRESS=<R3OSQuests>

MONAD_CARD_ADDRESS=$MONAD_CARD \
PAINT_ADDRESS=$PAINT_ADDRESS PASS_ADDRESS=$PASS_ADDRESS QUESTS_ADDRESS=$QUESTS_ADDRESS \
FOUNDRY_PROFILE=deploy forge script script/DeployMonadCard.s.sol:DeployMonadCard \
  --rpc-url $RPC --account r3os-deployer --broadcast --slow

export CARD_MEMORY_ADDRESS=<R3OSCardMemory>
```

This adds `card-drv`, the `MONAD CARD` Pass source and `CARD CARRIER` quest. Testnet UI must clearly identify the card contract as a mock/non-mainnet device.

### 3c. Monad hardware

```bash
export LABS_ADDRESS=<R3OSLabs>

PAINT_ADDRESS=$PAINT_ADDRESS LABS_ADDRESS=$LABS_ADDRESS CARD_MEMORY_ADDRESS=$CARD_MEMORY_ADDRESS \
FOUNDRY_PROFILE=deploy forge script script/DeployMonadHW.s.sol:DeployMonadHW \
  --rpc-url $RPC --account r3os-deployer --broadcast --slow
```

The script deploys **PAGE.EXE** and **Block Camera** only. Browser-check Explore Monad → Storage race, System Information and Block Camera. PAGE.EXE is a backend rather than a standalone desktop program.

### 3d. Operator Record and System Event

Deploy the test feed, then the two additive contracts:

```bash
forge create test/MockMonUsdFeed.sol:MockMonUsdFeed \
  --rpc-url $RPC --account r3os-deployer --broadcast
export MON_USD_FEED=<mock feed>

PAINT_ADDRESS=$PAINT_ADDRESS \
MON_USD_FEED=$MON_USD_FEED \
MON_PRICE_TRIGGER_MILLI_USD=333 \
MON_FEED_MAX_AGE=90000 \
FOUNDRY_PROFILE=deploy forge script script/DeployOperator.s.sol:DeployOperator \
  --rpc-url $RPC --account r3os-deployer --broadcast --slow
```

Fresh deployments pass zero addresses into the fixed Operator Record v1 slots reserved for historical/discontinued sources. Verify active source matches in Launch Doctor.

Soak DEVICE 07 through ARMED → CONDITION MET → ACTIVATED using the mock feed, then reload and confirm the latch persists.

For Operator Record, perform several real active actions, press `RECORD`, and verify a second record with no new facts changes only `lastRecordBlock` and does not fabricate a new subsystem observation.

### 3e. Router Lab

```bash
PAINT_ADDRESS=$PAINT_ADDRESS DEPLOY_MOCK_VENUES=true \
FOUNDRY_PROFILE=deploy forge script script/DeployRouterLab.s.sol:DeployRouterLab \
  --rpc-url $RPC --account r3os-deployer --broadcast --slow
```

Off mainnet the script can install diagnostic mock venues. Chain 143 uses only the pinned production adapter manifest. The supported browser surface is **Explore Monad → Liquidity race**; Router Lab should create zero idle polling and one user-triggered comparison should remain read-only.

## 4. Chain checks

```bash
RPC_URL=$RPC npm run -s launch:doctor -- \
  --paint $PAINT_ADDRESS --expected-owner $DEPLOYER --expected-chain 10143

RPC_URL=$RPC npm run -s launch:doctor -- \
  --paint $PAINT_ADDRESS --expected-owner $DEPLOYER --expected-chain 10143 \
  --json > launch-doctor-testnet.json
```

`FAIL` must be 0. Review every WARN/UNKNOWN. The canonical remaining checks live in [`PRE_MAINNET_CHECKLIST.md`](PRE_MAINNET_CHECKLIST.md).

Useful raw capability checks:

```bash
cast code 0x0000F90827F1C53a10cb7A02335B175320002935 --rpc-url $RPC | head -c 20
cast code 0xcA11bde05977b3631167028862bE2a173976CA11 --rpc-url $RPC | head -c 20
```

## 5. Frontend environment

```text
VITE_CHAIN_ID=10143
VITE_RPC_URLS=https://testnet-rpc.monad.xyz,https://rpc.ankr.com/monad_testnet,https://rpc-testnet.monadinfra.com
VITE_LOGS_RANGE=100
VITE_RPC_RPS=12
VITE_RPC_BATCH_SIZE=10
VITE_DEPLOY_BLOCK=<deploy block>
VITE_WS_URL=wss://testnet-rpc.monad.xyz
VITE_WALLET_RPC_URL=https://testnet-rpc.monad.xyz
VITE_EXPLORER_URL=https://testnet.monadvision.com
VITE_PAINT_ADDRESS=<R3OSPaint>
VITE_REVEAL_ALL=true
VITE_BUILD_ID=<public rehearsal build id>
```

Leave optional add-on address overrides blank unless debugging; normal discovery comes from the Paint registry. Reveal-all is useful only for test/preview and should be unset on mainnet.

## 6. Soak

- Run two-wallet Live painting and verify remote render timing, receipt inclusion and X-ray commit-state progression separately.
- Exercise r3tards holder quota on the test mock. Partner bonuses are intentionally disabled off chain 143, so verify those via mainnet fork/known holders in Phase 8.
- Save frames, claim Pass, claim quests, recycle frames and burn/play a CD.
- Capture a Block Camera portrait and include it in a mixed CD without transferring/destroying the source portrait.
- Run Explore Monad Storage race and Liquidity race manually; verify there is no idle Router polling.
- Exercise the shortened-season finale and candle auction, with keeper settlement.
- Keep DXDIAG reports from Edge/Chrome, including boot timing, RPC rate and Live action timing.
- Test websocket failure → polling, degraded primary RPC → fallback, reload, wallet switch and multiple tabs.
- Confirm historical/discontinued program commands do not open any production program in the fresh deployment.
