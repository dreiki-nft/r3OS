# Review snapshot-27 before dreiki commits

Base: `r3tards-paint-snapshot-26.zip`
Candidate: `r3tards-paint-snapshot-27.zip`

Do not redesign anything. This is a final pre-mainnet hardening batch. The core Paint contract is still frozen.

## What changed

1. **Live burner risk reduction**
   - `MAX_BURNER_FUND` is now 1 MON.
   - The cap applies to the resulting browser-held burner balance, not just one transfer.
   - Default funding target is ~20 paints instead of ~100.
   - Quick Start, manual Live wizard and Hardware Profiles top-up share the cap.
   - Tests updated for 0.5 MON target at the existing 200k/150k/100 gwei fixture, partial top-up, and balance-cap bypass attempts.

2. **Disconnected Paint preview copy**
   - With no wallet, Paint status says: `PREVIEW MODE · local only · connect to commit onchain`.
   - No paint semantics changed.

3. **Walletless public CD-ROM links**
   - `#/cdrom?cd=<id>` opens any real burned CD read-only from its onchain snapshot without a wallet or ownership.
   - Normal wallet Insert disc behavior is unchanged and still ownership-checks/ejects transferred CDs.
   - Opening a track in Imaging must not make the public CD disappear from the still-open CD-ROM window.
   - Inserting an owned disc while viewing a public disc exits public mode first.
   - Ejecting a public disc removes only the public route; it never mutates wallet ownership state.

4. **Mainnet Operator deploy safety**
   - `DeployOperator.s.sol` keeps the 90,000 s default off mainnet.
   - On chain 143, `MON_FEED_MAX_AGE` is now required explicitly. There is deliberately no 25 h mainnet fallback.

5. **Launch decision / docs**
   - UI-retired Labs stay deployed and registered unchanged through the hackathon. Do not call `retireExperiment` before launch.
   - PAGE.EXE / ROUTER-LAB remain needed by Explore Monad.
   - Public community-CD link added to the mainnet checklist.
   - Removed stray duplicate `contracts/contracts/` directory.

## Required validation

Run from a clean unpack of snapshot-27:

```bash
npm ci
npx tsc -b
npm run test:web
npm run build
```

Then from `contracts/` with the repo's normal Foundry setup:

```bash
forge build --force
forge test
```

No contract source changed, but `DeployOperator.s.sol` must compile.

## Browser checks

1. **Paint disconnected**
   - Open Paint with no wallet.
   - Draw locally.
   - Status visibly says Preview Mode / local only / connect to commit onchain.
   - Connect and normal paint flow still works.

2. **Public CD**
   - On local/testnet, use a real burned CD id.
   - Disconnect wallet and open `#/cdrom?cd=<id>`.
   - CD loads; UI says public disc / read-only / no wallet required.
   - Open `TRACK01.BMP`; close Imaging; the public CD must still be in the CD-ROM window.
   - Eject returns the drive to empty without wallet interaction.
   - With a wallet connected, normal Insert disc still lists only owned CD Burner Labs tokens and auto-ejects one that leaves the wallet.

3. **Live mode**
   - Existing quick-start fixture should target roughly 20 paints, not 100.
   - At 200k paint gas, 150k start gas, 100 gwei: target = 0.5 MON.
   - Existing 0.3 MON burner balance -> top-up = 0.2 MON.
   - 0.9 MON balance + 0.2 MON requested top-up must be refused.
   - 0.9 + 0.1 MON is allowed.
   - Quick Start still becomes prompt-free after setup.

4. **Operator script**
   - Local/testnet deploy still works with the existing default or explicit `MON_FEED_MAX_AGE=90000`.
   - Verify chain-143 path requires `MON_FEED_MAX_AGE` rather than silently using 90000.

## ChatGPT-side validation already done

- Static diff audit against snapshot-26.
- TypeScript parser/transpile check passed for all 10 changed TS/TSX files.
- Funding math independently checked.
- Full npm/Vitest/build could not be run in ChatGPT's container because registry dependency installation was unavailable; do not treat this candidate as verified until the commands above are green.

If you find only formatting or tiny compile/test slips, fix them directly. If behavior must materially change, stop and report it instead of redesigning the phase.
