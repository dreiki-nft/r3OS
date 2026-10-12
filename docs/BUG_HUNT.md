# Community bug hunt

Right after launch the r3tards community was invited to break r3OS on mainnet in a 24-hour bug hunt ([announcement](https://x.com/Dreiki10/status/2109254669050552563)), for a shared reward of **2,500 MON and one r3tard NFT** ([winners](https://x.com/Dreiki10/status/2109645766901862451)). Reports kept coming after the hunt, and they are all here. Every report was triaged in public, fixes shipped as they came in, and each one links to its commit.

| | |
| --- | ---: |
| Community reports | 48 |
| Reporters | 8 |
| Bugs fixed (community and team) | 42 |
| Still open | 1 |
| Questions answered (working as intended) | 8 |
| Community bugs by severity | Critical 1 · High 6 · Medium 14 · Low 17 · Info 2 |

## How reports were scored

Reports were scored by what they found, not by how many were sent. Each report was scored when it was confirmed:

| Outcome | Points |
| --- | ---: |
| Critical bug (open or fixed) | 40 |
| High bug (open or fixed) | 20 |
| Medium bug (open or fixed) | 10 |
| Low bug (open or fixed) | 5 |
| Info bug (open or fixed) | 2 |
| Report that turned out to be intended behaviour (the question still helped) | 1 |
| Duplicate of an earlier report | 0 |
| Team findings | not scored |

Severity reflects impact on people using r3OS: Critical stops the app for everyone who hits it, High breaks painting or loses work, Medium breaks a feature or misleads, Low is cosmetic or has an easy workaround.

## Leaderboard

| # | Reporter | Points | Bugs | Most severe | Questions | Prize |
| ---: | --- | ---: | ---: | --- | ---: | --- |
| 1 | Large Eyes | 99 | 10 | High | 0 | 1 r3tard NFT |
| 2 | Cranium | 86 | 6 | Critical | 1 | 2,500 MON |
| 3 | Dragon Warrior | 71 | 10 | Medium | 1 | 1,000 MON (extra prize) |
| 4 | Levi | 39 | 4 | Medium | 4 |  |
| 5 | noajolouis | 35 | 3 | High | 0 |  |
| 6 | WillAlves | 30 | 3 | High | 0 |  |
| 7 | Jans | 25 | 2 | High | 0 |  |
| 8 | Dobby | 6 | 1 | Low | 1 |  |

391 points in total. The prizes went to the top three ([winners announcement](https://x.com/Dreiki10/status/2109645766901862451)): the r3tard NFT to Large Eyes, 2,500 MON to Cranium, and an extra 1,000 MON prize, on top of the announced pool, to Dragon Warrior.

## Bugs found

| Date | Reporter | Area | Finding | Severity | Status | Fix |
|---|---|---|---|---|---|---|
| 2026-10-10 | Large Eyes | Paint | On desktop the bottom quarter of the canvas was hidden behind the palette panel | High | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | Large Eyes | Network / RPC | One websocket drop left the tab on HTTP polling for good, at about 10x the RPC traffic | High | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | Large Eyes | Network / RPC | A silently stalled websocket froze the block feed with no warning or recovery | High | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | Cranium | Wallet | Couldn't connect with Rabby wallet | Medium | Fixed | [`f6e71b7`](https://github.com/dreiki-nft/r3OS/commit/f6e71b7) |
| 2026-10-10 | Levi | Security | Security policy allowed connections and images from any https address (no exfiltration protection) | Medium | Fixed | [`9b132df`](https://github.com/dreiki-nft/r3OS/commit/9b132df) |
| 2026-10-10 | Levi | Security | The whole build environment was dumped into the public JS (repo, commit, Vercel deployment and project IDs) | Medium | Fixed |  |
| 2026-10-10 | Levi | Security | Every missing path returned 200 (/.env, /robots.txt, /sitemap.xml, /.git/config) and there was no security.txt | Medium | Fixed |  |
| 2026-10-10 | Large Eyes | Live Mode | Two tabs in Live Mode reused the same transaction number, and two tabs could each create a Live Mode key | Medium | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | Large Eyes | Paint | A remote stroke that arrived during a full canvas reload disappeared for up to 30 s | Medium | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | Dobby | Paint | Pass showed budget left while Paint showed 0 | Low | Fixed |  |
| 2026-10-10 | Levi | Security | HSTS missing includeSubDomains / preload; HTML served with a wildcard CORS header and no Vary | Low | Fixed |  |
| 2026-10-10 | Large Eyes | Wallet | A guest link pasted into an open tab swapped the wallet without asking | Low | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | Large Eyes | Other | Tabs open across a deploy failed to load programs that weren't prefetched | Low | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | Large Eyes | Network / RPC | MetadataUpdate, Transfer and Recycled watchers had no error handler and never recovered | Low | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | team | Paint | Canvas resized and shifted slightly as text around it changed | Low | Fixed | [`adb879c`](https://github.com/dreiki-nft/r3OS/commit/adb879c) |
| 2026-10-10 | Large Eyes | Network / RPC | rpc1.monad.xyz failed CORS on error / 429 responses but stayed in the fallback list | Info | Fixed |  |
| 2026-10-10 | Large Eyes | Other | The try r3OS card offered Open Paint while Paint was already open | Info | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-11 | Cranium | Paint / Live Mode | Browser said 'page not responding' while painting in Live Mode (twice) | Critical | Fixed | [`6e3b714`](https://github.com/dreiki-nft/r3OS/commit/6e3b714) |
| 2026-10-11 | Jans | Paint / Live Mode | After the hourly refill, one stroke dropped the budget straight back to 0 | High | Fixed | [`49c8007`](https://github.com/dreiki-nft/r3OS/commit/49c8007) |
| 2026-10-11 | noajolouis | Phone layout | App froze 3 times in MetaMask's browser (Galaxy S24 Ultra); refreshing gave a blank page | High | Fixed | [`6e3b714`](https://github.com/dreiki-nft/r3OS/commit/6e3b714) |
| 2026-10-11 | WillAlves | Paint / Live Mode | 'region 2 hit its per-block paint limit' after painting, and the drawing never went out | High | Fixed | [`9d39dc8`](https://github.com/dreiki-nft/r3OS/commit/9d39dc8) |
| 2026-10-11 | Cranium | Frames / CDs | Red 'ERC721NonexistentToken' right after a successful CD burn | Medium | Fixed | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | Cranium | My Pass | Operator Record showed LAST ACTIVE and SUBSYSTEMS USED as UNKNOWN for everyone | Medium | Fixed | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | Cranium | Other | Help window crashed (illegal operation) with a page translator or extension active | Medium | Fixed | [`f5f6410`](https://github.com/dreiki-nft/r3OS/commit/f5f6410) |
| 2026-10-11 | Dragon Warrior | Paint | Drawing lost after leaving for the MetaMask app to connect | Medium | Fixed |  |
| 2026-10-11 | Dragon Warrior | Paint / Live Mode | When a Live Mode stroke failed, its pixels stayed on the canvas looking painted even though they never saved | Medium | Fixed | [`c674bba`](https://github.com/dreiki-nft/r3OS/commit/c674bba) |
| 2026-10-11 | noajolouis | My Pass | Chosen r3tard (#904) didn't show on My Pass after a reload | Medium | Fixed | [`2c4d58e`](https://github.com/dreiki-nft/r3OS/commit/2c4d58e) |
| 2026-10-11 | Cranium | Other | Monad Card detected but its number 'not indexed', so Page and Writes stayed unknown | Low | Fixed | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | Dragon Warrior | Wallet / Paint | Cancelling a signature on purpose (Chrome) showed a red error popup | Low | Fixed | [`ced5ebc`](https://github.com/dreiki-nft/r3OS/commit/ced5ebc) |
| 2026-10-11 | Dragon Warrior | Frames / CDs | Frame-saved message ended with 'sealed by block.coinbase', which read like an unfilled placeholder | Low | Fixed | [`0fdef31`](https://github.com/dreiki-nft/r3OS/commit/0fdef31) |
| 2026-10-11 | Dragon Warrior | Phone layout | No way to zoom the canvas on phones: no zoom tool, pinching did nothing | Low | Fixed |  |
| 2026-10-11 | Dragon Warrior | Other | Some errors showed raw codes like ACTION_RECEIPT_TIMEOUT instead of a sentence | Low | Fixed | [`e0e4577`](https://github.com/dreiki-nft/r3OS/commit/e0e4577) |
| 2026-10-11 | Dragon Warrior | Wallet | Rejecting 'Switch to Monad' in the wallet gave no feedback at all | Low | Fixed | [`0fdef31`](https://github.com/dreiki-nft/r3OS/commit/0fdef31) |
| 2026-10-11 | Jans | Paint | A 406 px stroke failed with 'needs 595 pixels', which looked like a miscount | Low | Fixed | [`e0e4577`](https://github.com/dreiki-nft/r3OS/commit/e0e4577) |
| 2026-10-11 | noajolouis | Phone layout | Empty strip under the taskbar on Samsung Internet | Low | Fixed | [`2c4d58e`](https://github.com/dreiki-nft/r3OS/commit/2c4d58e) |
| 2026-10-11 | community member | My Pass | Stamps tab didn't say how to earn stamps ('Lab-specific rule'), and 'View by Lab' did nothing | Low | Fixed |  |
| 2026-10-11 | team | Other | BIOS screen showed an impossible block time (0.18 s) | Low | Fixed |  |
| 2026-10-11 | team | Paint | Save canvas to floppy left out what you had drawn but not painted yet (e.g. drawing without a wallet) | Low | Fixed | [`12266dc`](https://github.com/dreiki-nft/r3OS/commit/12266dc) |
| 2026-10-11 | WillAlves | Other | Getting-started card stayed at 1/4 although all four steps were done | Low | Open | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | WillAlves | My Pass | Painted and saved, but the getting-started card never offered the Pass claim | Low | Fixed | [`e0e4577`](https://github.com/dreiki-nft/r3OS/commit/e0e4577) |
| 2026-10-12 | Dragon Warrior | Frames / CDs | Tapping one of your CDs in Burn a CD wiped the mix being built (tracks and label), with no warning | Medium | Fixed | [`9b132df`](https://github.com/dreiki-nft/r3OS/commit/9b132df) |
| 2026-10-12 | Dragon Warrior | Phone layout | Window close buttons were tiny on phones, and they're the only way to close a window | Medium | Fixed | [`9b132df`](https://github.com/dreiki-nft/r3OS/commit/9b132df) |
| 2026-10-12 | Dragon Warrior | Phone layout | On phones the desktop icons stacked in one narrow strip on the left | Low | Fixed | [`9b132df`](https://github.com/dreiki-nft/r3OS/commit/9b132df) |

## Questions answered

Reports that turned out to be intended behaviour, with the reason.

| Date | Reporter | Area | Question | Answer |
|---|---|---|---|---|
| 2026-10-10 | Levi | Network / RPC | Accelerator responses are never cached (Cache-Control: no-store), one fresh upstream call per page load | Works as intended: The boot data carries the latest block, so a cached copy would be out of date. The worker's rate limit keeps the cost bounded. |
| 2026-10-10 | Levi | Network / RPC | Accelerator worker seemed to have no rate limit and only Origin-based access | Explained: It does have a rate limit (60 requests per minute); the 15 test requests stayed under it. It only serves public chain data, so faking the Origin header gets nothing private. |
| 2026-10-10 | Large Eyes | Security | robots.txt, manifest and security.txt returned the app page | Already reported: Same finding as an earlier report, which is fixed. |
| 2026-10-10 | Dobby | Paint | Same wallet in several browsers seemed to get the full hourly budget in each | Explained: The hourly budget belongs to the wallet onchain, so every browser shares the same one (a contract test checks this). It refills every UTC hour. |
| 2026-10-10 | Levi | Security | Internal details visible: x-r3os-accelerator header, /health mode string, EDGE_* error codes | Explained: These are public diagnostics, kept on purpose for debugging. They contain no secrets or RPC URLs. |
| 2026-10-11 | Levi | Security | Live Mode burner key stored unencrypted in browser storage | Works as intended: r3OS has no server, so the Live Mode key has to live in the browser. It can only paint and claim quests, holds at most 10 MON and expires. Explained in THREAT_MODEL.md. |
| 2026-10-11 | Cranium | Wallet | Fee shown by the app differed from what the wallet charged | Works as intended: r3OS quotes at the gas price it suggests. Wallets can switch to their own faster setting (here 'Rápido'), which costs more, and Monad charges by the gas limit. Following his suggestion, every wallet-paid quote now says so in one line. |
| 2026-10-11 | Dragon Warrior | Phone layout | Assistant character missing on phones, with no icon or toggle | Works as intended: Hidden on purpose on screens 640 px wide or less, so it doesn't cover Paint on small phones. |
