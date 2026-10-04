# r3OS labs NFT collection

`R3OSLabs` is the single tradeable ERC-721 collection for token-producing Labs. Flipbook reels, Forks, Sleepwalker dreams and mix CD-Rs use it now; future token-producing Labs use the same collection later. The frozen `R3OSPaint` core remains a separate collection, and the Painter Pass remains a separate soulbound collection.

## Collection authority

`R3OSLabs` is `ERC721 + ERC2981 + Ownable2Step`, named `r3OS labs` with symbol `R3OSLABS`.

The collection owner exists only for marketplace administration. Its only application-level setter is `setExternalLink(string)`, which emits ERC-7572 `ContractURIUpdated()`. It cannot authorize a Lab, mint, transfer, burn, change token rendering or change royalties.

Royalties are fixed forever at 5% (500 bps) to immutable `ROYALTY_RECEIVER`.

## Mint authorization and binding

A Lab calls `mint(to, experimentId)`. The collection reads the frozen core registry and accepts the call only when `experimentInfo(experimentId).experiment == msg.sender` and the entry is not retired. Token IDs share one global sequence starting at 1; `totalMinted()` returns the highest id minted so far (burned ids stay as gaps), so a client can scan `ownerOf(1..totalMinted())`.

Flipbook, Forks, Sleepwalker and the CD Burner use a two-step deployment that avoids predicting registry IDs:

1. deploy the Lab with the shared `R3OSLabs` address;
2. add the Lab to the core registry;
3. call its permissionless one-time `bindExperimentId(id)`.

Binding succeeds only when that registry ID points back to the calling Lab and is active. It grants no admin authority and cannot be changed later.

At mint the shared collection freezes the source Lab, experiment ID, Monad block, block coinbase, current season, storm state and holder-at-mint state. Retirement blocks future mints but does not affect existing metadata.

## Source interface

Every token-producing Lab implements `ILabTokenSource`:

```solidity
function labToken(uint256 tokenId) external view returns (
    string memory kind,
    string memory description,
    bytes memory imageSvg,
    string memory attributes,
    uint8 dominantColour,
    uint8 coloursUsed
);

function canBurn(uint256 tokenId) external view returns (bool);
```

`attributes` is empty or begins with a comma. `R3OSLabs` builds the common JSON itself. A source whose immutable token name needs more than the standard kind/id form may also implement the optional `ILabTokenNameSource.labTokenName(tokenId)` hook; the collection gas-caps that call and falls back to its standard name when the hook is absent or fails. The source call is gas-capped; if it reverts or exhausts the cap, the collection still returns valid metadata with common traits and an onchain placeholder image.

Burning is owner-only and also requires the source Lab to return `true` from `canBurn`. Flipbook reels and Forks remain non-burnable, matching their pre-migration behavior. Mix CD-R artifacts are non-burnable, matching immutable reels and forks. The source Paint frames remain separate and may still be transferred or recycled normally.

Labs with live metadata call `notifyMetadataUpdate(tokenId)` so the collection emits ERC-4906 `MetadataUpdate` from the ERC-721 contract marketplaces index.

## Common traits

Every Labs token has these traits in this order:

| Trait | Format |
|---|---|
| Type | Reel · Fork · Dream · CD |
| Lab | title-cased registry name |
| Season | 1-based number |
| Monad block | mint block number |
| Storm | yes · no |
| Holder at mint | yes · no |
| Sealed by | checksummed mint-block coinbase |
| Dominant colour | canonical palette name (reels: of the final frame) |
| Colours used | number |
| Palette | Mono · Few · Rich · Full |

Palette names, by index, are: background, black, trippie brown, old man olive, juicy red, gold, og pink, white, green, nad magenta, purple, DF1 cyan, BTC orange, waifu pink, pill purple and emoji orange.

Palette buckets:

- Mono: 1–2 colours. A source failure reports 0 colours and also falls back to Mono.
- Few: 3–5.
- Rich: 6–10.
- Full: 11+.

## Reel traits

