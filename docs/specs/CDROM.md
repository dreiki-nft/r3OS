# CD-ROM (D:)

A Windows 98 CD-ROM drive for the CDs made in **Burn a CD**. It reads chain data only; there is no contract.

## What a CD holds

`R3tardsCDBurner.burnCD` stores an immutable snapshot (an SSTORE2-style `FrameStore` pointer, `snapshotPointer(tokenId)`):

| Bytes | Field |
|---|---|
| 0 | version (2) |
| 1 | track count (1–12) |
| 2 | label length |
| 3–7 | dominant colour, colours used, season count, storm tracks, has finale |
| 8–39 | oldest track id |
| 40–47 | min / max season (uint32 each) |
| 48–49 | disc colour mask |
| 50–… | label |
| 80 + 38·i | track i: frame id (32), season (4), flags (1: bit0 storm, bit1 finale), colour pair (1) |

The pointer's runtime code is `0x00 ‖ snapshot`. The drive reads it with `eth_getCode` and parses it in `src/cdrom/cdrom.ts`.

The pixels are **not** copied into the CD. Each track is a Paint frame id, and the core keeps every frame's data after the frame is sold or burned (`burn` removes ownership, not `frameData` / `frameCompositeData`). So a CD traded to another wallet still opens with every original track, including tracks whose source frame was later recycled.

## The drive

- **Desktop:** `CD-ROM (D:)`. With a disc inserted, the icon becomes a disc and the label becomes the volume label, e.g. `MY MIX (D:)`.
- **Empty drive:** opening it shows *"D:\ is not accessible. The device is not ready."* with **Insert disc…**.
- **Insert disc:** lists the CDs the wallet holds now (Labs tokens whose `sourceOf` is the CD Burner). The choice is remembered per chain + wallet in localStorage (a convenience only).
- **Public disc link:** `#/cdrom?cd=<id>` opens any real burned CD read-only straight from its onchain snapshot. No wallet and no ownership are required; this is the share/judge path for community CDs.
- **Explorer view:** `CDINFO.TXT` plus `TRACK01.BMP` … `TRACKnn.BMP`, in Details or Large Icons. Sizes are the real size of a 256×256 4-bit BMP (32,886 bytes). *Modified* is the frame's mint block time. The left web-view panel shows the CD-R art, then a thumbnail and facts for the selected track.
- **CDINFO.TXT:** label, tracks, seasons, storm/finale, burn block and time, burner (the `CDBurned` log at the Labs mint block, one single-block query), snapshot pointer, and one line per track.
- **Imaging:** double-clicking a track opens it full size with Previous/Next, Best Fit/100%/200%, and Properties (source frame, season, created block, whether the frame is now owned or recycled, who burned the CD).
- **Eject:** clears the drive. Wallet-inserted discs are ownership-checked and auto-ejected if they leave the wallet. Public deep-linked discs are read-only and are never treated as owned.

## RPC

Nothing polls. Opening a disc costs: 2 reads (snapshot pointer, Labs mint data), 1 `getCode`, the frame infos (cached), one single-block log query, and one cached `getBlock` per distinct block. Frame images come from `frameCompositeData` and are cached in IndexedDB.
