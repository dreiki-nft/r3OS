// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Base64} from "solady/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {FrameStore} from "./lib/FrameStore.sol";
import {IFrameRenderer} from "./interfaces/IFrameRenderer.sol";

interface IR3tardsCollection {
    function ownerOf(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
}

interface IR3tardsPainterPassLink {
    function PAINT() external view returns (address);
    function passOf(address owner) external view returns (uint256);
}

/// @title r3tards paint v2
/// @notice Shared 256x256 fully-onchain paint canvas and immutable frame NFTs.
/// @dev Token #0 is the transferable live canvas. Regular frames are transferable/burnable.
contract R3tardsPaint is ERC721, ERC2981, Ownable2Step, EIP712 {
    using Strings for uint256;

    uint256 public constant WIDTH = 256;
    uint256 public constant HEIGHT = 256;
    uint256 public constant PALETTE_SIZE = 16;
    uint256 public constant PIXELS_PER_SLOT = 64;
    uint256 public constant CANVAS_SLOT_COUNT = 1_024;
    uint256 public constant CANVAS_BYTE_LENGTH = 32_768;
    uint256 public constant SEASON_LENGTH = 30 days;
    uint256 public constant WET_WINDOW_BLOCKS = 2_000;
    uint256 public constant TILE_COOLDOWN_PER_BLOCK = 2;
    uint256 public constant MAX_TILE_HEAT = 512;
    uint256 public constant MAX_PIXELS_PER_REGION_PER_BLOCK = 512;
    uint256 public constant DF1_WINDOW_BLOCKS = 10;
    uint256 public constant DF1_OUTLIER_RATE = 9_919_410_150_891_633;
    uint256 private constant DF1_RATE_DENOMINATOR = 1e20; // 1e18 * 100 percent
    uint256 public constant FACE_FLIP_COOLDOWN_BLOCKS = 100;
    uint256 public constant BACKGROUND_COOLDOWN_BLOCKS = 1_000;
    uint256 public constant FRAME_COOLDOWN_BLOCKS = 200;
    uint256 public constant MAX_RAW_PIXELS_PER_PAINT = 65_536;
    uint256 public constant MAX_OUTLINE_CHUNK_BYTES = 12_000;
    uint256 public constant MAX_SESSION_BLOCKS = 24_000;
    uint256 public constant RENDERER_GAS_LIMIT = 14_000_000;
    uint256 public constant MAX_TIMELAPSE_FRAMES = 4;
    uint256 public constant STORM_PERIOD_BLOCKS = 200_000;
    uint256 public constant STORM_LENGTH_BLOCKS = 600;

    bytes32 public constant SESSION_TYPEHASH = keccak256(
        "StartSession(address owner,address sessionKey,uint256 expiryBlock,uint256 maxUnits,uint256 nonce,uint256 deadline)"
    );

    uint8 public constant FACE_BLACK = 1;
    uint8 public constant FACE_WHITE = 7;
    uint16 public constant ROYALTY_BPS = 500;

    // Canvas is 8 MIP-8 pages. Per-region state gets one aligned page per region.
    /// @notice Permanent genesis r3tard outline used by seasons without a custom guest.
    uint256 public constant OUTLINE_BASE_SLOT =
        uint256(keccak256("r3tards.paint.outline")) & ~uint256(127);

    // Region-page slot layout. 16 tiles per 64x64 region.
    uint256 private constant TILE_META_OFFSET = 0;       // +0..15
    uint256 private constant TILE_CURRENT_OFFSET = 16;   // +16..31
    uint256 private constant TILE_PREVIOUS_OFFSET = 32;  // +32..47
    uint256 private constant REGION_SUMMARY_OFFSET = 48;
    uint256 private constant REGION_LAST_OWNER_OFFSET = 49;
    uint256 private constant REGION_RING_OFFSET = 50;    // +50..59
    uint256 private constant REGION_NONZERO_WORDS_OFFSET = 60; // uint64 row mask for this region

    // Nibble helpers.
    uint256 private constant NIBBLE_LSB =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    bytes private constant _OUTLINE_RUNS = hex"5a70735b6d775c69795d5c7a5e587b5f55705f747c60546d60777d61526961787e62505b62797f634f58637b80644e56647b81654d54657c82664d52667d8166929f674c51677e816790a3684c50685364688ea9694b6a698dba6a4b6d6a8cbd6b4a706b8b926b9fbf6c49726c8a906ca3c06d47536d64736d898f6d91946da9c26e464e6e6a756e899a6ebac36f45536f6d766f889e6fbdc47044597070777088a270bec471435e7171787187a571c0c3723e617273797287907294a9733c6473747a73868d739aae743b4a74546874757b74858b749eb4753a4b75596b75767c75858a75a2bb763a4c76596e76777c76848976a5c177393e77474c77587177787d77848877a9c578393d78484c78587478797d78838878aec779383d79484d79587779797e79838779b5c97a383c7a494d7a587e7a82877a90987abbca7b383c7b494d7b586c7b6e7e7b82867b89a17bc2cb7c373c7c494e7c586c7c717e7c82a87cbbcd7d373b7d4a4f7d586c7d747e7d82ce7e373b7e4a517e586b7e777e7e82cf7f373b7f4b6b7f797e7f82d080383c804c6a807a7e8082898090d081383d814d6a81797e818286818fa481a8bb81c6d1823840824e6982797d828286828fa582c5d2833942835159835c6883787d838286838fa583c3d2843943845e6984787d848287848fa584c2ca84ced3853a4485606f85777c858387858ea585c1c885cfd4863d4586617c868387868fa586bfc786d0d4873e4587637f878387878fa487bec587d0d5883d46886681888387888fa488bcc488d1d5893b46896987898da389bbc389d1d68a3a478a6fa38ab9c18ad2d68b39408b43488b7ca78bb7c08bd2d68c383f8c43498c7fab8cb4be8cc8c98cd2d68d373d8d444a8d81948d9abd8dc7cb8dd2d68e373c8e454b8e848d8ea0bb8ec7cb8ed2d68f363b8f464c8fa3b98fc6cb8fd1d690363a90474e90a7b790c4ca90d1d591353a91485391abb491c3c991d0d592353992496492c0c992cfd4933539934a6993bdc893cfd4943539944c6c94bbc694cfd3953539954f6e95b9c595ced296353996537096b7c396ced297353997657297b5c097ced298353998697598b4bd98ced2993539996c77998f9999b3bb99ced29a35399a6e7a9a8c9d9ab2b99aced29b353a9b70809b879f9bb0b79bced29c363b9c72a19cafb69ccdd29d363d9d75a39dadb59dcdd19e373f9e778f9e99a79eaab39ecdd19f38409f7b8c9f9db29fccd1a03941a08187a09fb1a0cbd1a13b41a1a1afa1cad0a23d42a2a3aea2c8cfa33e42a3a8a9a3c6cfa43e43a4c3cda53f43a5c1cca63f43a6bfcaa73f44a7bdc8a84044a8bcc6a94044a9a1a2a9bbc3aa4045aa666daa9da7aabac1ab4146ab626fab9bababb9bfac4146ac5f70ac9aacacb8bead4247ad5d71ad98aeadb7bdae4249ae5b72ae96a0aea3bcaf434daf5865af6d73af949dafa7bbb04462b06e74b0929cb0aabab1455fb16f74b18f9ab1acb9b2475db27075b28c98b2aeb7b34a5bb37176b38896b3b3b4b44e58b47178b48494b57292b6738fb7748cb87688b97783";

    IR3tardsCollection public immutable R3TARDS;
    uint64 public immutable SEASON_START;
    uint32 public immutable BASE_PIXELS_PER_HOUR;
    uint32 public immutable PIXELS_PER_ACTIVE_DAY;
    uint32 public immutable MAX_PIXELS_PER_HOUR;
    uint32 public immutable MIN_PIXELS_FOR_ACTIVE_DAY;
    uint32 public immutable HOLDER_PIXELS_PER_DAY;
    address public immutable ROYALTY_RECEIVER;

    struct PainterData {
        uint48 hourBucket;
        uint32 unitsThisHour;
        uint48 dayBucket;
        uint32 pixelsToday;
        uint32 activeDays;
        bool dayCredited;
        uint48 firstPaintBlock;
        uint48 lastPaintBlock;
        uint64 paintCount;
        uint96 totalPixelsPainted;
        uint48 framesMinted;
        uint48 lastFrameBlock;
        uint64 lastFramePaintCount;
        uint48 lastPaintDayBucket;
        uint32 daysPainted;
        uint64 sessionPaints;
        uint64 stormPaints;
    }

    struct TokenQuota {
        uint48 dayBucket;
        uint16 spent;
    }

    struct SeasonStateData {
        uint8 faceEncoded; // 0 => genesis black; otherwise color + 1
        uint8 backgroundColor;
        uint48 lastFaceBlock;
        uint48 lastBackgroundBlock;
        uint48 styleVersion;
        uint48 regularFrameCount;
        uint48 lastFramePrimaryPaintTotal;
        bytes32 lastFrameFingerprint;
        bool finaleMinted;
        uint256 finaleTokenId;
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

    struct SeasonOutlineData {
        bool custom;
        uint32 totalRunBytes;
        string guestName;
        address[] runChunks;
    }


    struct SessionData {
        address owner;
        uint48 expiryBlock;
        uint96 maxUnits;
        uint96 unitsSpent;
        bool revoked;
    }

    struct RendererData {
        address renderer;
        string name;
    }

    struct ExperimentData {
        address experiment;
        string name;
        string uri;
        bool retired;
    }

    struct TileScratch {
        uint16 tile;
        uint64 epoch;
        uint48 lastHeatBlock;
        uint16 heat;
        uint256 currentBits;
        uint256 previousBits;
        bool metaDirty;
        bool currentDirty;
        bool previousDirty;
    }

    struct PaintScratch {
        bytes tileIndex; // tile => scratch index (presence tracked separately)
        uint256 loadedTiles;
        TileScratch[] tiles;
        uint16 tileCount;
        uint32[16] regionWrites;
        uint16 regionsMask;
        uint32 units;
        uint32 pixelsWritten;
        uint256[] runWriteMasks;
        uint32[] runPrefix;
        uint64[16] nonzeroWordSet;
        uint64[16] nonzeroWordClear;
    }

    mapping(address painter => PainterData) private _painters;
    mapping(uint256 tokenId => TokenQuota) private _holderQuota;
    mapping(uint256 season => SeasonStateData) private _seasons;
    mapping(uint256 tokenId => FrameInfoData) private _frames;
    mapping(uint256 season => mapping(uint48 seasonFrameIndex => uint256 tokenId)) private _seasonFrameToken;
    mapping(uint256 season => SeasonOutlineData) private _seasonOutlines;
    mapping(uint256 => uint256[4]) private _customOutlineWordBitmap;
    mapping(address sessionKey => SessionData) private _sessions;
    mapping(address owner => uint256 nonce) public sessionNonces;
    RendererData[] private _renderers;
    mapping(uint256 tokenId => uint256 rendererId) private _tokenRenderer;
    bool public renderersFrozen;
    address public painterPass;
    ExperimentData[] private _experiments;
    uint256[4] private _defaultOutlineWordBitmap;

    uint256 private _nextTokenId = 1;
    uint256 public totalFrames;

    error UnsupportedChain(uint256 chainId);
    error ZeroAddress();
    error InvalidConfig();
    error NotOpenYet();
    error InvalidPatchLength();
    error InvalidRun(uint256 runIndex, uint256 y, uint256 xStart, uint256 xEnd);
    error InvalidColor(uint256 runIndex, uint256 colorIndex);
    error InvalidFaceColor(uint256 color);
    error InvalidBackgroundColor(uint256 color);
    error TooManyPixelWrites(uint256 requested, uint256 maximum);
    error EmptyPatch();
    error NoChange();
    error DuplicateR3tardId(uint256 tokenId);
    error NotR3tardOwner(uint256 tokenId, address expectedOwner);
    error InsufficientBudget(uint256 needed, uint256 available);
    error TileTooHot(uint256 tile);
    error RegionBusy(uint256 region);
    error InvalidRegion(uint256 region);
    error CooldownActive(uint256 untilBlock);
    error SeasonNotEnded(uint256 season);
    error SeasonFinaleAlreadyMinted(uint256 season);
    error SeasonHasNoPaint(uint256 season);
    error FramePaintRequired();
    error CanvasUnchanged();
    error NonBurnableToken(uint256 tokenId);
    error NotAuthorized();
    error PixelOutOfBounds(uint256 x, uint256 y);
    error PaletteIndexOutOfBounds(uint256 index);
    error FrameDoesNotExist(uint256 tokenId);
    error SeasonOutlineLocked(uint256 season);
    error NoCustomOutline(uint256 season);
    error InvalidOutlineRunsLength();
    error InvalidOutlineRun(uint256 runIndex, uint256 y, uint256 xStart, uint256 xEnd);
    error OutlineChunkTooLarge(uint256 length, uint256 maximum);
    error GuestNameTooLong(uint256 length);
    error InvalidGuestCharacter(uint256 index, uint8 character);
    error InvalidSessionKey();
    error SessionExpired();
    error SessionIsRevoked();
    error SessionDurationTooLong();
    error SessionDeadlineExpired();
    error InvalidSessionNonce(uint256 expected, uint256 supplied);
    error InvalidSessionSignature();
    error SessionUnitsExceeded(uint256 needed, uint256 available);
    error SessionKeyPaintOnly();
    error SessionKeyHasOwnerHistory();
    error SessionKeyHasPainterPass();
    error SessionKeyInUse(address owner);
    error PainterPassAlreadySet();
    error InvalidPainterPass();
    error RendererFrozen();
    error InvalidRenderer(uint256 rendererId);
    error RendererNameEmpty();
    error NotTokenHolder(uint256 tokenId);
    error ExperimentNotFound(uint256 experimentId);

    event Painted(
        uint256 indexed season,
        address indexed owner,
        address indexed sender,
        bytes runs,
        bytes corruptions,
        uint32 unitsSpent,
        uint16 regionsMask
    );
    event FaceChanged(uint256 indexed season, uint8 color, address indexed owner);
    event BackgroundChanged(uint256 indexed season, uint8 color, address indexed owner);
    event FrameMinted(uint256 indexed frameId, uint256 indexed season, address indexed minter, uint256 seasonFrameIndex);
    event SeasonFinaleMinted(uint256 indexed season, uint256 indexed tokenId, address indexed recipient);
    event SeasonOutlineSet(uint256 indexed season, string guestName, bytes32 runsHash);
    event SeasonOutlineAppended(uint256 indexed season, bytes32 runsHash);
    event SeasonOutlineCleared(uint256 indexed season);
    event MetadataUpdate(uint256 _tokenId);
    event SessionStarted(address indexed owner, address indexed sessionKey, uint256 expiryBlock, uint256 maxUnits);
    event SessionRevoked(address indexed owner, address indexed sessionKey);
    event PainterPassSet(address indexed painterPass);
    event RendererAdded(uint256 indexed rendererId, address indexed renderer, string name);
    event RenderersFrozen();
    event TokenRendererSet(uint256 indexed tokenId, uint256 indexed rendererId);
    event ExperimentAdded(uint256 indexed experimentId, address indexed experiment, string name, string uri);
    event ExperimentRetired(uint256 indexed experimentId);

    constructor(
        address r3tards,
        uint64 seasonStart,
        address initialTokenZeroRecipient,
        address royaltyReceiver,
        uint32 basePixelsPerHour,
        uint32 pixelsPerActiveDay,
        uint32 maxPixelsPerHour,
        uint32 minPixelsForActiveDay,
        uint32 holderPixelsPerDay
    ) ERC721("r3tards paint", "R3PAINT") Ownable(initialTokenZeroRecipient) EIP712("r3tards paint", "2") {
        if (block.chainid != 143 && block.chainid != 10_143 && block.chainid != 31_337) {
            revert UnsupportedChain(block.chainid);
        }
        if (r3tards == address(0) || initialTokenZeroRecipient == address(0) || royaltyReceiver == address(0)) {
            revert ZeroAddress();
        }
        if (
            basePixelsPerHour > maxPixelsPerHour ||
            maxPixelsPerHour == 0 ||
            minPixelsForActiveDay == 0 ||
            holderPixelsPerDay > type(uint16).max
        ) revert InvalidConfig();

        R3TARDS = IR3tardsCollection(r3tards);
        SEASON_START = seasonStart;
        BASE_PIXELS_PER_HOUR = basePixelsPerHour;
        PIXELS_PER_ACTIVE_DAY = pixelsPerActiveDay;
        MAX_PIXELS_PER_HOUR = maxPixelsPerHour;
        MIN_PIXELS_FOR_ACTIVE_DAY = minPixelsForActiveDay;
        HOLDER_PIXELS_PER_DAY = holderPixelsPerDay;
        ROYALTY_RECEIVER = royaltyReceiver;
        _setDefaultRoyalty(royaltyReceiver, ROYALTY_BPS);
        _seedOutlineNibbleMask();
        _renderers.push(RendererData({renderer: address(0), name: "built-in"}));
        _mint(initialTokenZeroRecipient, 0);
    }

    // ---------------------------------------------------------------------
    // Seasons and aligned storage layout
    // ---------------------------------------------------------------------

    function currentSeason() public view returns (uint256) {
        if (block.timestamp < SEASON_START) return 0;
        return (block.timestamp - SEASON_START) / SEASON_LENGTH;
    }

    function displayedSeason(uint256 season) external pure returns (uint256) { return season + 1; }

    function canvasBaseSlot(uint256 season) public pure returns (uint256) {
        return uint256(keccak256(abi.encode("r3tards.paint.canvas", season))) & ~uint256(127);
    }

    function regionStateBaseSlot(uint256 season) public pure returns (uint256) {
        return uint256(keccak256(abi.encode("r3tards.paint.state", season))) & ~uint256(127);
    }

    function regionPageSlot(uint256 season, uint8 region) public pure returns (uint256) {
        return regionStateBaseSlot(season) + uint256(region) * 128;
    }

    function seasonStartTime(uint256 season) public view returns (uint256) {
        return uint256(SEASON_START) + season * SEASON_LENGTH;
    }

    function seasonEndTime(uint256 season) public view returns (uint256) {
        return seasonStartTime(season) + SEASON_LENGTH;
    }

    function _requireOpen() internal view {
        if (block.timestamp < SEASON_START) revert NotOpenYet();
    }

    // ---------------------------------------------------------------------
    // Future-season collaboration outlines
    // ---------------------------------------------------------------------

    function customOutlineBaseSlot(uint256 season) public pure returns (uint256) {
        return uint256(keccak256(abi.encode("r3tards.paint.outline", season))) & ~uint256(127);
    }

    function outlineBaseSlot(uint256 season) external view returns (uint256) {
        return _outlineBase(season);
    }

    function hasCustomOutline(uint256 season) public view returns (bool) {
        return _seasonOutlines[season].custom;
    }

    function seasonGuest(uint256 season) public view returns (string memory) {
        return _seasonOutlines[season].guestName;
    }

    function seasonOutlineRuns(uint256 season) public view returns (bytes memory runs) {
        SeasonOutlineData storage data = _seasonOutlines[season];
        if (!data.custom) return _OUTLINE_RUNS;

        runs = new bytes(data.totalRunBytes);
        uint256 cursor;
        for (uint256 i; i < data.runChunks.length; ++i) {
            bytes memory chunk = FrameStore.read(data.runChunks[i]);
            _copyBytes(runs, cursor, chunk, 0, chunk.length);
            cursor += chunk.length;
        }
    }

    function setSeasonOutline(uint256 season, bytes calldata outlineRuns, string calldata guestName)
        external
        onlyOwner
    {
        _requireFutureSeason(season);
        _validateGuestName(guestName);
        _validateOutlineRuns(outlineRuns);

        SeasonOutlineData storage data = _seasonOutlines[season];
        _replaceSeasonOutlineRuns(season, outlineRuns);
        delete data.runChunks;
        data.totalRunBytes = 0;
        data.custom = true;
        data.guestName = guestName;

        if (outlineRuns.length != 0) {
            data.runChunks.push(_storeOutlineChunk(outlineRuns));
            data.totalRunBytes = uint32(outlineRuns.length);
        }

        emit SeasonOutlineSet(season, guestName, keccak256(outlineRuns));
    }

    function appendSeasonOutline(uint256 season, bytes calldata moreRuns) external onlyOwner {
        _requireFutureSeason(season);
        SeasonOutlineData storage data = _seasonOutlines[season];
        if (!data.custom) revert NoCustomOutline(season);
        _validateOutlineRuns(moreRuns);
        if (moreRuns.length == 0) {
            emit SeasonOutlineAppended(season, keccak256(moreRuns));
            return;
        }

        uint256 nextTotal = uint256(data.totalRunBytes) + moreRuns.length;
        if (nextTotal > type(uint32).max) revert InvalidOutlineRunsLength();
        data.runChunks.push(_storeOutlineChunk(moreRuns));
        data.totalRunBytes = uint32(nextTotal);
        _orSeasonOutlineRuns(season, moreRuns);
        emit SeasonOutlineAppended(season, keccak256(moreRuns));
    }

    function clearSeasonOutline(uint256 season) external onlyOwner {
        _requireFutureSeason(season);
        SeasonOutlineData storage data = _seasonOutlines[season];
        if (!data.custom) revert NoCustomOutline(season);
        _clearCustomOutlineMask(season);
        delete _seasonOutlines[season];
        emit SeasonOutlineCleared(season);
    }

    function _requireFutureSeason(uint256 season) internal view {
        if (season <= currentSeason() || block.timestamp >= seasonStartTime(season)) {
            revert SeasonOutlineLocked(season);
        }
    }

    function _validateGuestName(string calldata guestName) internal pure {
        bytes memory raw = bytes(guestName);
        if (raw.length > 32) revert GuestNameTooLong(raw.length);
        for (uint256 i; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            if (c < 0x20 || c > 0x7e) revert InvalidGuestCharacter(i, c);
        }
    }

    function _validateOutlineRuns(bytes calldata outlineRuns) internal pure {
        if (outlineRuns.length > MAX_OUTLINE_CHUNK_BYTES) {
            revert OutlineChunkTooLarge(outlineRuns.length, MAX_OUTLINE_CHUNK_BYTES);
        }
        if (outlineRuns.length % 3 != 0) revert InvalidOutlineRunsLength();
        for (uint256 o; o < outlineRuns.length; o += 3) {
            uint256 x0 = uint8(outlineRuns[o + 1]);
            uint256 x1 = uint8(outlineRuns[o + 2]);
            if (x0 > x1) {
                revert InvalidOutlineRun(o / 3, uint8(outlineRuns[o]), x0, x1);
            }
        }
    }

    function _storeOutlineChunk(bytes calldata outlineRuns) internal returns (address pointer) {
        bytes memory init = FrameStore.allocateInit(outlineRuns.length);
        uint256 destination;
        assembly ("memory-safe") {
            destination := add(add(init, 0x20), 15)
            calldatacopy(destination, outlineRuns.offset, outlineRuns.length)
        }
        pointer = FrameStore.writePrepared(init);
    }

    function _replaceSeasonOutlineRuns(uint256 season, bytes calldata outlineRuns) internal {
        uint256[1024] memory words;
        uint256[4] memory nextBitmaps;

        for (uint256 o; o < outlineRuns.length; o += 3) {
            uint256 y = uint8(outlineRuns[o]);
            uint256 x0 = uint8(outlineRuns[o + 1]);
            uint256 x1 = uint8(outlineRuns[o + 2]);
            uint256 first = x0 >> 6;
            uint256 last = x1 >> 6;
            for (uint256 sx = first; sx <= last; ++sx) {
                uint256 startX = sx == first ? x0 : sx * 64;
                uint256 endX = sx == last ? x1 : sx * 64 + 63;
                uint256 slotIndex = y * 4 + sx;
                words[slotIndex] |= _nibbleRangeMask(startX & 63, endX & 63);
                nextBitmaps[slotIndex >> 8] |= uint256(1) << (slotIndex & 255);
            }
        }

        uint256 base = customOutlineBaseSlot(season);
        for (uint256 group; group < 4; ++group) {
            uint256 oldBitmap = _customOutlineWordBitmap[season][group];
            uint256 unionBitmap = oldBitmap | nextBitmaps[group];
            for (uint256 bit; bit < 256; ++bit) {
                if ((unionBitmap & (uint256(1) << bit)) == 0) continue;
                uint256 slotIndex = group * 256 + bit;
                uint256 oldWord = _sload(base + slotIndex);
                uint256 nextWord = words[slotIndex];
                if (oldWord != nextWord) _sstore(base + slotIndex, nextWord);
            }
            if (oldBitmap != nextBitmaps[group]) {
                _customOutlineWordBitmap[season][group] = nextBitmaps[group];
            }
        }
    }

    function _orSeasonOutlineRuns(uint256 season, bytes calldata outlineRuns) internal {
        uint256 base = customOutlineBaseSlot(season);
        uint256[4] memory bitmaps;
        for (uint256 i; i < 4; ++i) bitmaps[i] = _customOutlineWordBitmap[season][i];

        for (uint256 o; o < outlineRuns.length; o += 3) {
            uint256 y = uint8(outlineRuns[o]);
            uint256 x0 = uint8(outlineRuns[o + 1]);
            uint256 x1 = uint8(outlineRuns[o + 2]);
            uint256 first = x0 >> 6;
            uint256 last = x1 >> 6;
            for (uint256 sx = first; sx <= last; ++sx) {
                uint256 startX = sx == first ? x0 : sx * 64;
                uint256 endX = sx == last ? x1 : sx * 64 + 63;
                uint256 slotIndex = y * 4 + sx;
                uint256 slot = base + slotIndex;
                uint256 oldWord = _sload(slot);
                uint256 nextWord = oldWord | _nibbleRangeMask(startX & 63, endX & 63);
                if (nextWord != oldWord) _sstore(slot, nextWord);
                bitmaps[slotIndex >> 8] |= uint256(1) << (slotIndex & 255);
            }
        }

        for (uint256 i; i < 4; ++i) {
            if (_customOutlineWordBitmap[season][i] != bitmaps[i]) {
                _customOutlineWordBitmap[season][i] = bitmaps[i];
            }
        }
    }

    function _clearCustomOutlineMask(uint256 season) internal {
        uint256 base = customOutlineBaseSlot(season);
        for (uint256 group; group < 4; ++group) {
            uint256 bitmap = _customOutlineWordBitmap[season][group];
            if (bitmap == 0) continue;
            for (uint256 bit; bit < 256; ++bit) {
                if ((bitmap & (uint256(1) << bit)) != 0) {
                    _sstore(base + group * 256 + bit, 0);
                }
            }
            _customOutlineWordBitmap[season][group] = 0;
        }
    }

    function _outlineBase(uint256 season) internal view returns (uint256) {
        return _seasonOutlines[season].custom ? customOutlineBaseSlot(season) : OUTLINE_BASE_SLOT;
    }

    function _outlineBitmaps(uint256 season) internal view returns (uint256[4] memory bitmaps) {
        if (_seasonOutlines[season].custom) {
            for (uint256 i; i < 4; ++i) bitmaps[i] = _customOutlineWordBitmap[season][i];
        } else {
            for (uint256 i; i < 4; ++i) bitmaps[i] = _defaultOutlineWordBitmap[i];
        }
    }

    // ---------------------------------------------------------------------
    // Session keys
    // ---------------------------------------------------------------------

    function startSession(
        address owner_,
        address sessionKey,
        uint256 expiryBlock,
        uint256 maxUnits,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external {
        if (owner_ == address(0) || sessionKey == address(0) || sessionKey == owner_ || msg.sender != sessionKey) {
            revert InvalidSessionKey();
        }
        if (_isSessionActive(_sessions[owner_])) revert InvalidSessionKey();
        if (_painters[sessionKey].paintCount != 0) revert SessionKeyHasOwnerHistory();
        address pass = painterPass;
        if (pass != address(0) && IR3tardsPainterPassLink(pass).passOf(sessionKey) != 0) {
            revert SessionKeyHasPainterPass();
        }
        SessionData storage existing = _sessions[sessionKey];
        if (_isSessionActive(existing) && existing.owner != owner_) revert SessionKeyInUse(existing.owner);
        if (block.timestamp > deadline) revert SessionDeadlineExpired();
        if (expiryBlock <= block.number) revert SessionExpired();
        if (expiryBlock > block.number + MAX_SESSION_BLOCKS) revert SessionDurationTooLong();
        if (maxUnits == 0 || maxUnits > type(uint96).max || expiryBlock > type(uint48).max) revert InvalidConfig();
        uint256 expected = sessionNonces[owner_];
        if (nonce != expected) revert InvalidSessionNonce(expected, nonce);

        bytes32 structHash = keccak256(
            abi.encode(SESSION_TYPEHASH, owner_, sessionKey, expiryBlock, maxUnits, nonce, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(owner_, digest, sig)) revert InvalidSessionSignature();

        sessionNonces[owner_] = expected + 1;
        _sessions[sessionKey] = SessionData({
            owner: owner_,
            expiryBlock: uint48(expiryBlock),
            maxUnits: uint96(maxUnits),
            unitsSpent: 0,
            revoked: false
        });
        emit SessionStarted(owner_, sessionKey, expiryBlock, maxUnits);
    }

    function setPainterPass(address pass) external onlyOwner {
        if (painterPass != address(0)) revert PainterPassAlreadySet();
        if (pass == address(0)) revert InvalidPainterPass();
        try IR3tardsPainterPassLink(pass).PAINT() returns (address linkedPaint) {
            if (linkedPaint != address(this)) revert InvalidPainterPass();
        } catch {
            revert InvalidPainterPass();
        }
        painterPass = pass;
        emit PainterPassSet(pass);
    }

    function revokeSession(address sessionKey) external {
        SessionData storage data = _sessions[sessionKey];
        if (data.owner == address(0)) revert InvalidSessionKey();
        if (msg.sender != data.owner) revert NotAuthorized();
        data.revoked = true;
        emit SessionRevoked(msg.sender, sessionKey);
    }

    function sessionInfo(address key) external view returns (
        address owner_,
        uint256 expiryBlock,
        uint256 maxUnits,
        uint256 unitsSpent,
        bool revoked,
        bool active
    ) {
        SessionData storage data = _sessions[key];
        owner_ = data.owner;
        expiryBlock = data.expiryBlock;
        maxUnits = data.maxUnits;
        unitsSpent = data.unitsSpent;
        revoked = data.revoked;
        active = owner_ != address(0) && !revoked && block.number <= expiryBlock;
    }

    function isSessionKey(address key) public view returns (bool) {
        return _sessions[key].owner != address(0);
    }

    function isActiveSessionKey(address key) public view returns (bool) {
        return _isSessionActive(_sessions[key]);
    }

    function _isSessionActive(SessionData storage data) internal view returns (bool) {
        return data.owner != address(0) && !data.revoked && block.number <= data.expiryBlock;
    }

    function _resolvePaintOwner(address sender) internal view returns (address owner_) {
        SessionData storage data = _sessions[sender];
        return _isSessionActive(data) ? data.owner : sender;
    }

    function _spendSessionUnits(address sender, address owner_, uint256 units) internal {
        if (sender == owner_) return;
        SessionData storage data = _sessions[sender];
        uint256 available = uint256(data.maxUnits) - uint256(data.unitsSpent);
        if (units > available) revert SessionUnitsExceeded(units, available);
        data.unitsSpent += uint96(units);
    }

    function _rejectSessionFrameAction() internal view {
        if (_isSessionActive(_sessions[msg.sender])) revert SessionKeyPaintOnly();
    }

    // ---------------------------------------------------------------------
    // Renderer registry
    // ---------------------------------------------------------------------

    function addRenderer(address renderer, string calldata name_) external onlyOwner returns (uint256 rendererId) {
        if (renderersFrozen) revert RendererFrozen();
        if (renderer == address(0)) revert ZeroAddress();
        if (bytes(name_).length == 0) revert RendererNameEmpty();
        rendererId = _renderers.length;
        _renderers.push(RendererData({renderer: renderer, name: name_}));
        emit RendererAdded(rendererId, renderer, name_);
    }

    function freezeRenderers() external onlyOwner {
        renderersFrozen = true;
        emit RenderersFrozen();
    }

    function rendererCount() external view returns (uint256) {
        return _renderers.length;
    }

    function rendererInfo(uint256 rendererId) external view returns (address renderer, string memory name_) {
        if (rendererId >= _renderers.length) revert InvalidRenderer(rendererId);
        RendererData storage data = _renderers[rendererId];
        return (data.renderer, data.name);
    }

    function tokenRenderer(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        return _tokenRenderer[tokenId];
    }

    function setTokenRenderer(uint256 tokenId, uint256 rendererId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenHolder(tokenId);
        if (rendererId >= _renderers.length) revert InvalidRenderer(rendererId);
        _tokenRenderer[tokenId] = rendererId;
        emit TokenRendererSet(tokenId, rendererId);
        emit MetadataUpdate(tokenId);
    }

    // ---------------------------------------------------------------------
    // Lab registry (display-only, grants no permission)
    // ---------------------------------------------------------------------

    function addExperiment(address experiment, string calldata name_, string calldata uri)
        external
        onlyOwner
        returns (uint256 experimentId)
    {
        if (experiment == address(0)) revert ZeroAddress();
        experimentId = _experiments.length;
        _experiments.push(ExperimentData({experiment: experiment, name: name_, uri: uri, retired: false}));
        emit ExperimentAdded(experimentId, experiment, name_, uri);
    }

    function retireExperiment(uint256 experimentId) external onlyOwner {
        if (experimentId >= _experiments.length) revert ExperimentNotFound(experimentId);
        _experiments[experimentId].retired = true;
        emit ExperimentRetired(experimentId);
    }

    function experimentCount() external view returns (uint256) {
        return _experiments.length;
    }

    function experimentInfo(uint256 experimentId) external view returns (ExperimentData memory) {
        if (experimentId >= _experiments.length) revert ExperimentNotFound(experimentId);
        return _experiments[experimentId];
    }

    // ---------------------------------------------------------------------
    // Paint
    // ---------------------------------------------------------------------

    function paint(bytes calldata runs, uint256[] calldata r3tardIds) external {
        address owner_ = _resolvePaintOwner(msg.sender);
        _paint(owner_, msg.sender, runs, r3tardIds);
    }

    function paintAndMintFrame(bytes calldata runs, uint256[] calldata r3tardIds)
        external
        returns (uint256 frameId)
    {
        _rejectSessionFrameAction();
        _paint(msg.sender, msg.sender, runs, r3tardIds);
        frameId = _mintFrame(msg.sender);
    }

    function _paint(address owner, address sender, bytes calldata runs, uint256[] calldata r3tardIds) internal {
        _requireOpen();
        (uint256 rawPixels, uint16 touchedTiles) = _validateRuns(runs);
        if (rawPixels == 0) revert EmptyPatch();
        _validateR3tardIds(owner, r3tardIds);

        uint256 season = currentSeason();
        uint256 runCount = runs.length >> 2;

        PaintScratch memory s;
        s.tileIndex = new bytes(256);
        s.tiles = new TileScratch[](touchedTiles);
        s.runWriteMasks = new uint256[](runCount);
        s.runPrefix = new uint32[](runCount);

        _applyBaseRuns(season, runs, s);
        if (s.pixelsWritten == 0) revert NoChange();

        uint256 pressure = _maxPressureForMask(season, s.regionsMask);
        uint256 amount = _df1Amount(pressure, block.number);
        bytes32 seed = keccak256(
            abi.encodePacked(
                blockhash(block.number - 1),
                block.number,
                owner,
                _painters[owner].paintCount,
                keccak256(runs)
            )
        );
        uint256 k = _corruptionCount(s.pixelsWritten, amount, seed);

        _checkRegionCaps(season, s);
        _spendSessionUnits(sender, owner, s.units);
        _spendUnits(owner, s.units, r3tardIds);
        bytes memory corruptions = _applyCorruptions(season, runs, s, k, seed);
        _persistTiles(season, s);
        _persistNonzeroWordMasks(season, s);
        _recordRegions(season, s, owner);
        _recordPainterSuccess(owner, sender, s.pixelsWritten);

        emit Painted(season, owner, sender, runs, corruptions, s.units, s.regionsMask);
        emit MetadataUpdate(0);
    }

    function _validateRuns(bytes calldata runs) internal pure returns (uint256 rawPixels, uint16 touchedTiles) {
        if ((runs.length & 3) != 0) revert InvalidPatchLength();
        uint256 count = runs.length >> 2;
        uint256 seenTiles;
        for (uint256 i; i < count; ++i) {
            uint256 o = i << 2;
            uint256 y = uint8(runs[o]);
            uint256 x0 = uint8(runs[o + 1]);
            uint256 x1 = uint8(runs[o + 2]);
            uint256 color = uint8(runs[o + 3]);
            if (x0 > x1 || y >= HEIGHT || x1 >= WIDTH) revert InvalidRun(i, y, x0, x1);
            if (color >= PALETTE_SIZE) revert InvalidColor(i, color);
            rawPixels += x1 - x0 + 1;
            if (rawPixels > MAX_RAW_PIXELS_PER_PAINT) revert TooManyPixelWrites(rawPixels, MAX_RAW_PIXELS_PER_PAINT);

            uint256 tileRow = y >> 4;
            uint256 firstTile = x0 >> 4;
            uint256 lastTile = x1 >> 4;
            for (uint256 tileX = firstTile; tileX <= lastTile; ++tileX) {
                uint256 tile = tileRow * 16 + tileX;
                uint256 bit = uint256(1) << tile;
                if ((seenTiles & bit) == 0) {
                    seenTiles |= bit;
                    ++touchedTiles;
                }
            }
        }
    }

    /// @dev True SWAR writer: no per-pixel loop. Each run touches <=4 canvas words and
    /// accounting is done per 16-pixel tile-row chunk with bit-popcounts.
    function _applyBaseRuns(uint256 season, bytes calldata runs, PaintScratch memory s) internal {
        uint256 base = canvasBaseSlot(season);
        uint256 outlineBase = _outlineBase(season);
        uint256 runCount = runs.length >> 2;

        for (uint256 i; i < runCount; ++i) {
            uint256 o = i << 2;
            uint8 y = uint8(runs[o]);
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            uint256 colorWord = _repeatNibble(color);
            uint256 runMask;
            uint256 firstSlot = uint256(x0) >> 6;
            uint256 lastSlot = uint256(x1) >> 6;

            for (uint256 sx = firstSlot; sx <= lastSlot; ++sx) {
                uint256 slotIndex = uint256(y) * 4 + sx;
                uint256 word = _sload(base + slotIndex);
                uint256 outlineWord = _sload(outlineBase + slotIndex);
                uint256 startLocal = sx == firstSlot ? uint256(x0) & 63 : 0;
                uint256 endLocal = sx == lastSlot ? uint256(x1) & 63 : 63;
                uint256 activeMask = _nibbleRangeMask(startLocal, endLocal) & ~outlineWord;

                uint256 changedLow = _nibbleNonZeroLsb((word ^ colorWord) & activeMask);
                if (changedLow == 0) continue;

                uint256 changedNibbleMask = changedLow * 15;
                uint256 nextWord = (word & ~changedNibbleMask) | (colorWord & changedNibbleMask);

                // Account in at most four 16-pixel chunks.
                uint256 firstChunk = startLocal >> 4;
                uint256 lastChunk = endLocal >> 4;
                for (uint256 c = firstChunk; c <= lastChunk; ++c) {
                    uint256 shift = (3 - c) * 64;
                    uint64 changedChunk = uint64(changedLow >> shift);
                    if (changedChunk == 0) continue;

                    uint256 globalChunkX = sx * 64 + c * 16;
                    uint16 changedRev = _compactNibbleLsb(changedChunk);
                    uint16 changedLR = _reverse16(changedRev);
                    uint16 tile = uint16((uint256(y) >> 4) * 16 + (globalChunkX >> 4));
                    uint16 idx = _loadTile(season, tile, s);
                    TileScratch memory t = s.tiles[idx];

                    uint256 rowShift = (uint256(y) & 15) << 4;
                    uint16 wetLR = uint16((t.currentBits | t.previousBits) >> rowShift);
                    uint64 wetExpanded = _expand16ToNibbleLsb(_reverse16(wetLR));

                    uint64 oldChunk = uint64(word >> shift);
                    uint64 nonZeroLow = uint64(_nibbleNonZeroLsb(uint256(oldChunk)));
                    uint64 nonZeroChanged = changedChunk & nonZeroLow;
                    uint64 wetNonZero = nonZeroChanged & wetExpanded;

                    uint256 changedCount = _popcount64(changedChunk);
                    uint256 nonZeroCount = _popcount64(nonZeroChanged);
                    uint256 wetCount = _popcount64(wetNonZero);
                    uint256 blankCount = changedCount - nonZeroCount;
                    uint256 dryCount = nonZeroCount - wetCount;
                    uint256 heatAdd = blankCount + (dryCount << 1);

                    s.units += uint32(blankCount + wetCount + (dryCount << 1));
                    if (heatAdd != 0) {
                        uint256 nextHeat = uint256(t.heat) + heatAdd;
                        if (nextHeat > MAX_TILE_HEAT) revert TileTooHot(tile);
                        t.heat = uint16(nextHeat);
                        t.lastHeatBlock = uint48(block.number);
                        t.metaDirty = true;
                    }
                    uint256 newCurrent = t.currentBits | (uint256(changedLR) << rowShift);
                    if (newCurrent != t.currentBits) {
                        t.currentBits = newCurrent;
                        t.currentDirty = true;
                    }
                    s.tiles[idx] = t;

                    uint8 region = uint8((uint256(y) >> 6) * 4 + (globalChunkX >> 6));
                    s.regionWrites[region] += uint32(changedCount);
                    s.regionsMask |= uint16(1) << region;
                    s.pixelsWritten += uint32(changedCount);

                    // Map actual writes into this run's x0-relative 256-bit mask.
                    uint256 segStart = globalChunkX < x0 ? x0 : globalChunkX;
                    uint256 chunkEnd = globalChunkX + 15;
                    uint256 segEnd = chunkEnd > x1 ? x1 : chunkEnd;
                    uint256 trim = segStart - globalChunkX;
                    uint256 width = segEnd - segStart + 1;
                    uint16 relevant = uint16(uint256(changedLR) >> trim);
                    if (width < 16) relevant &= uint16((uint256(1) << width) - 1);
                    runMask |= uint256(relevant) << (segStart - x0);
                }

                _sstore(base + slotIndex, nextWord);
                _trackNonzeroWordTransition(slotIndex, word, nextWord, s);
            }
            s.runWriteMasks[i] = runMask;
            s.runPrefix[i] = s.pixelsWritten;
        }
    }

    function _loadTile(uint256 season, uint16 tile, PaintScratch memory s) internal view returns (uint16 idx) {
        uint256 tileBit = uint256(1) << tile;
        if ((s.loadedTiles & tileBit) != 0) return uint16(uint8(s.tileIndex[tile]));

        idx = s.tileCount++;
        s.loadedTiles |= tileBit;
        s.tileIndex[tile] = bytes1(uint8(idx));

        uint256 tileRow = uint256(tile) >> 4;
        uint256 tileCol = uint256(tile) & 15;
        uint8 region = uint8((tileRow >> 2) * 4 + (tileCol >> 2));
        uint256 localTile = (tileRow & 3) * 4 + (tileCol & 3);
        uint256 page = regionPageSlot(season, region);

        uint256 meta = _sload(page + TILE_META_OFFSET + localTile);
        uint64 storedEpoch = uint64(meta);
        uint48 lastHeat = uint48(meta >> 64);
        uint16 heat = uint16(meta >> 112);
        uint256 currentBits = _sload(page + TILE_CURRENT_OFFSET + localTile);
        uint256 previousBits = _sload(page + TILE_PREVIOUS_OFFSET + localTile);

        uint64 epoch = uint64(block.number / WET_WINDOW_BLOCKS);
        bool rolled = storedEpoch != epoch;
        if (rolled) {
            previousBits = storedEpoch + 1 == epoch ? currentBits : 0;
            currentBits = 0;
            storedEpoch = epoch;
        }
        if (lastHeat != 0 && block.number > lastHeat) {
            uint256 decay = (block.number - uint256(lastHeat)) * TILE_COOLDOWN_PER_BLOCK;
            heat = decay >= heat ? 0 : uint16(uint256(heat) - decay);
        }

        s.tiles[idx] = TileScratch({
            tile: tile,
            epoch: storedEpoch,
            lastHeatBlock: lastHeat,
            heat: heat,
            currentBits: currentBits,
            previousBits: previousBits,
            metaDirty: rolled,
            currentDirty: rolled,
            previousDirty: rolled
        });
    }

    function _applyCorruptions(
        uint256 season,
        bytes calldata runs,
        PaintScratch memory s,
        uint256 k,
        bytes32 seed
    ) internal returns (bytes memory corruptions) {
        corruptions = new bytes(k * 3);
        uint256 base = canvasBaseSlot(season);

        for (uint256 i; i < k; ++i) {
            uint256 rnd = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 pick = rnd % s.pixelsWritten;
            (uint8 x, uint8 y) = _writtenPixelAt(runs, s, pick);
            uint8 color = uint8(((rnd >> 128) % 15) + 1);

            uint256 slotIndex = uint256(y) * 4 + (uint256(x) >> 6);
            uint256 shift = 252 - ((uint256(x) & 63) << 2);
            uint256 nibbleMask = uint256(0xF) << shift;
            uint256 word = _sload(base + slotIndex);
            uint256 nextWord = (word & ~nibbleMask) | (uint256(color) << shift);
            if (nextWord != word) {
                _sstore(base + slotIndex, nextWord);
                _trackNonzeroWordTransition(slotIndex, word, nextWord, s);
            }

            uint16 tile = uint16((uint256(y) >> 4) * 16 + (uint256(x) >> 4));
            uint16 idx = _loadTile(season, tile, s);
            TileScratch memory t = s.tiles[idx];
            uint256 bit = (uint256(y) & 15) * 16 + (uint256(x) & 15);
            uint256 nextBits = t.currentBits | (uint256(1) << bit);
            if (nextBits != t.currentBits) {
                t.currentBits = nextBits;
                t.currentDirty = true;
            }
            s.tiles[idx] = t;

            uint256 o = i * 3;
            corruptions[o] = bytes1(x);
            corruptions[o + 1] = bytes1(y);
            corruptions[o + 2] = bytes1(color);
        }
    }

    function _writtenPixelAt(bytes calldata runs, PaintScratch memory s, uint256 pick)
        internal
        pure
        returns (uint8 x, uint8 y)
    {
        uint256 lo;
        uint256 hi = s.runPrefix.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) >> 1;
            if (pick < s.runPrefix[mid]) hi = mid;
            else lo = mid + 1;
        }
        uint256 runIndex = lo;
        uint256 before = runIndex == 0 ? 0 : s.runPrefix[runIndex - 1];
        uint256 rank = pick - before;
        uint256 mask = s.runWriteMasks[runIndex];
        uint256 offset = _selectSetBit(mask, rank);
        uint256 o = runIndex << 2;
        y = uint8(runs[o]);
        x = uint8(uint256(uint8(runs[o + 1])) + offset);
    }

    function _trackNonzeroWordTransition(
        uint256 slotIndex,
        uint256 oldWord,
        uint256 newWord,
        PaintScratch memory s
    ) internal pure {
        bool oldZero = oldWord == 0;
        bool newZero = newWord == 0;
        if (oldZero == newZero) return;

        uint256 y = slotIndex >> 2;
        uint8 region = uint8((y >> 6) * 4 + (slotIndex & 3));
        uint64 bit = uint64(1) << uint64(y & 63);
        if (newZero) {
            s.nonzeroWordClear[region] |= bit;
            s.nonzeroWordSet[region] &= ~bit;
        } else {
            s.nonzeroWordSet[region] |= bit;
            s.nonzeroWordClear[region] &= ~bit;
        }
    }

    function _persistNonzeroWordMasks(uint256 season, PaintScratch memory s) internal {
        for (uint8 region; region < 16; ++region) {
            uint64 setBits = s.nonzeroWordSet[region];
            uint64 clearBits = s.nonzeroWordClear[region];
            if ((setBits | clearBits) == 0) continue;
            uint256 slot = regionPageSlot(season, region) + REGION_NONZERO_WORDS_OFFSET;
            uint64 current = uint64(_sload(slot));
            uint64 next = (current | setBits) & ~clearBits;
            if (next != current) _sstore(slot, next);
        }
    }

    function _persistTiles(uint256 season, PaintScratch memory s) internal {
        for (uint256 i; i < s.tileCount; ++i) {
            TileScratch memory t = s.tiles[i];
            uint256 tileRow = uint256(t.tile) >> 4;
            uint256 tileCol = uint256(t.tile) & 15;
            uint8 region = uint8((tileRow >> 2) * 4 + (tileCol >> 2));
            uint256 localTile = (tileRow & 3) * 4 + (tileCol & 3);
            uint256 page = regionPageSlot(season, region);
            if (t.metaDirty) {
                uint256 meta = uint256(t.epoch) | (uint256(t.lastHeatBlock) << 64) | (uint256(t.heat) << 112);
                _sstore(page + TILE_META_OFFSET + localTile, meta);
            }
            if (t.currentDirty) _sstore(page + TILE_CURRENT_OFFSET + localTile, t.currentBits);
            if (t.previousDirty) _sstore(page + TILE_PREVIOUS_OFFSET + localTile, t.previousBits);
        }
    }

    function _checkRegionCaps(uint256 season, PaintScratch memory s) internal view {
        uint256 cap = _maxRegionPixels();
        for (uint8 region; region < 16; ++region) {
            uint256 add = s.regionWrites[region];
            if (add == 0) continue;
            (uint48 capBlock, uint16 pixelsInBlock,,,,) = _unpackRegionSummary(_sload(regionPageSlot(season, region) + REGION_SUMMARY_OFFSET));
            uint256 used = capBlock == block.number ? pixelsInBlock : 0;
            if (used + add > cap) revert RegionBusy(region);
        }
    }

    function _recordRegions(uint256 season, PaintScratch memory s, address owner) internal {
        uint8 primary = _lowestRegion(s.regionsMask);
        for (uint8 region; region < 16; ++region) {
            uint256 add = s.regionWrites[region];
            if (add == 0) continue;
            uint256 page = regionPageSlot(season, region);
            (uint48 capBlock, uint16 pixelsInBlock, uint48 totalPaints, uint48 changeCounter, uint48 primaryPaints,) =
                _unpackRegionSummary(_sload(page + REGION_SUMMARY_OFFSET));

            if (capBlock != block.number) {
                capBlock = uint48(block.number);
                pixelsInBlock = 0;
            }
            pixelsInBlock += uint16(add);
            ++totalPaints;
            ++changeCounter;
            if (region == primary) ++primaryPaints;
            _sstore(page + REGION_SUMMARY_OFFSET, _packRegionSummary(capBlock, pixelsInBlock, totalPaints, changeCounter, primaryPaints));

            address lastOwner = address(uint160(_sload(page + REGION_LAST_OWNER_OFFSET)));
            if (lastOwner == address(0)) {
                _sstore(page + REGION_LAST_OWNER_OFFSET, uint160(owner));
            } else if (lastOwner != owner) {
                _sstore(page + REGION_LAST_OWNER_OFFSET, uint160(owner));
                uint256 bucket = block.number % DF1_WINDOW_BLOCKS;
                uint256 slot = page + REGION_RING_OFFSET + bucket;
                uint256 packed = _sload(slot);
                uint48 bn = uint48(packed);
                uint16 count = uint16(packed >> 48);
                if (bn != block.number) {
                    bn = uint48(block.number);
                    count = 0;
                }
                if (count != type(uint16).max) ++count;
                _sstore(slot, uint256(bn) | (uint256(count) << 48));
            }
        }
    }

    function _maxRegionPixels() internal pure virtual returns (uint256) {
        return MAX_PIXELS_PER_REGION_PER_BLOCK;
    }

    function _pressure(uint256 season, uint8 region) internal view returns (uint256 p) {
        uint256 page = regionPageSlot(season, region);
        for (uint256 i; i < DF1_WINDOW_BLOCKS; ++i) {
            uint256 packed = _sload(page + REGION_RING_OFFSET + i);
            uint256 bn = uint48(packed);
            if (bn <= block.number && block.number - bn < DF1_WINDOW_BLOCKS) p += uint16(packed >> 48);
        }
    }

    function _maxPressureForMask(uint256 season, uint16 mask) internal view returns (uint256 p) {
        for (uint8 region; region < 16; ++region) {
            if ((mask & (uint16(1) << region)) == 0) continue;
            uint256 rp = _pressure(season, region);
            if (rp > p) p = rp;
        }
    }

    function isStorm(uint256 blockNumber) public pure returns (bool) {
        return blockNumber % STORM_PERIOD_BLOCKS < STORM_LENGTH_BLOCKS;
    }

    function nextStormStart() external view returns (uint256) {
        return block.number - (block.number % STORM_PERIOD_BLOCKS) + STORM_PERIOD_BLOCKS;
    }

    function _df1AmountForPressure(uint256 pressure) internal pure returns (uint256) {
        if (pressure <= 2) return 0;
        uint256 amount = 50 * (pressure - 2);
        return amount > 200 ? 200 : amount;
    }

    function _df1Amount(uint256 pressure, uint256 blockNumber) internal pure returns (uint256) {
        return isStorm(blockNumber) ? 200 : _df1AmountForPressure(pressure);
    }

    function _corruptionCount(uint256 pixelsWritten, uint256 amount, bytes32 seed) internal pure returns (uint256 k) {
        if (amount == 0 || pixelsWritten == 0) return 0;
        uint256 numerator = pixelsWritten * DF1_OUTLIER_RATE * amount;
        k = numerator / DF1_RATE_DENOMINATOR;
        uint256 remainder = numerator % DF1_RATE_DENOMINATOR;
        if (remainder != 0 && uint256(seed) % DF1_RATE_DENOMINATOR < remainder) ++k;
        if (k > 32) k = 32;
    }

    // ---------------------------------------------------------------------
    // Budget / painter accounting
    // ---------------------------------------------------------------------

    function _validateR3tardIds(address owner, uint256[] calldata ids) internal view {
        for (uint256 i; i < ids.length; ++i) {
            for (uint256 j; j < i; ++j) if (ids[j] == ids[i]) revert DuplicateR3tardId(ids[i]);
            if (R3TARDS.ownerOf(ids[i]) != owner) revert NotR3tardOwner(ids[i], owner);
        }
    }

    function _rollPainter(PainterData storage p) internal {
        uint48 hourBucket = uint48(block.timestamp / 1 hours);
        if (p.hourBucket != hourBucket) {
            p.hourBucket = hourBucket;
            p.unitsThisHour = 0;
        }
        uint48 dayBucket = uint48(block.timestamp / 1 days);
        if (p.dayBucket != dayBucket) {
            p.dayBucket = dayBucket;
            p.pixelsToday = 0;
            p.dayCredited = false;
        }
    }

    function _hourLimit(PainterData storage p) internal view returns (uint256 limit) {
        limit = uint256(BASE_PIXELS_PER_HOUR) + uint256(PIXELS_PER_ACTIVE_DAY) * p.activeDays;
        if (limit > MAX_PIXELS_PER_HOUR) limit = MAX_PIXELS_PER_HOUR;
    }

    function _quotaAvailable(uint256 tokenId, uint48 dayBucket) internal view returns (uint256) {
        TokenQuota storage q = _holderQuota[tokenId];
        uint256 spent = q.dayBucket == dayBucket ? q.spent : 0;
        return spent >= HOLDER_PIXELS_PER_DAY ? 0 : HOLDER_PIXELS_PER_DAY - spent;
    }

    function _spendUnits(address owner, uint32 needed, uint256[] calldata ids) internal {
        PainterData storage p = _painters[owner];
        _rollPainter(p);
        uint256 limit = _hourLimit(p);
        uint256 hourlyAvailable = p.unitsThisHour >= limit ? 0 : limit - p.unitsThisHour;
        uint48 dayBucket = uint48(block.timestamp / 1 days);
        uint256 holderAvailable;
        for (uint256 i; i < ids.length; ++i) holderAvailable += _quotaAvailable(ids[i], dayBucket);
        uint256 available = hourlyAvailable + holderAvailable;
        if (needed > available) revert InsufficientBudget(needed, available);

        uint256 fromHourly = needed < hourlyAvailable ? needed : hourlyAvailable;
        p.unitsThisHour += uint32(fromHourly);
        uint256 remaining = needed - fromHourly;
        for (uint256 i; i < ids.length && remaining != 0; ++i) {
            TokenQuota storage q = _holderQuota[ids[i]];
            if (q.dayBucket != dayBucket) {
                q.dayBucket = dayBucket;
                q.spent = 0;
            }
            uint256 free = HOLDER_PIXELS_PER_DAY - q.spent;
            uint256 take = remaining < free ? remaining : free;
            q.spent += uint16(take);
            remaining -= take;
        }
    }

    function _recordPainterSuccess(address owner, address sender, uint32 pixelsWritten) internal {
        PainterData storage p = _painters[owner];
        _rollPainter(p);
        if (p.firstPaintBlock == 0) p.firstPaintBlock = uint48(block.number);
        p.lastPaintBlock = uint48(block.number);
        uint48 paintDay = uint48(block.timestamp / 1 days);
        if (p.daysPainted == 0 || p.lastPaintDayBucket != paintDay) {
            p.lastPaintDayBucket = paintDay;
            ++p.daysPainted;
        }
        ++p.paintCount;
        if (sender != owner) ++p.sessionPaints;
        if (isStorm(block.number)) ++p.stormPaints;
        p.totalPixelsPainted += pixelsWritten;
        p.pixelsToday += pixelsWritten;
        if (!p.dayCredited && p.pixelsToday >= MIN_PIXELS_FOR_ACTIVE_DAY) {
            p.dayCredited = true;
            ++p.activeDays;
        }
    }

    // ---------------------------------------------------------------------
    // Face / background
    // ---------------------------------------------------------------------

    function faceColor(uint256 season) public view returns (uint8) {
        uint8 encoded = _seasons[season].faceEncoded;
        return encoded == 0 ? FACE_BLACK : encoded - 1;
    }

    function backgroundColor(uint256 season) public view returns (uint8) {
        return _seasons[season].backgroundColor;
    }

    function setFace(uint8 color, uint256[] calldata r3tardIds) external {
        _rejectSessionFrameAction();
        _requireOpen();
        if (color != FACE_BLACK && color != FACE_WHITE) revert InvalidFaceColor(color);
        uint256 season = currentSeason();
        if (faceColor(season) == color) revert NoChange();
        _validateR3tardIds(msg.sender, r3tardIds);
        SeasonStateData storage ss = _seasons[season];
        if (ss.lastFaceBlock != 0 && block.number < uint256(ss.lastFaceBlock) + FACE_FLIP_COOLDOWN_BLOCKS) {
            revert CooldownActive(uint256(ss.lastFaceBlock) + FACE_FLIP_COOLDOWN_BLOCKS);
        }
        _spendUnits(msg.sender, 64, r3tardIds);
        ss.faceEncoded = color + 1;
        ss.lastFaceBlock = uint48(block.number);
        ++ss.styleVersion;
        emit FaceChanged(season, color, msg.sender);
        emit MetadataUpdate(0);
    }

    function setBackground(uint8 color, uint256[] calldata r3tardIds) external {
        _rejectSessionFrameAction();
        _requireOpen();
        if (!_allowedBackground(color)) revert InvalidBackgroundColor(color);
        uint256 season = currentSeason();
        SeasonStateData storage ss = _seasons[season];
        if (ss.backgroundColor == color) revert NoChange();
        _validateR3tardIds(msg.sender, r3tardIds);
        if (ss.lastBackgroundBlock != 0 && block.number < uint256(ss.lastBackgroundBlock) + BACKGROUND_COOLDOWN_BLOCKS) {
            revert CooldownActive(uint256(ss.lastBackgroundBlock) + BACKGROUND_COOLDOWN_BLOCKS);
        }
        _spendUnits(msg.sender, 256, r3tardIds);
        ss.backgroundColor = color;
        ss.lastBackgroundBlock = uint48(block.number);
        ++ss.styleVersion;
        emit BackgroundChanged(season, color, msg.sender);
        emit MetadataUpdate(0);
    }

    function _allowedBackground(uint8 color) internal pure returns (bool) {
        return color == 0 || color == 5 || color == 6 || color == 8 || color == 9 || color == 10 || color == 11;
    }

    // ---------------------------------------------------------------------
    // Frames
    // ---------------------------------------------------------------------

    function mintFrame() external returns (uint256 frameId) {
        _rejectSessionFrameAction();
        _requireOpen();
        frameId = _mintFrame(msg.sender);
    }

    function _mintFrame(address minter) internal returns (uint256 frameId) {
        uint256 season = currentSeason();
        PainterData storage p = _painters[minter];
        if (p.paintCount == p.lastFramePaintCount) revert FramePaintRequired();
        if (p.lastFrameBlock != 0 && block.number < uint256(p.lastFrameBlock) + FRAME_COOLDOWN_BLOCKS) {
            revert CooldownActive(uint256(p.lastFrameBlock) + FRAME_COOLDOWN_BLOCKS);
        }

        bytes32 fingerprint = _canvasFingerprint(season);
        SeasonStateData storage ss = _seasons[season];
        if (ss.lastFrameFingerprint == fingerprint) revert CanvasUnchanged();

        uint48 paintTotal = uint48(_seasonPrimaryPaintTotal(season));
        uint48 sincePrevious = paintTotal - ss.lastFramePrimaryPaintTotal;
        ss.lastFramePrimaryPaintTotal = paintTotal;
        ss.lastFrameFingerprint = fingerprint;
        ++ss.regularFrameCount;

        // Only immutable background is stored. Outline + face are reconstructed at render time.
        address pointer = _storeBackgroundFrame(season);
        frameId = _nextTokenId++;
        ++totalFrames;
        uint16 amount = uint16(_df1Amount(_maxPressureAllRegions(season), block.number));

        _frames[frameId] = FrameInfoData({
            minter: minter,
            proposer: block.coinbase,
            dataPointer: pointer,
            blockNumber: uint48(block.number),
            season: uint32(season),
            seasonFrameIndex: ss.regularFrameCount,
            frameNumber: uint48(totalFrames),
            paintsSincePreviousFrame: sincePrevious,
            df1Amount: amount,
            faceColor: faceColor(season),
            backgroundColor: ss.backgroundColor,
            holderAtMint: R3TARDS.balanceOf(minter) != 0,
            finale: false
        });
        _seasonFrameToken[season][ss.regularFrameCount] = frameId;

        ++p.framesMinted;
        p.lastFrameBlock = uint48(block.number);
        p.lastFramePaintCount = p.paintCount;
        _mint(minter, frameId);
        emit FrameMinted(frameId, season, minter, ss.regularFrameCount);
    }

    function mintSeasonFinale(uint256 season) external returns (uint256 tokenId) {
        _rejectSessionFrameAction();
        _requireOpen();
        if (block.timestamp < seasonEndTime(season)) revert SeasonNotEnded(season);
        if (_seasonPrimaryPaintTotal(season) == 0) revert SeasonHasNoPaint(season);
        SeasonStateData storage ss = _seasons[season];
        if (ss.finaleMinted) revert SeasonFinaleAlreadyMinted(season);

        address recipient = ownerOf(0);
        address pointer = _storeBackgroundFrame(season);
        tokenId = _nextTokenId++;
        ss.finaleMinted = true;
        ss.finaleTokenId = tokenId;

        _frames[tokenId] = FrameInfoData({
            minter: recipient,
            proposer: block.coinbase,
            dataPointer: pointer,
            blockNumber: uint48(block.number),
            season: uint32(season),
            seasonFrameIndex: ss.regularFrameCount,
            frameNumber: 0,
            paintsSincePreviousFrame: uint48(_seasonPrimaryPaintTotal(season)) - ss.lastFramePrimaryPaintTotal,
            df1Amount: uint16(_df1Amount(_maxPressureAllRegions(season), block.number)),
            faceColor: faceColor(season),
            backgroundColor: ss.backgroundColor,
            holderAtMint: R3TARDS.balanceOf(recipient) != 0,
            finale: true
        });
        _mint(recipient, tokenId);
        emit SeasonFinaleMinted(season, tokenId, recipient);
    }

    function burn(uint256 tokenId) external {
        if (tokenId == 0 || _frames[tokenId].finale) revert NonBurnableToken(tokenId);
        address owner = ownerOf(tokenId);
        if (!_isAuthorized(owner, msg.sender, tokenId)) revert NotAuthorized();
        _burn(tokenId);
    }

    // ---------------------------------------------------------------------
    // Open data API
    // ---------------------------------------------------------------------

    /// @notice Raw packed background bytes in BMP bottom-up row order.
    function frameData(uint256 tokenId) public view returns (bytes memory) {
        if (tokenId == 0) return _backgroundBottomUp(currentSeason());
        address pointer = _frames[tokenId].dataPointer;
        if (pointer == address(0)) revert FrameDoesNotExist(tokenId);
        return FrameStore.read(pointer);
    }

    /// @notice 128x128 4-bit background-only frame data, BMP bottom-up row order.
    /// @dev Samples the top-left pixel of each 2x2 source block; renderer layers the season outline afterward.
    function frameData128(uint256 tokenId) external view returns (bytes memory out) {
        bytes memory source = frameData(tokenId);
        out = new bytes(8_192);
        for (uint256 row; row < 128; ++row) {
            uint256 w0;
            uint256 w1;
            uint256 w2;
            uint256 w3;
            assembly ("memory-safe") {
                let src := add(add(source, 0x20), mul(add(mul(row, 2), 1), 128))
                w0 := mload(src)
                w1 := mload(add(src, 32))
                w2 := mload(add(src, 64))
                w3 := mload(add(src, 96))
            }
            uint256 o0 = (_downsamplePairs(w0) << 128) | _downsamplePairs(w1);
            uint256 o1 = (_downsamplePairs(w2) << 128) | _downsamplePairs(w3);
            assembly ("memory-safe") {
                let dst := add(add(out, 0x20), mul(row, 64))
                mstore(dst, o0)
                mstore(add(dst, 32), o1)
            }
        }
    }

    /// @dev 32 source bytes (64 px) -> 16 bytes (32 px): keeps the high (left) nibble of every byte.
    function _downsamplePairs(uint256 word) private pure returns (uint256 x) {
        x = ((word >> 8) & 0x00F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F0)
            | ((word >> 4) & 0x000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F);
        x = (x | (x >> 8)) & 0x0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF;
        x = (x | (x >> 16)) & 0x00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF;
        x = (x | (x >> 32)) & 0x0000000000000000FFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF;
        x = (x | (x >> 64)) & 0x00000000000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    }

    /// @notice Packed composite pixels in BMP bottom-up order, using the frame's own season outline.
    function frameCompositeData(uint256 tokenId) public view returns (bytes memory) {
        if (tokenId == 0) return _compositeBottomUpLive(currentSeason());
        FrameInfoData storage info = _frames[tokenId];
        if (info.dataPointer == address(0)) revert FrameDoesNotExist(tokenId);
        return _compositeStoredBackground(FrameStore.read(info.dataPointer), info.faceColor, info.season);
    }

    function isR3tardHolder(address account) external view returns (bool) {
        return R3TARDS.balanceOf(account) != 0;
    }

    function frameInfo(uint256 tokenId) external view returns (FrameInfoData memory) {
        FrameInfoData memory info = _frames[tokenId];
        if (info.dataPointer == address(0)) revert FrameDoesNotExist(tokenId);
        return info;
    }

    function seasonFrameToken(uint256 season, uint48 seasonFrameIndex) external view returns (uint256) {
        return _seasonFrameToken[season][seasonFrameIndex];
    }

    /// @notice Genesis composite for a season: blank background plus that season's outline in black.
    /// @dev Returned in the same BMP bottom-up packed-pixel order as frameData().
    function genesisFrameData(uint256 season) public view returns (bytes memory out) {
        out = _outlineOnlyBottomUp(season, FACE_BLACK);
    }

    function genesisFrameData() external view returns (bytes memory out) {
        out = genesisFrameData(currentSeason());
    }

    function df1Seed(uint256 tokenId) public view returns (uint32) {
        bytes32 h;
        if (tokenId == 0) {
            h = keccak256(abi.encode("r3tards.df1.v1", currentSeason(), block.number));
        } else {
            FrameInfoData storage info = _frames[tokenId];
            if (info.dataPointer == address(0)) revert FrameDoesNotExist(tokenId);
            h = keccak256(abi.encode("r3tards.df1.v1", tokenId, uint256(info.blockNumber)));
        }
        return uint32(uint256(h));
    }

    function daysPainted(address painter) external view returns (uint32) {
        return _painters[painter].daysPainted;
    }

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
    ) {
        PainterData storage p = _painters[painter];
        uint48 dayBucket = uint48(block.timestamp / 1 days);
        return (
            p.activeDays,
            p.dayBucket == dayBucket ? p.pixelsToday : 0,
            p.totalPixelsPainted,
            p.framesMinted,
            p.firstPaintBlock,
            p.lastPaintBlock,
            p.paintCount,
            p.paintCount,
            p.sessionPaints,
            p.stormPaints
        );
    }

    function seasonInfo(uint256 season) external view returns (
        uint256 startsAt,
        uint256 endsAt,
        uint8 face,
        uint8 background,
        uint64 regularFrames,
        bool finaleMinted,
        uint256 finaleTokenId,
        uint256 successfulPaints
    ) {
        SeasonStateData storage ss = _seasons[season];
        return (
            seasonStartTime(season),
            seasonEndTime(season),
            faceColor(season),
            ss.backgroundColor,
            ss.regularFrameCount,
            ss.finaleMinted,
            ss.finaleTokenId,
            _seasonPrimaryPaintTotal(season)
        );
    }

    function budgetOf(address owner, uint256[] calldata ids) external view returns (
        uint256 hourlyAvailable,
        uint256 holderAvailable,
        uint256 totalAvailable,
        uint256 hourlyLimit,
        uint32 activeDays
    ) {
        _validateR3tardIds(owner, ids);
        PainterData storage p = _painters[owner];
        hourlyLimit = uint256(BASE_PIXELS_PER_HOUR) + uint256(PIXELS_PER_ACTIVE_DAY) * p.activeDays;
        if (hourlyLimit > MAX_PIXELS_PER_HOUR) hourlyLimit = MAX_PIXELS_PER_HOUR;
        uint48 hourBucket = uint48(block.timestamp / 1 hours);
        uint256 spent = p.hourBucket == hourBucket ? p.unitsThisHour : 0;
        hourlyAvailable = spent >= hourlyLimit ? 0 : hourlyLimit - spent;
        uint48 dayBucket = uint48(block.timestamp / 1 days);
        for (uint256 i; i < ids.length; ++i) holderAvailable += _quotaAvailable(ids[i], dayBucket);
        totalAvailable = hourlyAvailable + holderAvailable;
        activeDays = p.activeDays;
    }

    function tileState(uint256 season, uint16 tile) external view returns (
        uint64 epoch,
        uint32 heat,
        uint256 wetBitmap
    ) {
        uint256 tileRow = uint256(tile) >> 4;
        uint256 tileCol = uint256(tile) & 15;
        uint8 region = uint8((tileRow >> 2) * 4 + (tileCol >> 2));
        uint256 localTile = (tileRow & 3) * 4 + (tileCol & 3);
        uint256 page = regionPageSlot(season, region);
        uint256 meta = _sload(page + TILE_META_OFFSET + localTile);
        uint64 storedEpoch = uint64(meta);
        uint48 lastHeat = uint48(meta >> 64);
        heat = uint16(meta >> 112);
        uint256 currentBits = _sload(page + TILE_CURRENT_OFFSET + localTile);
        uint256 previousBits = _sload(page + TILE_PREVIOUS_OFFSET + localTile);
        epoch = uint64(block.number / WET_WINDOW_BLOCKS);

        if (storedEpoch == epoch) wetBitmap = currentBits | previousBits;
        else if (storedEpoch + 1 == epoch) wetBitmap = currentBits;
        else wetBitmap = 0;

        if (lastHeat != 0 && block.number > lastHeat) {
            uint256 decay = (block.number - uint256(lastHeat)) * TILE_COOLDOWN_PER_BLOCK;
            heat = decay >= heat ? 0 : uint32(uint256(heat) - decay);
        }
    }

    function regionState(uint256 season, uint8 region) external view returns (
        uint64 capBlock,
        uint32 pixelsInBlock,
        uint64 totalPaints,
        uint64 changeCounter,
        uint64 primaryPaints,
        uint256 pressure
    ) {
        (uint48 cb, uint16 pib, uint48 tp, uint48 cc, uint48 pp,) =
            _unpackRegionSummary(_sload(regionPageSlot(season, region) + REGION_SUMMARY_OFFSET));
        capBlock = cb;
        pixelsInBlock = cb == block.number ? pib : 0;
        totalPaints = tp;
        changeCounter = cc;
        primaryPaints = pp;
        pressure = _pressure(season, region);
    }

    function regionWords(uint256 season, uint8 region) external view returns (uint256[64] memory words) {
        if (region >= 16) revert InvalidRegion(region);
        uint256 regionRow = uint256(region) >> 2;
        uint256 regionCol = uint256(region) & 3;
        uint256 base = canvasBaseSlot(season);
        for (uint256 row; row < 64; ++row) {
            uint256 y = regionRow * 64 + row;
            words[row] = _sload(base + y * 4 + regionCol);
        }
    }

    function regionBlankMask(uint256 season, uint8 region) external view returns (uint64[64] memory masks) {
        if (region >= 16) revert InvalidRegion(region);
        uint256 regionRow = uint256(region) >> 2;
        uint256 regionCol = uint256(region) & 3;
        uint256 canvasBase = canvasBaseSlot(season);
        uint256 outlineBase = _outlineBase(season);
        for (uint256 row; row < 64; ++row) {
            uint256 y = regionRow * 64 + row;
            uint256 slotIndex = y * 4 + regionCol;
            uint256 bg = _sload(canvasBase + slotIndex);
            uint256 outline = _sload(outlineBase + slotIndex);
            uint256 blankLsb = NIBBLE_LSB & ~(_nibbleNonZeroLsb(bg) | _nibbleNonZeroLsb(outline));
            masks[row] = _compactNibbleLsb64(blankLsb);
        }
    }

    function getBackgroundCanvas() external view returns (bytes memory) {
        return getBackgroundCanvas(currentSeason());
    }

    function getBackgroundCanvas(uint256 season) public view returns (bytes memory canvas) {
        canvas = new bytes(CANVAS_BYTE_LENGTH);
        uint256 base = canvasBaseSlot(season);
        for (uint256 i; i < CANVAS_SLOT_COUNT; ++i) {
            uint256 word = _sload(base + i);
            assembly ("memory-safe") { mstore(add(add(canvas, 0x20), mul(i, 0x20)), word) }
        }
    }

    function getCanvas() external view returns (bytes memory) {
        return getCanvas(currentSeason());
    }

    function getCanvas(uint256 season) public view returns (bytes memory canvas) {
        canvas = new bytes(CANVAS_BYTE_LENGTH);
        uint256 base = canvasBaseSlot(season);
        uint256 outlineBase = _outlineBase(season);
        uint256[4] memory outlineBits = _outlineBitmaps(season);
        uint256 faceWord = _repeatNibble(faceColor(season));
        for (uint256 i; i < CANVAS_SLOT_COUNT; ++i) {
            uint256 bg = _sload(base + i);
            uint256 mask;
            if ((outlineBits[i >> 8] & (uint256(1) << (i & 255))) != 0) {
                mask = _sload(outlineBase + i);
            }
            uint256 word = (bg & ~mask) | (faceWord & mask);
            assembly ("memory-safe") { mstore(add(add(canvas, 0x20), mul(i, 0x20)), word) }
        }
    }

    function backgroundPixelAt(uint256 season, uint256 x, uint256 y) public view returns (uint8) {
        if (x >= WIDTH || y >= HEIGHT) revert PixelOutOfBounds(x, y);
        uint256 slotIndex = y * 4 + (x >> 6);
        uint256 shift = 252 - ((x & 63) << 2);
        return uint8((_sload(canvasBaseSlot(season) + slotIndex) >> shift) & 0xF);
    }

    function pixelAt(uint256 season, uint256 x, uint256 y) public view returns (uint8) {
        if (x >= WIDTH || y >= HEIGHT) revert PixelOutOfBounds(x, y);
        uint256 slotIndex = y * 4 + (x >> 6);
        uint256 shift = 252 - ((x & 63) << 2);
        if (((_sload(_outlineBase(season) + slotIndex) >> shift) & 0xF) != 0) return faceColor(season);
        return uint8((_sload(canvasBaseSlot(season) + slotIndex) >> shift) & 0xF);
    }

    // ---------------------------------------------------------------------
    // Built-in renderer 0
    // ---------------------------------------------------------------------

    function paletteColor(uint256 index) public pure returns (uint24) {
        if (index >= PALETTE_SIZE) revert PaletteIndexOutOfBounds(index);
        return _paletteColor(uint8(index));
    }

    function palette() external pure returns (uint24[16] memory colors) {
        for (uint8 i; i < 16; ++i) colors[i] = _paletteColor(i);
    }

    function renderBMP(uint256 tokenId) public view returns (bytes memory bmp) {
        if (tokenId == 0) {
            uint256 season = currentSeason();
            return _buildBMP(_compositeBottomUpLive(season), backgroundColor(season));
        }
        FrameInfoData storage info = _frames[tokenId];
        if (info.dataPointer == address(0)) revert FrameDoesNotExist(tokenId);
        return _buildBMP(
            _compositeStoredBackground(FrameStore.read(info.dataPointer), info.faceColor, info.season),
            info.backgroundColor
        );
    }

    function renderSVG(uint256 tokenId) public view returns (string memory) {
        bytes memory bmp = renderBMP(tokenId);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
            '<image width="1024" height="1024" style="image-rendering:pixelated" href="data:image/bmp;base64,',
            Base64.encode(bmp),
            '"/></svg>'
        );
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 rendererId = _tokenRenderer[tokenId];
        if (rendererId != 0 && rendererId < _renderers.length) {
            address renderer = _renderers[rendererId].renderer;
            try IFrameRenderer(renderer).tokenURI{gas: RENDERER_GAS_LIMIT}(address(this), tokenId) returns (string memory uri) {
                if (bytes(uri).length != 0) return uri;
            } catch {}
        }
        return _builtinTokenURI(tokenId);
    }