| Trait | Format / bucket |
|---|---|
| Frames | number |
| Length | Short: 8–11 · Medium: 12–19 · Long: 20–27 · Epic: 28–32 |
| Duration ms | number |
| Tempo | Real-time: ≤400 ms/frame · Smooth: 401–1,000 · Steady: 1,001–5,000 · Slow: >5,000 |
| Longest hold ms | number |
| Blocks spanned | number |
| First frame | number |
| Last frame | number |
| First block | number |
| Last block | number |
| Validators | number |
| Validator mix | Single: 1 · Few: 2–4 · Many: 5+ |
| Pixels painted | number |
| Busiest frame painters | number |
| Storm frames | number |

**Intentionally omitted in this phase:** Reel `Painters` and Reel `Crowd`. Existing immutable reel snapshots record a painter count for each frame but not painter identities, so an exact distinct-wallet count across the whole reel cannot be reconstructed. Adding exact identities would exceed the phase rule that missing traits may add at most one cheap storage write per paint. No approximate marketplace trait is emitted.

## Fork traits

| Trait | Format / bucket |
|---|---|
| State | Open · Closed · Sealed, live |
| Depth | number, 1 for a frame fork |
| Lineage | Original: depth 1 · Remix: depth 2 · Deep remix: depth 3+ |
| Source frame | number |
| Source season | 1-based number |
| Parent fork | number, omitted for Originals |
| From storm frame | yes · no |
| From finale | yes · no |
| Painters | number |
| Crowd | Solo: 0–1 · Duo: 2 · Group: 3–9 · Crowd: 10+ |
| Paints | number |
| Activity | Untouched: 0 · Light: 1–9 · Worked: 10–99 · Busy: 100+ |
| Times forked | number, live |
| Forked | yes · no, live |
| Created block | number |
| Sealed block | number, only once sealed |

Fork metadata refreshes after paint, open/close, seal and creation of a child fork.

## Dream traits

Sleepwalker implements these through the same `ILabTokenSource` interface. See `SLEEPWALKER.md` for session, allowance, survival-sampling and minting rules:

| Trait | Format / bucket |
|---|---|
| Pixels dreamt | number |
| Size | Nap: <256 · Dream: 256–1,023 · Epic dream: 1,024+ |
| Nights | number of sessions used |
| Steps | number |
| Helpers | number of distinct step callers |
| Night shift | Alone: only owner · Helped: 2–5 · Crowd: 6+ |
| Complete | yes · no |
| Dreaming days | owner total at mint |
| Survived at mint | Intact: ≥90% · Scarred: 50–89% · Ghost: <50% |

`Survived at mint` samples up to 128 evenly spaced stencil pixels through `core.pixelAt` at mint, as specified by the Sleepwalker phase.

## CD traits

Mix CD-Rs snapshot 1–12 owned Paint frames at mint. Source frames are not burned or transferred, and the CD renders only from its compact immutable snapshot. See `CD_BURNER.md`.

| Trait | Format / bucket |
|---|---|
| Tracks | number |
| Format | Single: 1 · EP: 2–4 · Album: 5–8 · Full length: 9–12 |
| Seasons | number of distinct source seasons |
| Mix | Single season · Multi season |
| Storm tracks | number |
| Has finale | yes · no |
| Oldest track | lowest source frame id |
| Disc colours | number of colours in the CD's `discMask` |
| Disc | Silver: 0 · Mono: 1 · Duo: 2 · Prism: 3–6 · Rainbow: 7–10 |

For CDs, the common `Dominant colour` and `Colours used` traits are computed from the 32 × 32 mint-time samples across every track after palette index 0 is resolved to that track's background colour.

The image is a deterministic 64 × 64 pixel CD-R enlarged to 512 × 512. Its brushed-silver disc, rainbow fan and glints are generated fully onchain by `CDArt`; only the eligible per-track disc colours tint the fan, so a CD with no eligible colours is plain silver.

## Names and URLs

Names are `r3OS labs reel #N`, `r3OS labs fork #N`, `r3OS labs dream #N`, and `r3OS labs cd #N: <label>`. The CD name comes from the optional source-name hook; all other existing Labs continue to use the collection default.

When the collection external link is non-empty, each token includes `external_url` as `<link>/#/labs?token=<id>` (without duplicating the slash when the configured link already ends in `/`).

## Contract metadata

`contractURI()` follows ERC-7572 and returns fully onchain JSON with collection name, description covering reels/forks/dreams/mix CD-Rs, a black-and-white `r3OS labs` SVG wordmark with one DF1-cyan accent, external link, 500 seller-fee basis points and the immutable royalty receiver.
