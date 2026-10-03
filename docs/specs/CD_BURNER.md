# Burn a CD

`R3tardsCDBurner` turns 1–12 owned Paint frames and/or Block Camera photos into one immutable mix CD-R NFT in the shared `R3tardsLabs` collection. "Burn" means burning a disc, not burning source ERC-721s: every source stays with its owner unless it is later transferred or recycled separately.

## Minting

`burnCD(frameIds, label)` remains the legacy frame-only main-wallet action and writes snapshot v2. `burnMixedCD(trackIds, trackKinds, label)` writes snapshot v3; kind `0` is a Paint frame and kind `1` is a Block Camera Labs token. Active core session keys are rejected.

Rules:

- 1–12 tracks;
- no duplicate `(kind, id)` tracks;
- Paint token #0 is not a track;
- finales are valid Paint tracks;
- the caller must own every source at mint;
- photo tracks must come from the registered `block-camera` experiment; a random Labs portrait cannot impersonate one;
- the label is 1–24 characters;
- allowed label characters are `a-z`, `0-9`, space, `! ? . , ' & - #`;
- `A-Z` is accepted and folded to lowercase before storage.

The Lab is registered in the frozen core registry as `cd-burner`, bound once to that experiment id, and mints through `R3tardsLabs.mint`.

## Immutable snapshot

The snapshot is one compact SSTORE2-style `FrameStore` blob. Legacy v2 discs are unchanged. Mixed v3 discs keep the same 80-byte header and 38-byte track records, reserve flag bit `0x04` for Block Camera tracks, and use header bytes 74/75 for frame/photo counts. A CD never needs source ownership again after mint.

The header stores:

- normalized label and track count;
- `discMask`;
- dominant colour and colours used;
- distinct season count, minimum season and maximum season;
- storm-track count and whether any track is a finale;
- oldest source frame id (0 for photo-only v3 discs);
- v3 only: Paint-frame count and Block-photo count.

Each track stores only:

- source token id;
- season;
- flags: storm, finale, and (v3) Block Camera source;
- one colour-pair byte: `(first << 4) | second`, where a zero nibble means no eligible disc colour.

No thumbnail pixels are stored.

## Colour sampling

Paint-frame minting samples the same 32 × 32 grid as the first CD implementation: the top-left pixel of every 8 × 8 block of the frame's 256 × 256 `frameData`. `frameData` is 4bpp and BMP bottom-up, so sampled rows are read in reverse storage order. Palette index 0 is resolved to that frame's background colour before counting.

Counts use one packed `uint256`: 16 lanes of 16 bits, one lane per palette index. Across at most 12 tracks every lane stays below 65,536, so packed addition cannot carry into a neighbouring colour.

The disc may use only palette indices `4, 5, 6, 8, 9, 10, 11, 12, 13, 14`, represented by mask `0x7f70`. Black, white, trippie brown, old man olive and emoji orange never tint the disc.

For each track, the contract keeps the two eligible disc colours with the highest sample counts. Ties go to the lower palette index. Those one or two bits are ORed into the CD-level `discMask`. A track containing only excluded colours contributes no disc colour. A CD whose tracks contribute none is intentionally plain silver.

Block Camera exposes `cdTrackData(tokenId)`, a read-only compact summary of the exact immutable 32 × 32 portrait (including CARD.DRV hash pixels when present). The burner verifies the Labs owner/source/experiment before accepting it. The common Labs `Dominant colour` and `Colours used` traits come from all frame samples and photo pixels, including colours excluded from the disc tint.

After each source `frameData` is sampled, the temporary 32 KB return buffer is discarded by restoring the free-memory pointer. Only the compact counts and snapshot fields survive to the next track.

## Onchain image

`CDArt.sol` is an exact Solidity port of `scripts/cd-art-reference.mjs`.

It renders a 64 × 64 top-down RGB pixel CD-R and passes that raster to `BmpN.encode(raster, 64)`. The BMP is displayed at 512 × 512 with nearest-neighbour pixels. The image has:

- cream background for Single/EP CDs, grey for Albums, teal for Full lengths;
- a silver disc with clear hub and centre hole;
- brushed-silver bands;
- a deterministic rainbow fan made only from `discMask` colours;
- deterministic white glints;
- a one-pixel-style border;
- the normalized label under the disc;
- `cd-r · N track(s) · <format>` and the zero-padded Labs token id beneath it.

The seed preserves mint order. Legacy v2 uses the original frame ids unchanged. For v3 art only, Block Camera ids set bit 255 before hashing so a frame id and photo id with the same number cannot collide as an art seed; stored source ids remain untouched. Only `&` needs escaping in the label and becomes `&amp;`.

The reference's integer operation order, Q12 rounding, HSV interpolation, angle approximation and pixel geometry are consensus for the art. `CDArt.t.sol` locks all six reference vectors by hashing both the raw raster and the final SVG.

## Metadata

Name:

`r3tards labs cd #<id>: <label>`

Description is the legacy frame-only sentence for v2/frame-only discs; mixed v3 discs say they contain Paint frames and Block Camera photos. V3 metadata also reports `Paint frames` and `Block photos`.

CD-specific traits follow the common Labs traits:

| Trait | Value |
|---|---|
| Type | CD |
| Tracks | track count |
| Format | Single: 1 · EP: 2–4 · Album: 5–8 · Full length: 9–12 |
| Seasons | number of distinct source seasons |
| Mix | Single season · Multi season |
| Storm tracks | number |
| Has finale | yes · no |
| Oldest track | v2 only: lowest source frame id |
| Oldest frame | v3 only when at least one frame is present |
| Paint frames | v3 frame count |
| Block photos | v3 photo count |
| Disc colours | popcount of `discMask` |
| Disc | Silver: 0 · Mono: 1 · Duo: 2 · Prism: 3–6 · Rainbow: 7–10 |

## Burning the Labs token

CD artifacts are non-burnable through `R3tardsLabs.burn`. Source Paint frames and Block Camera Labs NFTs remain independent and may still be transferred normally; Paint frames may still be recycled independently.

## Gas

Regression targets:

- 12-track legacy `burnCD`: at or below 3.5M gas (measured 3.1M);
- `burnMixedCD`: measure on the snapshot-28 testnet deployment before mainnet; do not inherit the legacy gas number;
- 12-track Labs `tokenURI`: at or below 9M gas (measured 8.3M; the raster renders one half of the point-symmetric disc and mirrors the other).

The frontend uses the standard non-paint transaction path: estimate, add 10%, show max cost, then send the quoted gas and fee fields.
