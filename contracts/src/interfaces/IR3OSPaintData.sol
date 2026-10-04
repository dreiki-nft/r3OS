// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IR3OSPaintData {
    struct ExperimentData {
        address experiment;
        string name;
        string uri;
        bool retired;
    }

    struct FrameInfoData {
        address minter;
        address proposer;
        address dataPointer;
        uint48 blockNumber;
        uint32 season;
        uint48 seasonFrameIndex;
        uint48 frameNumber;
        uint48 paintsSincePreviousFrame;
        uint16 df1Amount;
        uint8 faceColor;
        uint8 backgroundColor;
        bool holderAtMint;
        bool finale;
    }

    function currentSeason() external view returns (uint256);
    function frameData(uint256 tokenId) external view returns (bytes memory);
    function frameData128(uint256 tokenId) external view returns (bytes memory);
    function frameCompositeData(uint256 tokenId) external view returns (bytes memory);
    function frameInfo(uint256 tokenId) external view returns (FrameInfoData memory);
    function seasonFrameToken(uint256 season, uint48 seasonFrameIndex) external view returns (uint256);
    function genesisFrameData(uint256 season) external view returns (bytes memory);
    function df1Seed(uint256 tokenId) external view returns (uint32);
    function isR3tardHolder(address account) external view returns (bool);
    function isSessionKey(address key) external view returns (bool);
    function isActiveSessionKey(address key) external view returns (bool);
    function sessionInfo(address key) external view returns (
        address owner, uint256 expiryBlock, uint256 maxUnits, uint256 unitsSpent, bool revoked, bool active
    );

    function seasonOutlineRuns(uint256 season) external view returns (bytes memory);

    function rendererCount() external view returns (uint256);
    function rendererInfo(uint256 rendererId) external view returns (address renderer, string memory name);
    function tokenRenderer(uint256 tokenId) external view returns (uint256);
    function experimentCount() external view returns (uint256);
    function experimentInfo(uint256 experimentId) external view returns (ExperimentData memory);
    function hasCustomOutline(uint256 season) external view returns (bool);
    function seasonGuest(uint256 season) external view returns (string memory);
    function outlineBaseSlot(uint256 season) external view returns (uint256);

    function daysPainted(address painter) external view returns (uint32);

    function painterStats(address painter) external view returns (
        uint32 activeDays,
        uint32 pixelsToday,
        uint96 totalPixelsPainted,
        uint48 framesMinted,
        uint48 firstPaintBlock,
        uint48 lastPaintBlock,
        uint64 paintCount,
        uint64 paintNonce,
        uint64 sessionPaints,
        uint64 stormPaints
    );

    function seasonInfo(uint256 season) external view returns (
        uint256 startsAt,
        uint256 endsAt,
        uint8 face,
        uint8 background,
        uint64 regularFrames,
        bool finaleMinted,
        uint256 finaleTokenId,
        uint256 successfulPaints
    );

    function budgetOf(address owner, uint256[] calldata ids) external view returns (
        uint256 hourlyAvailable,
        uint256 holderAvailable,
        uint256 totalAvailable,
        uint256 hourlyLimit,
        uint32 activeDays
    );

    function tileState(uint256 season, uint16 tile)
        external
        view
        returns (uint64 epoch, uint32 heat, uint256 wetBitmap);

    function regionState(uint256 season, uint8 region) external view returns (
        uint64 capBlock,
        uint32 pixelsInBlock,
        uint64 totalPaints,
        uint64 changeCounter,
        uint64 primaryPaints,
        uint256 pressure
    );
    function regionWords(uint256 season, uint8 region) external view returns (uint256[64] memory);
    function regionBlankMask(uint256 season, uint8 region) external view returns (uint64[64] memory);
    function isStorm(uint256 blockNumber) external pure returns (bool);
    function nextStormStart() external view returns (uint256);

    function getBackgroundCanvas() external view returns (bytes memory);
    function getBackgroundCanvas(uint256 season) external view returns (bytes memory);
    function getCanvas(uint256 season) external view returns (bytes memory);
    function faceColor(uint256 season) external view returns (uint8);
    function backgroundColor(uint256 season) external view returns (uint8);
    function palette() external pure returns (uint24[16] memory);
}
