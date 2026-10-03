# CD-ROM (D:)

A Windows 98 CD-ROM drive for the CDs made in **Burn a CD**. It reads chain data only; there is no contract.

## What a CD holds

`R3tardsCDBurner` stores an immutable SSTORE2-style `FrameStore` snapshot at `snapshotPointer(tokenId)`. The drive accepts legacy v2 frame-only discs and v3 mixed discs:

| Bytes | Field |
|---|---|
| 0 | version (2 legacy, 3 mixed) |
| 1 | track count (1–12) |
| 2 | label length |
| 3–7 | dominant colour, colours used, season count, storm tracks, has finale |
| 8–39 | oldest track id |
| 40–47 | min / max season (uint32 each) |
| 48–49 | disc colour mask |
| 50–… | label |
| 74–75 | v3 only: Paint-frame count / Block-photo count |
| 80 + 38·i | track i: source id (32), season (4), flags (bit0 storm, bit1 finale, bit2 Block Camera), colour pair (1) |

The pointer's runtime code is `0x00 ‖ snapshot`. The drive reads it with `eth_getCode` and parses it in `src/cdrom/cdrom.ts`.

The pixels are **not** copied into the CD. Paint tracks read immutable frame data from the Paint core. Block-photo tracks read immutable Labs metadata/image from the original Block Camera token. Source ownership is irrelevant after mint, so a traded CD still plays every original track.

## The drive

- **Desktop:** `CD-ROM (D:)`. With a disc inserted, the icon becomes a disc and the label becomes the volume label, e.g. `MY MIX (D:)`.
- **Empty drive:** opening it shows *"D:\ is not accessible. The device is not ready."* with **Insert disc…**.
- **Insert disc:** lists the CDs the wallet holds now (Labs tokens whose `sourceOf` is the CD Burner). The choice is remembered per chain + wallet in localStorage (a convenience only).
- **Public disc link:** `#/cdrom?cd=<id>` opens any real burned CD read-only straight from its onchain snapshot. No wallet and no ownership are required; this is the share/judge path for community CDs.
- **Explorer view:** `CDINFO.TXT`, Paint tracks as `TRACKnn.BMP`, and Block Camera tracks as `PHOTOnn.SVG`, in Details or Large Icons. Paint sizes are the real 256×256 4-bit BMP size (32,886 bytes); photo size comes from the immutable SVG data URI. *Modified* comes from the source block/timestamp. The left web-view panel shows the CD-R art, then a thumbnail and facts for the selected track.
- **CDINFO.TXT:** label, tracks, seasons, storm/finale, burn block and time, burner (the `CDBurned` log at the Labs mint block, one single-block query), snapshot pointer, and one line per track.
- **Imaging:** double-clicking either track type opens it full size with Previous/Next, Best Fit/100%/200%, and Properties. Paint tracks report current/recycled frame state; Block Camera tracks report their immutable Labs source/block metadata.
- **Eject:** clears the drive. Wallet-inserted discs are ownership-checked and auto-ejected if they leave the wallet. Public deep-linked discs are read-only and are never treated as owned.

## RPC

Nothing polls. Opening a disc costs the snapshot/Labs reads, one `getCode`, source metadata, one single-block burn-log query, and cached block reads. Paint images come from `frameCompositeData` and are cached in IndexedDB; photo images come from immutable Labs token metadata.
