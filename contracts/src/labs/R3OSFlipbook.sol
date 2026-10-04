// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "solady/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IR3OSPaintData} from "../interfaces/IR3OSPaintData.sol";
import {IStampSource} from "../interfaces/IStampSource.sol";
import {ILabTokenSource} from "../interfaces/ILabTokenSource.sol";
import {R3OSLabs} from "../R3OSLabs.sol";
import {LabTraits} from "../lib/LabTraits.sol";
import {FrameStore} from "../lib/FrameStore.sol";

/// @notice Disposable Lab experiment: one 32x32 animation frame per Monad block.
/// @dev No owner and no admin functions. A new version means a new Lab deployment.
contract R3OSFlipbook is IStampSource, ILabTokenSource {
    using Strings for uint256;

    uint256 public constant SIZE = 32;
    uint256 public constant FRAME_WORDS = 16;
    uint256 public constant RING_FRAMES = 32;
    uint256 public constant MAX_RUNS_PER_PAINT = 32;
    uint256 public constant MAX_PIXELS_PER_PAINT = 64;
    uint256 public constant INK_WINDOW_BLOCKS = 200;
    uint256 public constant NEW_WALLET_INK = 64;
    uint256 public constant PAINTER_INK = 256;
    uint256 public constant MIN_REEL_FRAMES = 8;
    uint256 public constant MIN_NEW_FRAMES_PER_REEL = 32;
    uint256 public constant REEL_COOLDOWN_BLOCKS = 12_000;
    uint256 public constant MAX_GAP_TICKS = 8;
    uint256 public constant HOLD_LAST_TICKS = 4;
    uint256 public constant FLIPBOOK_STAMP_FRAMES = 10;

    uint256 public constant FRAMES_BASE = uint256(keccak256("r3tards.flipbook.frames")) & ~uint256(127);
    uint256 public constant META_BASE = uint256(keccak256("r3tards.flipbook.meta")) & ~uint256(127);

    uint256 private constant NIBBLE_ONES =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    /// @dev Frame words are stored XOR this constant so white rows are never zero slots.
    uint256 private constant FRAME_XOR =
        0xA5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5;
    uint256 private constant BMP_OFFSET = 118;
    uint256 private constant BMP_BYTES = 630;
    uint256 private constant FRAME_BYTES = 512;
    uint256 private constant META_BYTES = 29;
    uint256 private constant FRAMESTORE_DATA_OFFSET = 15;
    uint256 private constant SVG_CAPACITY = 80_000;

    IR3OSPaintData public immutable PAINT;
    R3OSLabs public immutable LABS;
    uint64 public immutable OPEN_TIME;
    uint256 public immutable TICK_MS;

    uint64 public frameCount;
    uint48 public lastFrameBlock;
    uint64 public lastReelEndFrame;
    uint256 public experimentId = type(uint256).max;

    struct PainterData {
        uint48 lastPaintBlock;
        uint48 inkWindowStart;
        uint16 inkUsed;
        uint64 lastFrameNumberPlusOne;
        uint32 framesPainted;
        uint48 lastReelBlock;
    }

    struct Reel {
        address pointer;
        uint64 firstFrame;
        uint8 count;
        uint256 traitData;
    }

    struct ReelTraitsData {
        uint48 firstBlock;
        uint48 lastBlock;
        uint48 longestEmptyBlocks;
        uint48 mintBlock;
        uint32 totalPixels;
        uint16 totalTicks;
        uint8 validators;
        uint8 busiestPainters;
        uint8 stormFrames;
        uint8 dominantColour;
        uint8 coloursUsed;
    }

    mapping(address => PainterData) private _painters;
    mapping(uint256 => Reel) private _reels;

    error ZeroAddress();
    error InvalidConfig();
    error NotOpenYet();
    error InvalidRunsLength();
    error InvalidRun(uint256 runIndex);
    error TooManyRuns();
    error TooManyPixels();
    error AlreadyPaintedThisBlock();
    error InsufficientInk(uint256 needed, uint256 available);
    error NoChange();
    error FrameExpired(uint64 frameNumber);
    error ReelDoesNotExist(uint256 id);
    error SessionKeyPaintOnly();
    error NotEnoughFrames();
    error ReelTooSoon(uint256 minimumEndFrame);
    error NotInReel();
    error CooldownActive(uint256 untilBlock);
    error ExperimentAlreadyBound();
    error InvalidExperiment(uint256 experimentId);
    error ExperimentNotBound();

    event FrameStarted(uint64 indexed frameNumber, uint256 indexed blockNumber, address indexed proposer);
    event FlipbookPainted(
        uint64 indexed frameNumber,
        address indexed owner,
        address indexed sender,
        bytes runs,
        uint16 pixels
    );
    event ReelMinted(uint256 indexed id, address indexed minter, uint64 firstFrame, uint64 lastFrame);

    constructor(address paintCore, address labs, uint64 openTime, uint256 tickMs, bytes memory genesis) {
        if (paintCore == address(0) || labs == address(0)) revert ZeroAddress();
        if (tickMs == 0 || genesis.length != FRAME_BYTES) revert InvalidConfig();

        PAINT = IR3OSPaintData(paintCore);
        LABS = R3OSLabs(labs);
        OPEN_TIME = openTime;
        TICK_MS = tickMs;

        _writeGenesis(genesis);
        _storeMeta(0, uint48(block.number), block.coinbase, 0, 0);
        // Pre-fill the whole 32-frame ring with the encoded genesis so first-use writes
        // are updates instead of zero-to-nonzero storage growth. Views never expose
        // frames before frameCount, so the sentinel metadata cannot leak.
        for (uint256 r = 1; r < RING_FRAMES; ++r) {
            for (uint256 i; i < FRAME_WORDS; ++i) {
                _sstore(FRAMES_BASE + r * FRAME_WORDS + i, _sload(FRAMES_BASE + i));
            }
            _sstore(META_BASE + r, 1);
        }
        frameCount = 1;
        lastFrameBlock = uint48(block.number);
        lastReelEndFrame = type(uint64).max;
    }

    function bindExperimentId(uint256 id) external {
        if (experimentId != type(uint256).max) revert ExperimentAlreadyBound();
        IR3OSPaintData.ExperimentData memory info_ = PAINT.experimentInfo(id);
        (address experiment, bool retired) = (info_.experiment, info_.retired);
        if (experiment != address(this) || retired) revert InvalidExperiment(id);
        experimentId = id;
    }

    /// @notice Legacy Lab-specific ownership metric used by the Reel Maker quest.
    function balanceOf(address owner) external view returns (uint256) {
        uint256 id = experimentId;
        return id == type(uint256).max ? 0 : LABS.balanceOfExperiment(id, owner);
    }

    // ---------------------------------------------------------------------
    // Painting
    // ---------------------------------------------------------------------

    function paint(bytes calldata runs) external {
        if (block.timestamp < OPEN_TIME) revert NotOpenYet();
        (uint16 pixels, uint16 touchedWords) = _validateRuns(runs);
        address owner_ = _resolveOwner(msg.sender);
        PainterData storage painter = _painters[owner_];
        if (painter.lastPaintBlock == block.number) revert AlreadyPaintedThisBlock();

        (uint256 available,,) = _inkAvailable(owner_, painter);
        if (pixels > available) revert InsufficientInk(pixels, available);

        if (block.number >= uint256(painter.inkWindowStart) + INK_WINDOW_BLOCKS) {
            painter.inkWindowStart = uint48(block.number);
            painter.inkUsed = 0;
        }

        uint64 f;
        if (lastFrameBlock != block.number) {
            f = frameCount;
            uint256[FRAME_WORDS] memory words;
            uint64 previous = f - 1;
            uint256 previousBase = _frameBase(previous);
            for (uint256 i; i < FRAME_WORDS; ++i) words[i] = _loadFrameWord(previousBase + i);

            bool changed = _applyRunsMemory(words, runs);
            if (!changed) revert NoChange();

            uint256 base = _frameBase(f);
            for (uint256 i; i < FRAME_WORDS; ++i) _storeFrameWord(base + i, words[i]);
            _storeMeta(f, uint48(block.number), block.coinbase, pixels, 1);
            frameCount = f + 1;
            lastFrameBlock = uint48(block.number);
            emit FrameStarted(f, block.number, block.coinbase);
        } else {
            f = frameCount - 1;
            bool changed = _applyRunsStorage(f, runs, touchedWords);
            if (!changed) revert NoChange();

            (uint48 metaBlock, address proposer, uint16 oldPixels, uint8 oldPainters) = _loadMeta(f);
            uint16 totalPixels = oldPixels + pixels;
            uint8 totalPainters = oldPainters == type(uint8).max ? oldPainters : oldPainters + 1;
            _storeMeta(f, metaBlock, proposer, totalPixels, totalPainters);
        }

        painter.lastPaintBlock = uint48(block.number);
        painter.inkUsed = uint16(uint256(painter.inkUsed) + pixels);
        if (painter.lastFrameNumberPlusOne != f + 1) {
            painter.lastFrameNumberPlusOne = f + 1;
            ++painter.framesPainted;
        }

        emit FlipbookPainted(f, owner_, msg.sender, runs, pixels);
    }

    function _validateRuns(bytes calldata runs) internal pure returns (uint16 pixels, uint16 touchedWords) {
        if (runs.length == 0 || runs.length % 4 != 0) revert InvalidRunsLength();
        uint256 runCount = runs.length / 4;
        if (runCount > MAX_RUNS_PER_PAINT) revert TooManyRuns();

        uint256 total;
        uint16 touched;
        for (uint256 i; i < runCount; ++i) {
            uint256 o = i * 4;
            uint8 y = uint8(runs[o]);
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            if (y >= SIZE || x0 > x1 || x1 >= SIZE || color >= 16) revert InvalidRun(i);
            total += uint256(x1) - x0 + 1;
            touched |= uint16(1) << uint16(y >> 1);
        }
        if (total > MAX_PIXELS_PER_PAINT) revert TooManyPixels();
        return (uint16(total), touched);
    }

    function _applyRunsMemory(uint256[FRAME_WORDS] memory words, bytes calldata runs)
        internal
        pure
        returns (bool changed)
    {
        uint256 runCount = runs.length / 4;
        for (uint256 i; i < runCount; ++i) {
            uint256 o = i * 4;
            uint8 y = uint8(runs[o]);
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            uint256 wi = y >> 1;
            uint256 beforeWord = words[wi];
            uint256 afterWord = _applyRun(beforeWord, y, x0, x1, color);
            if (afterWord != beforeWord) {
                words[wi] = afterWord;
                changed = true;
            }
        }
    }

    function _applyRunsStorage(uint64 frameNumber, bytes calldata runs, uint16 touchedWords)
        internal
        returns (bool changed)
    {
        uint256[FRAME_WORDS] memory beforeWords;
        uint256[FRAME_WORDS] memory words;
        uint256 base = _frameBase(frameNumber);
        for (uint256 wi; wi < FRAME_WORDS; ++wi) {
            if ((touchedWords & (uint16(1) << uint16(wi))) == 0) continue;
            uint256 word = _loadFrameWord(base + wi);
            beforeWords[wi] = word;
            words[wi] = word;
        }

        uint256 runCount = runs.length / 4;
        for (uint256 i; i < runCount; ++i) {
            uint256 o = i * 4;
            uint8 y = uint8(runs[o]);
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            uint256 wi = y >> 1;
            words[wi] = _applyRun(words[wi], y, x0, x1, color);
        }

        for (uint256 wi; wi < FRAME_WORDS; ++wi) {
            if ((touchedWords & (uint16(1) << uint16(wi))) == 0) continue;
            if (words[wi] != beforeWords[wi]) {
                _storeFrameWord(base + wi, words[wi]);
                changed = true;
            }
        }
    }

    function _applyRun(uint256 word, uint8 y, uint8 x0, uint8 x1, uint8 color)
        internal
        pure
        returns (uint256)
    {
        uint256 widthBits = (uint256(x1) - x0 + 1) * 4;
        uint256 shift = 252 - ((uint256(y & 1) * 128) + uint256(x1) * 4);
        uint256 lowMask = widthBits == 256 ? type(uint256).max : (uint256(1) << widthBits) - 1;
        uint256 mask = lowMask << shift;
        return (word & ~mask) | ((NIBBLE_ONES * color) & mask);
    }

    function _resolveOwner(address sender) internal view returns (address owner_) {
        (address sessionOwner,,,,, bool active) = PAINT.sessionInfo(sender);
        return active ? sessionOwner : sender;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function frame(uint64 f)
        public
        view
        returns (bytes memory pixels512, uint48 blockNumber, address proposer, uint16 pixels, uint8 painters)
    {
        _requireFrame(f);
        pixels512 = _frameBytes(f);
        (blockNumber, proposer, pixels, painters) = _loadMeta(f);
    }

    function recentFrames(uint256 n)
        external
        view
        returns (
            uint64 firstFrame,
            bytes memory pixels,
            uint48[] memory blocks,
            address[] memory proposers,
            uint16[] memory pixelCounts,
            uint8[] memory painterCounts
        )
    {
        uint256 count = frameCount;
        uint256 take = n;
        if (take > RING_FRAMES) take = RING_FRAMES;
        if (take > count) take = count;
        firstFrame = uint64(count - take);
        pixels = new bytes(take * FRAME_BYTES);
        blocks = new uint48[](take);
        proposers = new address[](take);
        pixelCounts = new uint16[](take);
        painterCounts = new uint8[](take);

        for (uint256 i; i < take; ++i) {
            uint64 f = firstFrame + uint64(i);
            uint256 base = _frameBase(f);
            uint256 dstOffset = i * FRAME_BYTES;
            for (uint256 wi; wi < FRAME_WORDS; ++wi) {
                uint256 word = _loadFrameWord(base + wi);
                assembly ("memory-safe") {
                    mstore(add(add(pixels, 0x20), add(dstOffset, mul(wi, 0x20))), word)
                }
            }
            (blocks[i], proposers[i], pixelCounts[i], painterCounts[i]) = _loadMeta(f);
        }
    }

    function painterInfo(address painter)
        external
        view
        returns (
            uint48 lastPaintBlock,
            uint48 inkWindowStart,
            uint16 inkUsed,
            uint64 lastFrameNumberPlusOne,
            uint32 framesPainted,
            uint48 lastReelBlock
        )
    {
        PainterData storage p = _painters[painter];
        return (p.lastPaintBlock, p.inkWindowStart, p.inkUsed, p.lastFrameNumberPlusOne, p.framesPainted, p.lastReelBlock);
    }

    function inkAvailable(address owner_) external view returns (uint256 available, uint256 limit, uint256 windowResetsAtBlock) {
        return _inkAvailable(owner_, _painters[owner_]);
    }

    function _inkAvailable(address owner_, PainterData storage p)
        internal
        view
        returns (uint256 available, uint256 limit, uint256 windowResetsAtBlock)
    {
        limit = PAINT.daysPainted(owner_) >= 1 ? PAINTER_INK : NEW_WALLET_INK;
        if (block.number >= uint256(p.inkWindowStart) + INK_WINDOW_BLOCKS) {
            available = limit;
            windowResetsAtBlock = block.number + INK_WINDOW_BLOCKS;
        } else {
            uint256 used = p.inkUsed;
            available = used >= limit ? 0 : limit - used;
            windowResetsAtBlock = uint256(p.inkWindowStart) + INK_WINDOW_BLOCKS;
        }
    }

    function reelInfo(uint256 id) external view returns (address pointer, uint64 firstFrame, uint8 count, uint48 mintBlock) {
        Reel storage reel = _reels[id];
        if (reel.pointer == address(0)) revert ReelDoesNotExist(id);
        return (reel.pointer, reel.firstFrame, reel.count, _unpackReelTraits(reel.traitData).mintBlock);
    }

    function reelData(uint256 id) public view returns (bytes memory) {
        Reel storage reel = _reels[id];
        if (reel.pointer == address(0)) revert ReelDoesNotExist(id);
        return FrameStore.read(reel.pointer);
    }

    // ---------------------------------------------------------------------
    // Reel minting
    // ---------------------------------------------------------------------

    function mintReel() external returns (uint256 id) {
        if (PAINT.isActiveSessionKey(msg.sender)) revert SessionKeyPaintOnly();
        uint256 count = frameCount;
        if (count > RING_FRAMES) count = RING_FRAMES;
        if (count < MIN_REEL_FRAMES) revert NotEnoughFrames();

        uint64 end = frameCount - 1;
        uint64 first = frameCount - uint64(count);
        if (lastReelEndFrame != type(uint64).max) {
            uint256 minimumEnd = uint256(lastReelEndFrame) + MIN_NEW_FRAMES_PER_REEL;
            if (end < minimumEnd) revert ReelTooSoon(minimumEnd);
        }

        PainterData storage painter = _painters[msg.sender];
        if (painter.lastFrameNumberPlusOne == 0 || painter.lastFrameNumberPlusOne - 1 < first) revert NotInReel();
        if (painter.lastReelBlock != 0 && block.number < uint256(painter.lastReelBlock) + REEL_COOLDOWN_BLOCKS) {
            revert CooldownActive(uint256(painter.lastReelBlock) + REEL_COOLDOWN_BLOCKS);
        }

        (bytes memory snapshot, ReelTraitsData memory traits) = _snapshot(first, uint8(count));
        bytes memory init = FrameStore.allocateInit(snapshot.length);
        assembly ("memory-safe") {
            let src := add(snapshot, 0x20)
            let dst := add(add(init, 0x20), FRAMESTORE_DATA_OFFSET)
            let length := mload(snapshot)
            for { let o := 0 } lt(o, length) { o := add(o, 0x20) } {
                mstore(add(dst, o), mload(add(src, o)))
            }
        }
        address pointer = FrameStore.writePrepared(init);

        uint256 boundExperimentId = experimentId;
        if (boundExperimentId == type(uint256).max) revert ExperimentNotBound();
        traits.mintBlock = uint48(block.number);
        // forge-lint: disable-next-line(reentrancy-no-eth)
        id = LABS.mint(msg.sender, boundExperimentId);
        _reels[id] = Reel({
            pointer: pointer,
            firstFrame: first,
            count: uint8(count),
            traitData: _packReelTraits(traits)
        });
        lastReelEndFrame = end;
        painter.lastReelBlock = uint48(block.number);
        emit ReelMinted(id, msg.sender, first, end);
    }

    function _snapshot(uint64 first, uint8 count)
        internal
        view
        returns (bytes memory out, ReelTraitsData memory traits)
    {
        uint256 frameSection = uint256(count) * FRAME_BYTES;
        out = new bytes(1 + frameSection + uint256(count) * META_BYTES);
        out[0] = bytes1(count);
        address[32] memory validatorsSeen;
        uint256[16] memory colourCounts;
        uint256 validatorsSeenCount;
        uint48 previousBlock;

        for (uint256 i; i < count; ++i) {
            uint64 f = first + uint64(i);
            uint256 frameDst = 1 + i * FRAME_BYTES;
            uint256 base = _frameBase(f);
            for (uint256 wi; wi < FRAME_WORDS; ++wi) {
                uint256 word = _loadFrameWord(base + wi);
                bool countColours = i + 1 == count; // reel colour traits describe the final frame
                assembly ("memory-safe") {
                    mstore(add(add(out, 0x20), add(frameDst, mul(wi, 0x20))), word)
                    for { let px := 0 } lt(px, mul(64, countColours)) { px := add(px, 1) } {
                        let colour := and(word, 0x0f)
                        let slot := add(colourCounts, shl(5, colour))
                        mstore(slot, add(mload(slot), 1))
                        word := shr(4, word)
                    }
                }
            }

            (uint48 blockNumber, address proposer, uint16 pixels, uint8 painters) = _loadMeta(f);
            uint256 metaDst = 1 + frameSection + i * META_BYTES;
            _writeBE48(out, metaDst, blockNumber);
            _writeAddress(out, metaDst + 6, proposer);
            _writeBE16(out, metaDst + 26, pixels);
            out[metaDst + 28] = bytes1(painters);

            traits.totalPixels += pixels;
            if (painters > traits.busiestPainters) traits.busiestPainters = painters;
            if (PAINT.isStorm(blockNumber)) ++traits.stormFrames;

            bool seen;
            for (uint256 j; j < validatorsSeenCount; ++j) {
                if (validatorsSeen[j] == proposer) {
                    seen = true;
                    break;
                }
            }
            if (!seen) validatorsSeen[validatorsSeenCount++] = proposer;

            if (i == 0) {
                traits.firstBlock = blockNumber;
            } else {
                uint256 delta = uint256(blockNumber) - uint256(previousBlock);
                uint256 emptyBlocks = delta > 1 ? delta - 1 : 0;
                if (emptyBlocks > traits.longestEmptyBlocks) traits.longestEmptyBlocks = uint48(emptyBlocks);
                if (delta < 1) delta = 1;
                if (delta > MAX_GAP_TICKS) delta = MAX_GAP_TICKS;
                traits.totalTicks += uint16(delta);
            }
            previousBlock = blockNumber;
        }

        traits.lastBlock = previousBlock;
        traits.totalTicks += uint16(HOLD_LAST_TICKS);
        traits.validators = uint8(validatorsSeenCount);
        (traits.dominantColour, traits.coloursUsed) = _colourStats(colourCounts);
    }

    // ---------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------

    function labToken(uint256 id) external view returns (
        string memory kind,
        string memory description,
        bytes memory imageSvg,
        string memory attributes,
        uint8 dominantColour,
        uint8 coloursUsed
    ) {
        Reel storage reel = _reels[id];
        if (reel.pointer == address(0)) revert ReelDoesNotExist(id);
        bytes memory snapshot = FrameStore.read(reel.pointer);
        uint256 count = uint8(snapshot[0]);
        uint24[16] memory colors = PAINT.palette();
        ReelTraitsData memory traits = _unpackReelTraits(reel.traitData);
        uint256 totalTicks = traits.totalTicks;
        uint256[] memory starts = _timingStarts(snapshot, count, totalTicks);
        uint256 totalMs = totalTicks * TICK_MS;
        uint256 longestHoldMs = uint256(traits.longestEmptyBlocks) * TICK_MS;

        bytes memory svg = new bytes(SVG_CAPACITY);
        uint256 cursor;
        cursor = _append(
            svg,
            cursor,
            bytes('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">')
        );
        cursor = _append(svg, cursor, bytes('<style>.f{opacity:0}'));
        for (uint256 i; i < count; ++i) {
            uint256 endPm = i + 1 < count ? starts[i + 1] : 1000;
            cursor = _append(svg, cursor, bytes("@keyframes a"));
            cursor = _append(svg, cursor, bytes(i.toString()));
            if (i == 0) {
                cursor = _append(svg, cursor, bytes("{0%{opacity:1}"));
            } else {
                cursor = _append(svg, cursor, bytes("{0%{opacity:0}"));
                cursor = _append(svg, cursor, _perMille(starts[i]));
                cursor = _append(svg, cursor, bytes("{opacity:1}"));
            }
            cursor = _append(svg, cursor, _perMille(endPm));
            cursor = _append(svg, cursor, bytes(",100%{opacity:0}}.a"));
            cursor = _append(svg, cursor, bytes(i.toString()));
            cursor = _append(svg, cursor, bytes("{animation:a"));
            cursor = _append(svg, cursor, bytes(i.toString()));
            cursor = _append(svg, cursor, bytes(" "));
            cursor = _append(svg, cursor, bytes(totalMs.toString()));
            cursor = _append(svg, cursor, bytes("ms steps(1,end) infinite}"));
        }
        cursor = _append(svg, cursor, bytes("</style>"));

        for (uint256 i; i < count; ++i) {
            bytes memory bmp = _snapshotBMP(snapshot, 1 + i * FRAME_BYTES, colors);
            cursor = _append(svg, cursor, bytes('<image class="f a'));
            cursor = _append(svg, cursor, bytes(i.toString()));
            cursor = _append(
                svg,
                cursor,
                bytes('" width="1024" height="1024" style="image-rendering:pixelated" href="data:image/bmp;base64,')
            );
            cursor = _append(svg, cursor, bytes(Base64.encode(bmp)));
            cursor = _append(svg, cursor, bytes('"/>'));
        }
        cursor = _append(svg, cursor, bytes("</svg>"));
        assembly ("memory-safe") { mstore(svg, cursor) }

        uint64 lastFrame = reel.firstFrame + uint64(count) - 1;
        uint256 blocksSpanned = uint256(traits.lastBlock) - uint256(traits.firstBlock) + 1;
        uint256 averageMs = totalMs / count;
        dominantColour = traits.dominantColour;
        coloursUsed = traits.coloursUsed;

        kind = "Reel";
        description = "every frame is one monad block. painted by whoever showed up.";
        imageSvg = svg;
        attributes = string(
            abi.encodePacked(
                ',{"trait_type":"Frames","display_type":"number","value":', count.toString(), '}',
                ',{"trait_type":"Length","value":"', LabTraits.reelLength(count), '"}',
                ',{"trait_type":"Duration ms","display_type":"number","value":', totalMs.toString(), '}',
                ',{"trait_type":"Tempo","value":"', LabTraits.tempo(averageMs), '"}',
                ',{"trait_type":"Longest hold ms","display_type":"number","value":', longestHoldMs.toString(), '}',
                ',{"trait_type":"Blocks spanned","display_type":"number","value":', blocksSpanned.toString(), '}',
                ',{"trait_type":"First frame","display_type":"number","value":', uint256(reel.firstFrame).toString(), '}',
                ',{"trait_type":"Last frame","display_type":"number","value":', uint256(lastFrame).toString(), '}',
                ',{"trait_type":"First block","display_type":"number","value":', uint256(traits.firstBlock).toString(), '}',
                ',{"trait_type":"Last block","display_type":"number","value":', uint256(traits.lastBlock).toString(), '}',
                ',{"trait_type":"Validators","display_type":"number","value":', uint256(traits.validators).toString(), '}',
                ',{"trait_type":"Validator mix","value":"', LabTraits.validatorMix(traits.validators), '"}',
                ',{"trait_type":"Pixels painted","display_type":"number","value":', uint256(traits.totalPixels).toString(), '}',
                ',{"trait_type":"Busiest frame painters","display_type":"number","value":', uint256(traits.busiestPainters).toString(), '}',
                ',{"trait_type":"Storm frames","display_type":"number","value":', uint256(traits.stormFrames).toString(), '}'
            )
        );
    }

    function canBurn(uint256 id) external view returns (bool) {
        if (_reels[id].pointer == address(0)) revert ReelDoesNotExist(id);
        return false;
    }


    function _colourStats(uint256[16] memory counts)
        internal
        pure
        returns (uint8 dominantColour, uint8 coloursUsed)
    {
        uint256 best;
        for (uint8 colour; colour < 16; ++colour) {
            uint256 colourCount = counts[colour];
            if (colourCount != 0) ++coloursUsed;
            if (colour != 0 && colourCount > best) {
                best = colourCount;
                dominantColour = colour;
            }
        }
    }

    function _timingStarts(bytes memory snapshot, uint256 count, uint256 totalTicks)
        internal
        pure
        returns (uint256[] memory starts)
    {
        starts = new uint256[](count);
        uint256 metaStart = 1 + count * FRAME_BYTES;
        uint256 elapsed;
        for (uint256 i; i < count; ++i) {
            starts[i] = totalTicks == 0 ? 0 : (elapsed * 1000) / totalTicks;
            if (i + 1 < count) {
                uint48 currentBlock = _readBE48(snapshot, metaStart + i * META_BYTES);
                uint48 nextBlock = _readBE48(snapshot, metaStart + (i + 1) * META_BYTES);
                uint256 duration = uint256(nextBlock) - uint256(currentBlock);
                if (duration < 1) duration = 1;
                if (duration > MAX_GAP_TICKS) duration = MAX_GAP_TICKS;
                elapsed += duration;
            }
        }
    }

    function _timing(uint48[] memory blocks)
        internal
        pure
        returns (uint256 totalTicks, uint256[] memory starts)
    {
        uint256 count = blocks.length;
        uint256[] memory durations = new uint256[](count);
        starts = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            uint256 d;
            if (i + 1 == count) {
                d = HOLD_LAST_TICKS;
            } else {
                d = uint256(blocks[i + 1]) - uint256(blocks[i]);
                if (d < 1) d = 1;
                if (d > MAX_GAP_TICKS) d = MAX_GAP_TICKS;
            }
            durations[i] = d;
            totalTicks += d;
        }
        uint256 elapsed;
        for (uint256 i; i < count; ++i) {
            starts[i] = (1000 * elapsed) / totalTicks;
            elapsed += durations[i];
        }
    }

    function _snapshotBMP(bytes memory snapshot, uint256 sourceOffset, uint24[16] memory colors)
        internal
        pure
        returns (bytes memory bmp)
    {
        // Extra padding keeps the 32-byte row copy below inside allocated memory.
        bmp = new bytes(BMP_BYTES + 16);
        bmp[0] = 0x42;
        bmp[1] = 0x4d;
        _le32(bmp, 2, uint32(BMP_BYTES));
        _le32(bmp, 10, uint32(BMP_OFFSET));
        _le32(bmp, 14, 40);
        _le32(bmp, 18, 32);
        _le32(bmp, 22, 32);
        _le16(bmp, 26, 1);
        _le16(bmp, 28, 4);
        _le32(bmp, 34, uint32(FRAME_BYTES));
        _le32(bmp, 46, 16);
        _le32(bmp, 50, 16);

        for (uint256 i; i < 16; ++i) {
            uint24 rgb = colors[i];
            uint256 p = 54 + i * 4;
            bmp[p] = bytes1(uint8(rgb));
            bmp[p + 1] = bytes1(uint8(rgb >> 8));
            bmp[p + 2] = bytes1(uint8(rgb >> 16));
        }

        for (uint256 row; row < 32; ++row) {
            uint256 src = sourceOffset + (31 - row) * 16;
            uint256 dst = BMP_OFFSET + row * 16;
            assembly ("memory-safe") {
                let word := mload(add(add(snapshot, 0x20), src))
                mstore(add(add(bmp, 0x20), dst), word)
            }
        }
        assembly ("memory-safe") { mstore(bmp, BMP_BYTES) }
    }

    function stamp(address painter) external view returns (string memory name, bool earned) {
        return ("FLIPBOOK", _painters[painter].framesPainted >= FLIPBOOK_STAMP_FRAMES);
    }

    function _writeGenesis(bytes memory genesis) internal {
        for (uint256 i; i < FRAME_WORDS; ++i) {
            uint256 word;
            assembly ("memory-safe") { word := mload(add(add(genesis, 0x20), mul(i, 0x20))) }
            _storeFrameWord(FRAMES_BASE + i, word);
        }
    }

    function _frameBase(uint64 frameNumber) internal pure returns (uint256) {
        return FRAMES_BASE + (uint256(frameNumber) % RING_FRAMES) * FRAME_WORDS;
    }

    function _metaSlot(uint64 frameNumber) internal pure returns (uint256) {
        return META_BASE + (uint256(frameNumber) % RING_FRAMES);
    }

    function _storeMeta(uint64 frameNumber, uint48 blockNumber, address proposer, uint16 pixels, uint8 painters) internal {
        uint256 packed = uint256(blockNumber)
            | (uint256(uint160(proposer)) << 48)
            | (uint256(pixels) << 208)
            | (uint256(painters) << 224);
        _sstore(_metaSlot(frameNumber), packed);
    }

    function _loadMeta(uint64 frameNumber)
        internal
        view
        returns (uint48 blockNumber, address proposer, uint16 pixels, uint8 painters)
    {
        uint256 packed = _sload(_metaSlot(frameNumber));
        blockNumber = uint48(packed);
        proposer = address(uint160(packed >> 48));
        pixels = uint16(packed >> 208);
        painters = uint8(packed >> 224);
    }

    function _frameBytes(uint64 frameNumber) internal view returns (bytes memory out) {
        out = new bytes(FRAME_BYTES);
        uint256 base = _frameBase(frameNumber);
        for (uint256 i; i < FRAME_WORDS; ++i) {
            uint256 word = _loadFrameWord(base + i);
            assembly ("memory-safe") { mstore(add(add(out, 0x20), mul(i, 0x20)), word) }
        }
    }

    function _loadFrameWord(uint256 slot) internal view returns (uint256) {
        return _sload(slot) ^ FRAME_XOR;
    }

    function _storeFrameWord(uint256 slot, uint256 logicalWord) internal {
        _sstore(slot, logicalWord ^ FRAME_XOR);
    }

    function _requireFrame(uint64 f) internal view {
        uint64 count = frameCount;
        if (f >= count || uint256(f) + RING_FRAMES < count) revert FrameExpired(f);
    }

    function _sload(uint256 slot) internal view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) internal {
        assembly ("memory-safe") { sstore(slot, value) }
    }

    function _append(bytes memory out, uint256 cursor, bytes memory data) internal pure returns (uint256 next) {
        next = cursor + data.length;
        if (next > out.length) revert InvalidConfig();
        assembly ("memory-safe") {
            let src := add(data, 0x20)
            let dst := add(add(out, 0x20), cursor)
            let length := mload(data)
            for { let o := 0 } lt(o, length) { o := add(o, 0x20) } {
                mstore(add(dst, o), mload(add(src, o)))
            }
        }
    }

    function _packReelTraits(ReelTraitsData memory traits) internal pure returns (uint256 packed) {
        packed = uint256(traits.dominantColour);
        packed |= uint256(traits.coloursUsed) << 4;
        packed |= uint256(traits.validators) << 9;
        packed |= uint256(traits.busiestPainters) << 15;
        packed |= uint256(traits.stormFrames) << 23;
        packed |= uint256(traits.totalPixels) << 29;
        packed |= uint256(traits.totalTicks) << 50;
        packed |= uint256(traits.longestEmptyBlocks) << 58;
        packed |= uint256(traits.firstBlock) << 106;
        packed |= uint256(traits.lastBlock) << 154;
        packed |= uint256(traits.mintBlock) << 202;
    }

    function _unpackReelTraits(uint256 packed) internal pure returns (ReelTraitsData memory traits) {
        traits.dominantColour = uint8(packed & 0x0f);
        traits.coloursUsed = uint8((packed >> 4) & 0x1f);
        traits.validators = uint8((packed >> 9) & 0x3f);
        traits.busiestPainters = uint8((packed >> 15) & 0xff);
        traits.stormFrames = uint8((packed >> 23) & 0x3f);
        traits.totalPixels = uint32((packed >> 29) & 0x1fffff);
        traits.totalTicks = uint16((packed >> 50) & 0xff);
        traits.longestEmptyBlocks = uint48((packed >> 58) & 0xffffffffffff);
        traits.firstBlock = uint48((packed >> 106) & 0xffffffffffff);
        traits.lastBlock = uint48((packed >> 154) & 0xffffffffffff);
        traits.mintBlock = uint48((packed >> 202) & 0xffffffffffff);
    }

    function _perMille(uint256 pm) internal pure returns (bytes memory) {
        return abi.encodePacked((pm / 10).toString(), ".", (pm % 10).toString(), "%");
    }

    function _writeBE48(bytes memory out, uint256 offset, uint48 value) internal pure {
        for (uint256 i; i < 6; ++i) out[offset + i] = bytes1(uint8(value >> ((5 - i) * 8)));
    }

    function _readBE48(bytes memory data, uint256 offset) internal pure returns (uint48 value) {
        for (uint256 i; i < 6; ++i) value = (value << 8) | uint48(uint8(data[offset + i]));
    }

    function _writeAddress(bytes memory out, uint256 offset, address value) internal pure {
        uint160 v = uint160(value);
        for (uint256 i; i < 20; ++i) out[offset + i] = bytes1(uint8(v >> ((19 - i) * 8)));
    }

    function _readAddress(bytes memory data, uint256 offset) internal pure returns (address value) {
        uint160 v;
        for (uint256 i; i < 20; ++i) v = (v << 8) | uint160(uint8(data[offset + i]));
        value = address(v);
    }

    function _readBE16(bytes memory data, uint256 offset) internal pure returns (uint16 value) {
        value = (uint16(uint8(data[offset])) << 8) | uint16(uint8(data[offset + 1]));
    }

    function _writeBE16(bytes memory out, uint256 offset, uint16 value) internal pure {
        out[offset] = bytes1(uint8(value >> 8));
        out[offset + 1] = bytes1(uint8(value));
    }

    function _le16(bytes memory b, uint256 o, uint16 v) internal pure {
        b[o] = bytes1(uint8(v));
        b[o + 1] = bytes1(uint8(v >> 8));
    }

    function _le32(bytes memory b, uint256 o, uint32 v) internal pure {
        b[o] = bytes1(uint8(v));
        b[o + 1] = bytes1(uint8(v >> 8));
        b[o + 2] = bytes1(uint8(v >> 16));
        b[o + 3] = bytes1(uint8(v >> 24));
    }


}
