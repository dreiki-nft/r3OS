# r3OS Labs NFT collection

`R3OSLabs` is the single tradeable ERC-721 collection for active r3OS Lab artifacts. Fresh mainnet currently uses it for **CD-Rs** and **Block Camera portraits**. Paint frames remain in the separate `R3OSPaint` collection and Painter Pass remains a separate soulbound collection.

Discontinued token-producing experiments are omitted from the current mainnet source/deployment graph. Historical testnet tokens remain governed by their deployed contracts; Git history is the archive for retired implementations.

## Collection authority

`R3OSLabs` is `ERC721 + ERC2981 + Ownable2Step`, named `r3OS labs` with symbol `R3OSLABS`.

The collection owner exists only for marketplace administration. Its application-level setter is `setExternalLink(string)`, which emits ERC-7572 `ContractURIUpdated()`. It cannot authorize a Lab, mint, transfer, burn, replace token rendering or change royalties.

Royalties are fixed at 5% (500 bps) to immutable `ROYALTY_RECEIVER`.

## Mint authorization and binding

A token source calls `mint(to, experimentId)`. Labs reads Paint's registry and accepts the mint only when `experimentInfo(experimentId).experiment == msg.sender` and the entry is active. Token ids share one global sequence from 1. Burned ids remain gaps.

Active token sources use the same deployment pattern:

1. deploy the source with the shared Labs address;
2. register it in Paint;
3. call its one-time `bindExperimentId(id)` when that source requires binding.

Binding validates that the active registry id points back to the source. It grants no Paint authority and cannot later be redirected.

At mint, Labs freezes source address, experiment id, Monad block, `block.coinbase`, Paint season, storm state and holder-at-mint state. Registry retirement blocks future source mints but does not alter existing token metadata.

## Source interface

Token-producing contracts implement `ILabTokenSource`:

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

Sources that need custom immutable names may implement `ILabTokenNameSource.labTokenName(tokenId)`. Both source hooks are gas-capped. If a source reverts, burns gas or returns malformed data, Labs still produces valid fallback metadata rather than letting one add-on brick the collection renderer.

Burning requires token ownership **and** source approval through `canBurn`. Current CD and Block Camera artifacts are immutable/non-burnable. Paint frames use their own separate recycling rules.

Sources with intentionally live metadata can call `notifyMetadataUpdate(tokenId)` so the collection emits ERC-4906 `MetadataUpdate`.

## Common traits

Every Labs token begins with common mint/provenance traits:

| Trait | Meaning |
|---|---|
| Type | source-defined artifact type (`CD`, `block portrait`, …) |
| Lab | title-cased registry name |
| Season | 1-based Paint season at mint |
| Monad block | mint block |
| Storm | whether mint block is inside a Paint storm |
| Holder at mint | whether minter held the primary collection at mint |
| Sealed by | checksummed mint-block `block.coinbase` value |
| Dominant colour | canonical palette name |
| Colours used | source-reported count |
| Palette | Mono / Few / Rich / Full bucket |

`Sealed by` records the mint block's `block.coinbase` value as provenance only; it is not presented as a cryptographic validator-identity guarantee.

## CD traits

CD Burner adds track count, format, season mix, storm/finale data, source composition, oldest frame where applicable, disc colour count and disc bucket. Mixed CDs can contain Paint frames and Block Camera portraits; source NFTs are not transferred or destroyed. The optional token-name hook produces `r3OS labs cd #N: <label>`.

See [`CD_BURNER.md`](CD_BURNER.md).

## Block Camera traits

Block Camera uses kind `block portrait` and adds inclusion block, timestamp, epoch, epoch-delay state, proposer field, parent-hash fragment, Paint season, capturer and staking-device availability. CARD.DRV captures add immutable card page hash/write-count commitments and optionally a Paint canvas hash.

See [`MONAD_HW.md`](MONAD_HW.md) and [`MONAD_CARD.md`](MONAD_CARD.md).

## Names and URLs

The shared collection uses source-provided kind/name data while keeping the collection identity `r3OS labs`. `external_url` points back into the r3OS Labs/Frames view using the token id. User/source strings are JSON-escaped by the collection and rendered by the frontend as data, not executable HTML.

## Contract metadata

`contractURI()` returns onchain JSON with the collection name, description, external link, royalty basis points and immutable fee recipient. `setExternalLink` is the only marketplace metadata control owned by the collection owner.