    function builtinTokenURI(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);
        return _builtinTokenURI(tokenId);
    }

    function _builtinTokenURI(uint256 tokenId) internal view returns (string memory) {
        string memory image = string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(renderSVG(tokenId))));

        if (tokenId == 0) {
            uint256 season = currentSeason();
            string memory json0 = string.concat(
                '{"name":"r3tards paint - live canvas","description":"paint monad. pay gas. try not to ruin it. r3tards is not a r3al proj3ct.","image":"',
                image,
                '","attributes":[{"trait_type":"Season","value":',
                (season + 1).toString(),
                '},{"trait_type":"Face","value":"',
                faceColor(season) == FACE_BLACK ? 'black' : 'white',
                '"},{"trait_type":"Background","value":"',
                _backgroundName(backgroundColor(season)),
                '"}',
                _seasonCharacterAttribute(season),
                ']}'
            );
            return string.concat("data:application/json;base64,", Base64.encode(bytes(json0)));
        }

        FrameInfoData storage f = _frames[tokenId];
        string memory kind = f.finale ? "season finale" : "frame";
        string memory json = string.concat(
            '{"name":"r3tards paint ',
            kind,
            ' #',
            tokenId.toString(),
            '","description":"a fully onchain frame from the shared r3tards paint canvas. it was free. the gas was not imaginary.","image":"',
            image,
            '","attributes":[',
            '{"trait_type":"Season","value":',
            (uint256(f.season) + 1).toString(),
            '},{"trait_type":"Frame","value":',
            uint256(f.frameNumber).toString(),
            '},{"trait_type":"Season frame","value":',
            uint256(f.seasonFrameIndex).toString(),
            '},{"trait_type":"Monad block","value":',
            uint256(f.blockNumber).toString(),
            '},{"trait_type":"DF1","value":',
            uint256(f.df1Amount).toString(),
            '},{"trait_type":"Paints since previous frame","value":',
            uint256(f.paintsSincePreviousFrame).toString(),
            '},{"trait_type":"Face","value":"',
            f.faceColor == FACE_BLACK ? 'black' : 'white',
            '"},{"trait_type":"Background","value":"',
            _backgroundName(f.backgroundColor),
            '"},{"trait_type":"Holder at mint","value":"',
            f.holderAtMint ? 'yes' : 'no',
            '"},{"trait_type":"Sealed by","value":"',
            _checksumAddress(f.proposer),
            '"},{"trait_type":"Storm","value":"',
            isStorm(f.blockNumber) ? 'yes' : 'no',
            '"}',
            _seasonCharacterAttribute(f.season),
            ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _checksumAddress(address account) internal pure returns (string memory) {
        bytes20 raw = bytes20(account);
        bytes memory lower = new bytes(40);
        bytes16 hexChars = "0123456789abcdef";
        for (uint256 i; i < 20; ++i) {
            uint8 b = uint8(raw[i]);
            lower[i * 2] = hexChars[b >> 4];
            lower[i * 2 + 1] = hexChars[b & 0x0f];
        }
        bytes32 h = keccak256(lower);
        bytes memory out = new bytes(42);
        out[0] = bytes1(uint8(0x30));
        out[1] = bytes1(uint8(0x78));
        for (uint256 i; i < 40; ++i) {
            bytes1 c = lower[i];
            uint8 nibble = (i & 1) == 0 ? uint8(h[i >> 1]) >> 4 : uint8(h[i >> 1]) & 0x0f;
            if (c >= 0x61 && c <= 0x66 && nibble >= 8) c = bytes1(uint8(c) - 32);
            out[i + 2] = c;
        }
        return string(out);
    }

    function _seasonCharacterAttribute(uint256 season) internal view returns (string memory) {
        SeasonOutlineData storage data = _seasonOutlines[season];
        bytes memory guest = bytes(data.guestName);
        if (guest.length != 0) {
            return string.concat(',{"trait_type":"Guest","value":"', _jsonEscape(data.guestName), '"}');
        }
        if (!data.custom) return ',{"trait_type":"Character","value":"r3tard"}';
        return "";
    }

    function _jsonEscape(string memory value) internal pure returns (string memory) {
        bytes memory src = bytes(value);
        uint256 extra;
        for (uint256 i; i < src.length; ++i) {
            if (src[i] == 0x22 || src[i] == 0x5c) ++extra;
        }
        if (extra == 0) return value;

        bytes memory out = new bytes(src.length + extra);
        uint256 j;
        for (uint256 i; i < src.length; ++i) {
            bytes1 c = src[i];
            if (c == 0x22 || c == 0x5c) out[j++] = 0x5c;
            out[j++] = c;
        }
        return string(out);
    }

    function _buildBMP(bytes memory bottomUpPixels, uint8 background) internal pure returns (bytes memory bmp) {
        uint256 pixelOffset = 118;
        bmp = new bytes(pixelOffset + CANVAS_BYTE_LENGTH);
        bmp[0] = 0x42;
        bmp[1] = 0x4d;
        _writeLE32(bmp, 2, uint32(bmp.length));
        _writeLE32(bmp, 10, uint32(pixelOffset));
        _writeLE32(bmp, 14, 40);
        _writeLE32(bmp, 18, 256);
        _writeLE32(bmp, 22, 256);
        _writeLE16(bmp, 26, 1);
        _writeLE16(bmp, 28, 4);
        _writeLE32(bmp, 34, uint32(CANVAS_BYTE_LENGTH));
        _writeLE32(bmp, 38, 2_835);
        _writeLE32(bmp, 42, 2_835);
        _writeLE32(bmp, 46, 16);
        _writeLE32(bmp, 50, 16);
        for (uint8 i; i < 16; ++i) {
            uint24 rgb = i == 0 ? _paletteColor(background) : _paletteColor(i);
            uint256 o = 54 + uint256(i) * 4;
            bmp[o] = bytes1(uint8(rgb));
            bmp[o + 1] = bytes1(uint8(rgb >> 8));
            bmp[o + 2] = bytes1(uint8(rgb >> 16));
        }
        _memcpy(bmp, pixelOffset, bottomUpPixels, 0, CANVAS_BYTE_LENGTH);
    }

    function _storeBackgroundFrame(uint256 season) internal returns (address pointer) {
        bytes memory init = FrameStore.allocateInit(CANVAS_BYTE_LENGTH);
        uint64[16] memory masks;
        for (uint8 region; region < 16; ++region) {
            masks[region] = uint64(_sload(regionPageSlot(season, region) + REGION_NONZERO_WORDS_OFFSET));
        }

        uint256 base = canvasBaseSlot(season);
        for (uint256 y; y < 256; ++y) {
            uint256 srcRow = 255 - y;
            uint256 regionRow = srcRow >> 6;
            uint64 rowBit = uint64(1) << uint64(srcRow & 63);
            for (uint256 sx; sx < 4; ++sx) {
                uint8 region = uint8(regionRow * 4 + sx);
                if ((masks[region] & rowBit) == 0) continue;
                uint256 word = _sload(base + srcRow * 4 + sx);
                uint256 o = 15 + y * 128 + sx * 32;
                assembly ("memory-safe") {
                    mstore(add(add(init, 0x20), o), word)
                }
            }
        }
        pointer = FrameStore.writePrepared(init);
    }

    function _backgroundBottomUp(uint256 season) internal view returns (bytes memory out) {
        out = new bytes(CANVAS_BYTE_LENGTH);
        uint64[16] memory masks;
        for (uint8 region; region < 16; ++region) {
            masks[region] = uint64(_sload(regionPageSlot(season, region) + REGION_NONZERO_WORDS_OFFSET));
        }

        uint256 base = canvasBaseSlot(season);
        for (uint256 y; y < 256; ++y) {
            uint256 srcRow = 255 - y;
            uint256 regionRow = srcRow >> 6;
            uint64 rowBit = uint64(1) << uint64(srcRow & 63);
            for (uint256 sx; sx < 4; ++sx) {
                uint8 region = uint8(regionRow * 4 + sx);
                if ((masks[region] & rowBit) == 0) continue;
                uint256 word = _sload(base + srcRow * 4 + sx);
                uint256 o = y * 128 + sx * 32;
                assembly ("memory-safe") {
                    mstore(add(add(out, 0x20), o), word)
                }
            }
        }
    }

    function _compositeBottomUpLive(uint256 season) internal view returns (bytes memory out) {
        out = new bytes(CANVAS_BYTE_LENGTH);
        uint256 base = canvasBaseSlot(season);
        uint256 outlineBase = _outlineBase(season);
        uint256[4] memory outlineBits = _outlineBitmaps(season);
        uint64[16] memory backgroundBits;
        for (uint8 region; region < 16; ++region) {
            backgroundBits[region] = uint64(_sload(regionPageSlot(season, region) + REGION_NONZERO_WORDS_OFFSET));
        }

        uint256 faceWord = _repeatNibble(faceColor(season));
        for (uint256 y; y < 256; ++y) {
            uint256 srcRow = 255 - y;
            uint256 regionRow = srcRow >> 6;
            uint64 rowBit = uint64(1) << uint64(srcRow & 63);
            for (uint256 sx; sx < 4; ++sx) {
                uint256 slotIndex = srcRow * 4 + sx;
                uint8 region = uint8(regionRow * 4 + sx);
                bool hasBackground = (backgroundBits[region] & rowBit) != 0;
                bool hasOutline = (outlineBits[slotIndex >> 8] & (uint256(1) << (slotIndex & 255))) != 0;
                if (!hasBackground && !hasOutline) continue;

                uint256 bg = hasBackground ? _sload(base + slotIndex) : 0;
                uint256 mask = hasOutline ? _sload(outlineBase + slotIndex) : 0;
                uint256 word = (bg & ~mask) | (faceWord & mask);
                uint256 o = y * 128 + sx * 32;
                assembly ("memory-safe") { mstore(add(add(out, 0x20), o), word) }
            }
        }
    }

    function _compositeStoredBackground(bytes memory bottomUpBackground, uint8 face, uint256 season)
        internal
        view
        returns (bytes memory out)
    {
        out = bottomUpBackground;
        uint256 outlineBase = _outlineBase(season);
        uint256[4] memory outlineBits = _outlineBitmaps(season);
        uint256 faceWord = _repeatNibble(face);
        for (uint256 y; y < 256; ++y) {
            uint256 srcRow = 255 - y;
            for (uint256 sx; sx < 4; ++sx) {
                uint256 slotIndex = srcRow * 4 + sx;
                if ((outlineBits[slotIndex >> 8] & (uint256(1) << (slotIndex & 255))) == 0) continue;
                uint256 o = y * 128 + sx * 32;
                uint256 bg;
                assembly ("memory-safe") { bg := mload(add(add(out, 0x20), o)) }
                uint256 mask = _sload(outlineBase + slotIndex);
                uint256 word = (bg & ~mask) | (faceWord & mask);
                assembly ("memory-safe") { mstore(add(add(out, 0x20), o), word) }
            }
        }
    }

    function _outlineOnlyBottomUp(uint256 season, uint8 face) internal view returns (bytes memory out) {
        out = new bytes(CANVAS_BYTE_LENGTH);
        uint256 outlineBase = _outlineBase(season);
        uint256[4] memory outlineBits = _outlineBitmaps(season);
        uint256 faceWord = _repeatNibble(face);
        for (uint256 slotIndex; slotIndex < CANVAS_SLOT_COUNT; ++slotIndex) {
            if ((outlineBits[slotIndex >> 8] & (uint256(1) << (slotIndex & 255))) == 0) continue;
            uint256 srcRow = slotIndex >> 2;
            uint256 sx = slotIndex & 3;
            uint256 y = 255 - srcRow;
            uint256 word = faceWord & _sload(outlineBase + slotIndex);
            uint256 o = y * 128 + sx * 32;
            assembly ("memory-safe") { mstore(add(add(out, 0x20), o), word) }
        }
    }

    function _paletteColor(uint8 index) internal pure returns (uint24) {
        if (index == 0) return 0xFFFFFF;
        if (index == 1) return 0x000000;
        if (index == 2) return 0x965E4B;
        if (index == 3) return 0x877549;
        if (index == 4) return 0xC52020;
        if (index == 5) return 0xFEC343;
        if (index == 6) return 0xEE93E3;
        if (index == 7) return 0xFFFFFF;
        if (index == 8) return 0x07992F;
        if (index == 9) return 0xA0055D;
        if (index == 10) return 0x694B87;
        if (index == 11) return 0x5FEDDF;
        if (index == 12) return 0xF7931A;
        if (index == 13) return 0xC864AA;
        if (index == 14) return 0x9F70DA;
        return 0xD47827;
    }

    function _backgroundName(uint8 color) internal pure returns (string memory) {
        if (color == 0) return "white";
        if (color == 5) return "gold";
        if (color == 6) return "og";
        if (color == 8) return "green";
        if (color == 9) return "nad";
        if (color == 10) return "purple";
        return "DF1 cyan";
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _canvasFingerprint(uint256 season) internal view returns (bytes32 h) {
        h = keccak256(abi.encodePacked(season, _seasons[season].styleVersion));
        for (uint8 region; region < 16; ++region) {
            (,,, uint48 changeCounter,,) =
                _unpackRegionSummary(_sload(regionPageSlot(season, region) + REGION_SUMMARY_OFFSET));
            h = keccak256(abi.encodePacked(h, changeCounter));
        }
    }

    function _seasonPrimaryPaintTotal(uint256 season) internal view returns (uint256 total) {
        for (uint8 region; region < 16; ++region) {
            (,,,, uint48 primaryPaints,) =
                _unpackRegionSummary(_sload(regionPageSlot(season, region) + REGION_SUMMARY_OFFSET));
            total += primaryPaints;
        }
    }

    function _maxPressureAllRegions(uint256 season) internal view returns (uint256 p) {
        for (uint8 region; region < 16; ++region) {
            uint256 rp = _pressure(season, region);
            if (rp > p) p = rp;
        }
    }

    function _lowestRegion(uint16 mask) internal pure returns (uint8) {
        for (uint8 i; i < 16; ++i) if ((mask & (uint16(1) << i)) != 0) return i;
        return 0;
    }

    function _packRegionSummary(
        uint48 capBlock,
        uint16 pixelsInBlock,
        uint48 totalPaints,
        uint48 changeCounter,
        uint48 primaryPaints
    ) internal pure returns (uint256) {
        return uint256(capBlock)
            | (uint256(pixelsInBlock) << 48)
            | (uint256(totalPaints) << 64)
            | (uint256(changeCounter) << 112)
            | (uint256(primaryPaints) << 160);
    }

    function _unpackRegionSummary(uint256 packed) internal pure returns (
        uint48 capBlock,
        uint16 pixelsInBlock,
        uint48 totalPaints,
        uint48 changeCounter,
        uint48 primaryPaints,
        uint48 unused
    ) {
        capBlock = uint48(packed);
        pixelsInBlock = uint16(packed >> 48);
        totalPaints = uint48(packed >> 64);
        changeCounter = uint48(packed >> 112);
        primaryPaints = uint48(packed >> 160);
        unused = 0;
    }

    function _nibbleRangeMask(uint256 startLocal, uint256 endLocal) internal pure returns (uint256) {
        uint256 nibbles = endLocal - startLocal + 1;
        uint256 width = nibbles << 2;
        uint256 lowShift = (63 - endLocal) << 2;
        if (width == 256) return type(uint256).max;
        return ((uint256(1) << width) - 1) << lowShift;
    }

    function _nibbleNonZeroLsb(uint256 x) internal pure returns (uint256) {
        return (x | (x >> 1) | (x >> 2) | (x >> 3)) & NIBBLE_LSB;
    }

    function _expand16ToNibbleLsb(uint16 x) internal pure returns (uint64 v) {
        v = x;
        v = (v | (v << 24)) & 0x000000FF000000FF;
        v = (v | (v << 12)) & 0x000F000F000F000F;
        v = (v | (v << 6)) & 0x0303030303030303;
        v = (v | (v << 3)) & 0x1111111111111111;
    }

    function _compactNibbleLsb(uint64 v) internal pure returns (uint16) {
        v &= 0x1111111111111111;
        v = (v | (v >> 3)) & 0x0303030303030303;
        v = (v | (v >> 6)) & 0x000F000F000F000F;
        v = (v | (v >> 12)) & 0x000000FF000000FF;
        v = (v | (v >> 24)) & 0x000000000000FFFF;
        return uint16(v);
    }

    function _compactNibbleLsb64(uint256 v) internal pure returns (uint64 out) {
        for (uint256 c; c < 4; ++c) {
            uint64 chunk = uint64(v >> ((3 - c) * 64));
            out |= uint64(_compactNibbleLsb(chunk)) << uint64((3 - c) * 16);
        }
    }

    function _reverse16(uint16 x) internal pure returns (uint16) {
        x = uint16(((x & 0x5555) << 1) | ((x >> 1) & 0x5555));
        x = uint16(((x & 0x3333) << 2) | ((x >> 2) & 0x3333));
        x = uint16(((x & 0x0F0F) << 4) | ((x >> 4) & 0x0F0F));
        return uint16((x << 8) | (x >> 8));
    }

    function _popcount64(uint64 x) internal pure returns (uint256) {
        unchecked {
            x = x - ((x >> 1) & 0x5555555555555555);
            x = (x & 0x3333333333333333) + ((x >> 2) & 0x3333333333333333);
            x = (x + (x >> 4)) & 0x0F0F0F0F0F0F0F0F;
            return uint256((x * 0x0101010101010101) >> 56);
        }
    }

    function _selectSetBit(uint256 mask, uint256 rank) internal pure returns (uint256 pos) {
        // Only used for <=32 DF1 corruptions. Iterating set bits here is intentionally bounded.
        while (true) {
            uint256 lsb = mask & (~mask + 1);
            if (rank == 0) {
                while (lsb > 1) {
                    lsb >>= 1;
                    ++pos;
                }
                return pos;
            }
            mask ^= lsb;
            --rank;
        }
    }

    function _repeatNibble(uint8 color) internal pure returns (uint256 word) {
        word = uint256(color) * NIBBLE_LSB;
    }

    function _seedOutlineNibbleMask() internal {
        uint256[1024] memory words;
        uint256[4] memory bitmaps;
        uint256 len = _OUTLINE_RUNS.length;
        for (uint256 o; o < len; o += 3) {
            uint256 y = uint8(_OUTLINE_RUNS[o]);
            uint256 x0 = uint8(_OUTLINE_RUNS[o + 1]);
            uint256 x1 = uint8(_OUTLINE_RUNS[o + 2]);
            uint256 first = x0 >> 6;
            uint256 last = x1 >> 6;
            for (uint256 sx = first; sx <= last; ++sx) {
                uint256 startX = sx == first ? x0 : sx * 64;
                uint256 endX = sx == last ? x1 : sx * 64 + 63;
                uint256 slotIndex = y * 4 + sx;
                words[slotIndex] |= _nibbleRangeMask(startX & 63, endX & 63);
                bitmaps[slotIndex >> 8] |= uint256(1) << (slotIndex & 255);
            }
        }
        for (uint256 i; i < CANVAS_SLOT_COUNT; ++i) {
            if (words[i] != 0) _sstore(OUTLINE_BASE_SLOT + i, words[i]);
        }
        for (uint256 i; i < 4; ++i) _defaultOutlineWordBitmap[i] = bitmaps[i];
    }

    function _sload(uint256 slot) internal view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) internal {
        assembly ("memory-safe") { sstore(slot, value) }
    }

    function _writeLE16(bytes memory data, uint256 o, uint16 v) internal pure {
        data[o] = bytes1(uint8(v));
        data[o + 1] = bytes1(uint8(v >> 8));
    }

    function _writeLE32(bytes memory data, uint256 o, uint32 v) internal pure {
        data[o] = bytes1(uint8(v));
        data[o + 1] = bytes1(uint8(v >> 8));
        data[o + 2] = bytes1(uint8(v >> 16));
        data[o + 3] = bytes1(uint8(v >> 24));
    }

    function _memcpy(bytes memory dst, uint256 dstOffset, bytes memory src, uint256 srcOffset, uint256 len) internal pure {
        for (uint256 i; i < len; i += 32) {
            bytes32 word;
            assembly ("memory-safe") { word := mload(add(add(src, 0x20), add(srcOffset, i))) }
            assembly ("memory-safe") { mstore(add(add(dst, 0x20), add(dstOffset, i)), word) }
        }
    }

    function _copyBytes(bytes memory dst, uint256 dstOffset, bytes memory src, uint256 srcOffset, uint256 len)
        internal
        pure
    {
        uint256 words = len & ~uint256(31);
        for (uint256 i; i < words; i += 32) {
            bytes32 word;
            assembly ("memory-safe") { word := mload(add(add(src, 0x20), add(srcOffset, i))) }
            assembly ("memory-safe") { mstore(add(add(dst, 0x20), add(dstOffset, i)), word) }
        }
        for (uint256 i = words; i < len; ++i) dst[dstOffset + i] = src[srcOffset + i];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }
}

