# Community bug hunt

During the launch window the r3tards community was invited to break r3OS on mainnet, for a shared reward of 2,500 MON and one r3tard NFT. Rewards go by what was found, not by how many reports were sent. Every report was triaged in public, and every fix links to its commit.

| | |
| --- | ---: |
| Community reports | 45 |
| Reporters | 8 |
| Bugs fixed (community and team) | 39 |
| Still open | 1 |
| Questions answered (working as intended) | 8 |
| Community bugs by severity | Critical 1 · High 6 · Medium 12 · Low 16 · Info 2 |

Reporters are named where they agreed to it.

## Bugs found

| Date | Reporter | Area | Finding | Severity | Status | Fix |
|---|---|---|---|---|---|---|
| 2026-10-10 | community member | Paint | On desktop the bottom quarter of the canvas was hidden behind the palette panel | High | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | community member | Network / RPC | One websocket drop left the tab on HTTP polling for good, at about 10x the RPC traffic | High | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | community member | Network / RPC | A silently stalled websocket froze the block feed with no warning or recovery | High | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | community member | Wallet | Couldn't connect with Rabby wallet | Medium | Fixed | [`f6e71b7`](https://github.com/dreiki-nft/r3OS/commit/f6e71b7) |
| 2026-10-10 | community member | Security | Security policy allowed connections and images from any https address (no exfiltration protection) | Medium | Fixed |  |
| 2026-10-10 | community member | Security | The whole build environment was dumped into the public JS (repo, commit, Vercel deployment and project IDs) | Medium | Fixed |  |
| 2026-10-10 | community member | Security | Every missing path returned 200 (/.env, /robots.txt, /sitemap.xml, /.git/config) and there was no security.txt | Medium | Fixed |  |
| 2026-10-10 | community member | Live Mode | Two tabs in Live Mode reused the same transaction number, and two tabs could each create a Live Mode key | Medium | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | community member | Paint | A remote stroke that arrived during a full canvas reload disappeared for up to 30 s | Medium | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | community member | Paint | Pass showed budget left while Paint showed 0 | Low | Fixed |  |
| 2026-10-10 | community member | Security | HSTS missing includeSubDomains / preload; HTML served with a wildcard CORS header and no Vary | Low | Fixed |  |
| 2026-10-10 | community member | Wallet | A guest link pasted into an open tab swapped the wallet without asking | Low | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | community member | Other | Tabs open across a deploy failed to load programs that weren't prefetched | Low | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | community member | Network / RPC | MetadataUpdate, Transfer and Recycled watchers had no error handler and never recovered | Low | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-10 | team | Paint | Canvas resized and shifted slightly as text around it changed | Low | Fixed | [`adb879c`](https://github.com/dreiki-nft/r3OS/commit/adb879c) |
| 2026-10-10 | community member | Network / RPC | rpc1.monad.xyz failed CORS on error / 429 responses but stayed in the fallback list | Info | Fixed |  |
| 2026-10-10 | community member | Other | The try r3OS card offered Open Paint while Paint was already open | Info | Fixed | [`874ac10`](https://github.com/dreiki-nft/r3OS/commit/874ac10) |
| 2026-10-11 | community member | Paint / Live Mode | Browser said 'page not responding' while painting in Live Mode (twice) | Critical | Fixed | [`6e3b714`](https://github.com/dreiki-nft/r3OS/commit/6e3b714) |
| 2026-10-11 | community member | Paint / Live Mode | After the hourly refill, one stroke dropped the budget straight back to 0 | High | Fixed | [`49c8007`](https://github.com/dreiki-nft/r3OS/commit/49c8007) |
| 2026-10-11 | community member | Phone layout | App froze 3 times in MetaMask's browser (Galaxy S24 Ultra); refreshing gave a blank page | High | Fixed | [`6e3b714`](https://github.com/dreiki-nft/r3OS/commit/6e3b714) |
| 2026-10-11 | community member | Paint / Live Mode | 'region 2 hit its per-block paint limit' after painting, and the drawing never went out | High | Fixed | [`9d39dc8`](https://github.com/dreiki-nft/r3OS/commit/9d39dc8) |
| 2026-10-11 | community member | Frames / CDs | Red 'ERC721NonexistentToken' right after a successful CD burn | Medium | Fixed | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | community member | My Pass | Operator Record showed LAST ACTIVE and SUBSYSTEMS USED as UNKNOWN for everyone | Medium | Fixed | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | community member | Other | Help window crashed (illegal operation) with a page translator or extension active | Medium | Fixed | [`f5f6410`](https://github.com/dreiki-nft/r3OS/commit/f5f6410) |
| 2026-10-11 | community member | Paint | Drawing lost after leaving for the MetaMask app to connect | Medium | Fixed |  |
| 2026-10-11 | community member | Paint / Live Mode | When a Live Mode stroke failed, its pixels stayed on the canvas looking painted even though they never saved | Medium | Fixed | [`c674bba`](https://github.com/dreiki-nft/r3OS/commit/c674bba) |
| 2026-10-11 | community member | My Pass | Chosen r3tard (#904) didn't show on My Pass after a reload | Medium | Fixed | [`2c4d58e`](https://github.com/dreiki-nft/r3OS/commit/2c4d58e) |
| 2026-10-11 | community member | Other | Monad Card detected but its number 'not indexed', so Page and Writes stayed unknown | Low | Fixed | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | community member | Wallet / Paint | Cancelling a signature on purpose (Chrome) showed a red error popup | Low | Fixed | [`ced5ebc`](https://github.com/dreiki-nft/r3OS/commit/ced5ebc) |
| 2026-10-11 | community member | Frames / CDs | Frame-saved message ended with 'sealed by block.coinbase', which read like an unfilled placeholder | Low | Fixed | [`0fdef31`](https://github.com/dreiki-nft/r3OS/commit/0fdef31) |
| 2026-10-11 | community member | Phone layout | No way to zoom the canvas on phones: no zoom tool, pinching did nothing | Low | Fixed |  |
| 2026-10-11 | community member | Other | Some errors showed raw codes like ACTION_RECEIPT_TIMEOUT instead of a sentence | Low | Fixed | [`e0e4577`](https://github.com/dreiki-nft/r3OS/commit/e0e4577) |
| 2026-10-11 | community member | Wallet | Rejecting 'Switch to Monad' in the wallet gave no feedback at all | Low | Fixed | [`0fdef31`](https://github.com/dreiki-nft/r3OS/commit/0fdef31) |
| 2026-10-11 | community member | Paint | A 406 px stroke failed with 'needs 595 pixels', which looked like a miscount | Low | Fixed | [`e0e4577`](https://github.com/dreiki-nft/r3OS/commit/e0e4577) |
| 2026-10-11 | community member | Phone layout | Empty strip under the taskbar on Samsung Internet | Low | Fixed | [`2c4d58e`](https://github.com/dreiki-nft/r3OS/commit/2c4d58e) |
| 2026-10-11 | community member | My Pass | Stamps tab didn't say how to earn stamps ('Lab-specific rule'), and 'View by Lab' did nothing | Low | Fixed |  |
| 2026-10-11 | team | Other | BIOS screen showed an impossible block time (0.18 s) | Low | Fixed |  |
| 2026-10-11 | team | Paint | Save canvas to floppy left out what you had drawn but not painted yet (e.g. drawing without a wallet) | Low | Fixed | [`12266dc`](https://github.com/dreiki-nft/r3OS/commit/12266dc) |
| 2026-10-11 | community member | Other | Getting-started card stayed at 1/4 although all four steps were done | Low | Open | [`4d2045f`](https://github.com/dreiki-nft/r3OS/commit/4d2045f) |
| 2026-10-11 | community member | My Pass | Painted and saved, but the getting-started card never offered the Pass claim | Low | Fixed | [`e0e4577`](https://github.com/dreiki-nft/r3OS/commit/e0e4577) |

## Questions answered

Reports that turned out to be intended behaviour, with the reason. They still count toward the reward.

| Date | Reporter | Area | Question | Answer |
|---|---|---|---|---|
| 2026-10-10 | community member | Network / RPC | Accelerator responses are never cached (Cache-Control: no-store), one fresh upstream call per page load | Works as intended: The boot data carries the latest block, so a cached copy would be out of date. The worker's rate limit keeps the cost bounded. |
| 2026-10-10 | community member | Network / RPC | Accelerator worker seemed to have no rate limit and only Origin-based access | Explained: It does have a rate limit (60 requests per minute); the 15 test requests stayed under it. It only serves public chain data, so faking the Origin header gets nothing private. |
| 2026-10-10 | community member | Security | robots.txt, manifest and security.txt returned the app page | Already reported: Same finding as an earlier report, which is fixed. |
| 2026-10-10 | community member | Paint | Same wallet in several browsers seemed to get the full hourly budget in each | Explained: The hourly budget belongs to the wallet onchain, so every browser shares the same one (a contract test checks this). It refills every UTC hour. |
| 2026-10-10 | community member | Security | Internal details visible: x-r3os-accelerator header, /health mode string, EDGE_* error codes | Explained: These are public diagnostics, kept on purpose for debugging. They contain no secrets or RPC URLs. |
| 2026-10-11 | community member | Security | Live Mode burner key stored unencrypted in browser storage | Works as intended: r3OS has no server, so the Live Mode key has to live in the browser. It can only paint and claim quests, holds at most 10 MON and expires. Explained in THREAT_MODEL.md. |
| 2026-10-11 | community member | Wallet | Fee shown by the app differed from what the wallet charged | Works as intended: r3OS quotes at the gas price it suggests. Wallets can switch to their own faster setting (here 'Rápido'), which costs more, and Monad charges by the gas limit. Following his suggestion, every wallet-paid quote now says so in one line. |
| 2026-10-11 | community member | Phone layout | Assistant character missing on phones, with no icon or toggle | Works as intended: Hidden on purpose on screens 640 px wide or less, so it doesn't cover Paint on small phones. |
