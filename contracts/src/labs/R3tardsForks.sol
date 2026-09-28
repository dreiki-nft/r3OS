// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "solady/utils/Base64.sol";
import {IR3tardsPaintData} from "../interfaces/IR3tardsPaintData.sol";
import {IStampSource} from "../interfaces/IStampSource.sol";
import {ILabTokenSource} from "../interfaces/ILabTokenSource.sol";
import {R3tardsLabs} from "../R3tardsLabs.sol";
import {LabTraits} from "../lib/LabTraits.sol";
import {Source64} from "../lib/Source64.sol";

/// @notice Disposable 64x64 side canvases forked from immutable r3tards paint frames.
/// @dev No owner or admin. Each fork owns one 128-slot-aligned storage page.
contract R3tardsForks is IStampSource, ILabTokenSource {
    using Strings for uint256;

    error ZeroAddress();
    error NotOpenYet();
    error SessionKeyCannotFork();
    error NotPainter();
    error ForkCooldown(uint256 untilBlock);
    error NoFork(uint256 forkId);
    error InvalidRuns();
    error TooManyPixels(uint256 pixels);
    error AlreadyPaintedThisBlock(uint256 forkId);
    error ForkClosed(uint256 forkId);
    error ForkBlockFull(uint256 used);
    error NoChange();
    error NotForkOwner(uint256 forkId);
    error SealedFork(uint256 forkId);
    error ExperimentAlreadyBound();
    error InvalidExperiment(uint256 experimentId);
    error ExperimentNotBound();

    event ForkCreated(
        uint256 indexed forkId,
        uint256 indexed sourceFrameId,
        uint256 parentForkId,
        address indexed creator,
        uint16 depth
    );
    event ForkPainted(uint256 indexed forkId, address indexed owner, address indexed sender, uint16 pixels);
    event ForkOpenChanged(uint256 indexed forkId, bool isOpen);
    event ForkSealed(uint256 indexed forkId);

    struct ForkInfo {
        uint64 sourceFrameId;
        uint64 parentForkId;
        uint48 createdBlock;
        uint16 depth;
        uint8 background;
        uint8 face;
        uint32 season;
        bool isOpen;
        bool isSealed;
        uint64 paints;
        uint32 painters;
        uint48 lastPaintBlock;
        uint32 timesForked;
        uint48 sealedBlock;
    }

    uint256 public constant FORKS_BASE = uint256(keccak256("r3tards.forks.pages")) & ~uint256(127);
    uint256 private constant FORK_XOR =
        0x5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A;
    uint256 public constant FORK_COOLDOWN_BLOCKS = 600;
    uint256 public constant MAX_PIXELS_PER_PAINT = 64;
    uint256 public constant MAX_RUNS_PER_PAINT = 32;
    uint256 public constant FORK_PIXELS_PER_BLOCK = 256;

    IR3tardsPaintData public immutable PAINT;
    R3tardsLabs public immutable LABS;
    uint64 public immutable OPEN_TIME;
    uint256 public forkCount;
    uint256 public experimentId = type(uint256).max;

    mapping(uint256 => mapping(address => uint48)) private _lastPaint;
    mapping(address => uint256) private _painter;

    constructor(address paintCore, address labs, uint64 openTime) {
        if (paintCore == address(0) || labs == address(0)) revert ZeroAddress();
        PAINT = IR3tardsPaintData(paintCore);
        LABS = R3tardsLabs(labs);
        OPEN_TIME = openTime;
    }

    function bindExperimentId(uint256 id) external {
        if (experimentId != type(uint256).max) revert ExperimentAlreadyBound();
        IR3tardsPaintData.ExperimentData memory info_ = PAINT.experimentInfo(id);
        (address experiment, bool retired) = (info_.experiment, info_.retired);
        if (experiment != address(this) || retired) revert InvalidExperiment(id);
        experimentId = id;
    }

    function forkFrame(uint256 frameId) external returns (uint256 forkId) {
        _requireCanFork(msg.sender);
        IR3tardsPaintData.FrameInfoData memory info = PAINT.frameInfo(frameId);
        uint256[64] memory rows = Source64.rows(
            PAINT.frameData(frameId), PAINT.genesisFrameData(info.season), info.faceColor
        );
        forkId = _createFork(
            msg.sender,
            uint64(frameId),
            0,
            0,
            info.backgroundColor,
            info.faceColor,
            info.season,
            rows
        );
    }

    function forkFork(uint256 parentForkId) external returns (uint256 forkId) {
        ForkInfo memory parentInfo = _forkInfo(parentForkId);
        _requireCanFork(msg.sender);
        uint16 depth = parentInfo.depth + 1;
        uint256[64] memory rows = _forkRows(parentForkId);
        forkId = _createFork(
            msg.sender,
            parentInfo.sourceFrameId,
            uint64(parentForkId),
            depth,
            parentInfo.background,
            parentInfo.face,
            parentInfo.season,
            rows
        );
        _incrementTimesForked(parentForkId);
        LABS.notifyMetadataUpdate(parentForkId);
    }

    /// @notice Paint a fork with packed runs sorted by non-decreasing row (`y`).
    /// @dev Sorting lets each touched row be loaded once and written at most once while preserving exact net-no-op detection.
    function paint(uint256 forkId, bytes calldata runs) external {
        _requireOpen();
        uint256 base = _requireFork(forkId);
        uint256 meta = _sload(base + 64);
        bool isOpen = ((meta >> 208) & 1) != 0;
        bool isSealed = ((meta >> 209) & 1) != 0;
        if (isSealed) revert SealedFork(forkId);

        address owner = _resolveOwner(msg.sender);
        if (!isOpen && LABS.ownerOf(forkId) != owner) revert ForkClosed(forkId);
        if (_lastPaint[forkId][owner] == uint48(block.number)) revert AlreadyPaintedThisBlock(forkId);

        uint256 pixels = _validateRuns(runs);
        uint256 stats = _sload(base + 65);
        uint48 previousBlock = uint48(stats >> 96);
        uint16 used = previousBlock == uint48(block.number) ? uint16(stats >> 144) : 0;
        if (uint256(used) + pixels > FORK_PIXELS_PER_BLOCK) revert ForkBlockFull(used);

        // Runs arrive sorted by row, so each touched row is loaded once and written at most once,
        // and a row that ends where it started is never written (no net-no-op paints).
        uint256 nibbleOnes = 0x1111111111111111111111111111111111111111111111111111111111111111;
        bool changed;
        uint256 currentY = type(uint256).max;
        uint256 original;
        uint256 row;
        for (uint256 o; o < runs.length; o += 4) {
            uint256 y = uint8(runs[o]);
            if (y != currentY) {
                if (row != original) {
                    _sstore(base + currentY, row ^ FORK_XOR);
                    changed = true;
                }
                currentY = y;
                original = _sload(base + y) ^ FORK_XOR;
                row = original;
            }
            uint256 x0 = uint8(runs[o + 1]);
            uint256 x1 = uint8(runs[o + 2]);
            uint256 width = x1 - x0 + 1;
            uint256 mask = width == 64
                ? type(uint256).max
                : ((uint256(1) << (width * 4)) - 1) << (252 - x1 * 4);
            row = (row & ~mask) | ((nibbleOnes * uint8(runs[o + 3])) & mask);
        }
        if (row != original) {
            _sstore(base + currentY, row ^ FORK_XOR);
            changed = true;
        }
        if (!changed) revert NoChange();

        bool firstPaint = _lastPaint[forkId][owner] == 0;
        _lastPaint[forkId][owner] = uint48(block.number);

        uint64 paints = uint64(stats);
        uint32 painters = uint32(stats >> 64);
        uint32 timesForked = uint32(stats >> 160);
        uint48 sealedBlock = uint48(stats >> 192);
        unchecked {
            ++paints;
            if (firstPaint) ++painters;
        }
        uint16 nextUsed = uint16(uint256(used) + pixels);
        _sstore(
            base + 65,
            _packStats(paints, painters, uint48(block.number), nextUsed, timesForked, sealedBlock)
        );
        if (firstPaint) _incrementForksPainted(owner);

        emit ForkPainted(forkId, owner, msg.sender, uint16(pixels));
        LABS.notifyMetadataUpdate(forkId);
    }

    function setOpen(uint256 forkId, bool isOpen) external {
        _requireOpen();
        uint256 base = _requireDirectOwner(forkId);
        uint256 meta = _sload(base + 64);
        if (((meta >> 209) & 1) != 0) revert SealedFork(forkId);
        if (isOpen) meta |= uint256(1) << 208;
        else meta &= ~(uint256(1) << 208);
        _sstore(base + 64, meta);
        emit ForkOpenChanged(forkId, isOpen);
        LABS.notifyMetadataUpdate(forkId);
    }

    function seal(uint256 forkId) external {
        _requireOpen();
        uint256 base = _requireDirectOwner(forkId);
        uint256 meta = _sload(base + 64);
        if (((meta >> 209) & 1) != 0) revert SealedFork(forkId);
        meta &= ~(uint256(1) << 208);
        meta |= uint256(1) << 209;
        _sstore(base + 64, meta);
        uint256 stats = _sload(base + 65);
        uint256 sealedMask = uint256(type(uint48).max) << 192;
        _sstore(base + 65, (stats & ~sealedMask) | (uint256(uint48(block.number)) << 192));
        emit ForkSealed(forkId);
        LABS.notifyMetadataUpdate(forkId);
    }

    function forkBase(uint256 forkId) public pure returns (uint256) {
        return FORKS_BASE + forkId * 128;
    }

    function forkInfo(uint256 forkId) external view returns (ForkInfo memory) {
        return _forkInfo(forkId);
    }

    function forkRows(uint256 forkId) public view returns (uint256[64] memory) {
        return _forkRows(forkId);
    }

    function forkBMP(uint256 forkId) public view returns (bytes memory bmp) {
        ForkInfo memory info = _forkInfo(forkId);
        uint256[64] memory rows = _forkRows(forkId);
        bmp = new bytes(2_166);
        bytes memory header = hex"424d76080000000000007600000028000000400000004000000001000400000000000008000000000000000000001000000010000000";
        for (uint256 i; i < header.length; ++i) bmp[i] = header[i];

        uint24[16] memory palette = PAINT.palette();
        palette[0] = palette[info.background];
        for (uint256 i; i < 16; ++i) {
            uint24 c = palette[i];
            uint256 p = 54 + i * 4;
            bmp[p] = bytes1(uint8(c));
            bmp[p + 1] = bytes1(uint8(c >> 8));
            bmp[p + 2] = bytes1(uint8(c >> 16));
            bmp[p + 3] = 0;
        }
        assembly ("memory-safe") {
            let dst := add(add(bmp, 0x20), 118)
            for { let i := 0 } lt(i, 64) { i := add(i, 1) } {
                mstore(add(dst, mul(i, 32)), mload(add(rows, mul(sub(63, i), 32))))
            }
        }
    }

    function lastPaintBlockOf(uint256 forkId, address owner) external view returns (uint48) {
        return _lastPaint[forkId][owner];
    }

    function painterInfo(address owner) external view returns (uint32 forksPainted, uint48 lastForkBlock) {
        uint256 packed = _painter[owner];
        forksPainted = uint32(packed);
        lastForkBlock = uint48(packed >> 32);
    }

    function stamp(address painter) external view returns (string memory name, bool earned) {
        return ("FORKER", uint32(_painter[painter]) >= 3);
    }

    function labToken(uint256 forkId) external view returns (
        string memory kind,
        string memory description,
        bytes memory imageSvg,
        string memory attributes,
        uint8 dominantColour,
        uint8 coloursUsed
    ) {
        ForkInfo memory info = _forkInfo(forkId);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
            '<image width="1024" height="1024" style="image-rendering:pixelated" href="data:image/bmp;base64,',
            Base64.encode(forkBMP(forkId)),
            '"/></svg>'
        );
        IR3tardsPaintData.FrameInfoData memory source = PAINT.frameInfo(info.sourceFrameId);
        string memory state = info.isSealed ? "Sealed" : info.isOpen ? "Open" : "Closed";
        uint256 displayDepth = uint256(info.depth) + 1;

        bytes memory parentAttribute;
        if (info.parentForkId != 0) {
            parentAttribute = abi.encodePacked(
                ',{"trait_type":"Parent fork","display_type":"number","value":',
                uint256(info.parentForkId).toString(),
                '}'
            );
        }
        bytes memory sealedAttribute;
        if (info.sealedBlock != 0) {
            sealedAttribute = abi.encodePacked(
                ',{"trait_type":"Sealed block","display_type":"number","value":',
                uint256(info.sealedBlock).toString(),
                '}'
            );
        }

        kind = "Fork";
        description = string.concat(
            "a 64x64 side canvas forked from r3tards paint frame #",
            uint256(info.sourceFrameId).toString(),
            ", stored and drawn fully onchain."
        );
        imageSvg = bytes(svg);
        attributes = string(
            abi.encodePacked(
                ',{"trait_type":"State","value":"', state, '"}',
                ',{"trait_type":"Depth","display_type":"number","value":', displayDepth.toString(), '}',
                ',{"trait_type":"Lineage","value":"', LabTraits.lineage(displayDepth), '"}',
                ',{"trait_type":"Source frame","display_type":"number","value":',
                uint256(info.sourceFrameId).toString(),
                '}',
                ',{"trait_type":"Source season","display_type":"number","value":',
                (uint256(info.season) + 1).toString(),
                '}',
                parentAttribute,
                ',{"trait_type":"From storm frame","value":"',
                PAINT.isStorm(source.blockNumber) ? "yes" : "no",
                '"}',
                ',{"trait_type":"From finale","value":"', source.finale ? "yes" : "no", '"}',
                ',{"trait_type":"Painters","display_type":"number","value":', uint256(info.painters).toString(), '}',
                ',{"trait_type":"Crowd","value":"', LabTraits.crowd(info.painters), '"}',
                ',{"trait_type":"Paints","display_type":"number","value":', uint256(info.paints).toString(), '}',
                ',{"trait_type":"Activity","value":"', LabTraits.activity(info.paints), '"}',
                ',{"trait_type":"Times forked","display_type":"number","value":',
                uint256(info.timesForked).toString(),
                '}',
                ',{"trait_type":"Forked","value":"', info.timesForked == 0 ? "no" : "yes", '"}',
                ',{"trait_type":"Created block","display_type":"number","value":',
                uint256(info.createdBlock).toString(),
                '}',
                sealedAttribute
            )
        );
        (dominantColour, coloursUsed) = _colourStats(_forkRows(forkId));
    }

    function canBurn(uint256 forkId) external view returns (bool) {
        _requireFork(forkId);
        return false;
    }

    function _colourStats(uint256[64] memory rows)
        private
        pure
        returns (uint8 dominantColour, uint8 coloursUsed)
    {
        uint256[16] memory counts;
        uint256 mask;
        assembly ("memory-safe") {
            let rowsPtr := rows
            let countsPtr := counts
            for { let y := 0 } lt(y, 64) { y := add(y, 1) } {
                let row := mload(add(rowsPtr, shl(5, y)))
                for { let laneIndex := 0 } lt(laneIndex, 4) { laneIndex := add(laneIndex, 1) } {
                    let lane := and(shr(mul(laneIndex, 64), row), 0xffffffffffffffff)
                    for { let i := 0 } lt(i, 16) { i := add(i, 1) } {
                        let colour := and(lane, 0x0f)
                        let countPtr := add(countsPtr, shl(5, colour))
                        mstore(countPtr, add(mload(countPtr), 1))
                        mask := or(mask, shl(colour, 1))
                        lane := shr(4, lane)
                    }
                }
            }
        }

        uint256 best;
        for (uint8 colour; colour < 16; ++colour) {
            if ((mask & (uint256(1) << colour)) != 0) ++coloursUsed;
            if (colour != 0 && counts[colour] > best) {
                best = counts[colour];
                dominantColour = colour;
            }
        }
    }

    function _createFork(
        address creator,
        uint64 sourceFrameId,
        uint64 parentForkId,
        uint16 depth,
        uint8 background,
        uint8 face,
        uint32 season,
        uint256[64] memory rows
    ) private returns (uint256 forkId) {
        uint256 boundExperimentId = experimentId;
        if (boundExperimentId == type(uint256).max) revert ExperimentNotBound();
        forkId = LABS.mint(creator, boundExperimentId);
        ++forkCount;
        uint256 base = forkBase(forkId);
        for (uint256 y; y < 64; ++y) _sstore(base + y, rows[y] ^ FORK_XOR);
        _sstore(
            base + 64,
            _packMeta(sourceFrameId, parentForkId, uint48(block.number), depth, background, face, season, true, false)
        );
        _sstore(base + 65, _packStats(0, 0, 0, 0, 0, 0));
        _setLastForkBlock(creator, uint48(block.number));
        emit ForkCreated(forkId, sourceFrameId, parentForkId, creator, depth);
    }

    function _requireCanFork(address creator) private view {
        _requireOpen();
        if (PAINT.isActiveSessionKey(creator)) revert SessionKeyCannotFork();
        if (PAINT.daysPainted(creator) < 1) revert NotPainter();
        uint48 lastForkBlock = uint48(_painter[creator] >> 32);
        if (lastForkBlock != 0 && block.number < uint256(lastForkBlock) + FORK_COOLDOWN_BLOCKS) {
            revert ForkCooldown(uint256(lastForkBlock) + FORK_COOLDOWN_BLOCKS);
        }
    }

    function _requireOpen() private view {
        if (block.timestamp < OPEN_TIME) revert NotOpenYet();
    }

    function _requireFork(uint256 forkId) private view returns (uint256 base) {
        base = forkBase(forkId);
        if (_sload(base + 64) == 0) revert NoFork(forkId);
    }

    function _requireDirectOwner(uint256 forkId) private view returns (uint256 base) {
        base = _requireFork(forkId);
        if (LABS.ownerOf(forkId) != msg.sender) revert NotForkOwner(forkId);
    }

    function _forkInfo(uint256 forkId) private view returns (ForkInfo memory info) {
        uint256 base = _requireFork(forkId);
        uint256 meta = _sload(base + 64);
        uint256 stats = _sload(base + 65);
        info.sourceFrameId = uint64(meta);
        info.parentForkId = uint64(meta >> 64);
        info.createdBlock = uint48(meta >> 128);
        info.depth = uint16(meta >> 176);
        info.background = uint8(meta >> 192);
        info.face = uint8(meta >> 200);
        info.isOpen = ((meta >> 208) & 1) != 0;
        info.isSealed = ((meta >> 209) & 1) != 0;
        info.season = uint32(meta >> 216);
        info.paints = uint64(stats);
        info.painters = uint32(stats >> 64);
        info.lastPaintBlock = uint48(stats >> 96);
        info.timesForked = uint32(stats >> 160);
        info.sealedBlock = uint48(stats >> 192);
    }

    function _forkRows(uint256 forkId) private view returns (uint256[64] memory rows) {
        uint256 base = _requireFork(forkId);
        for (uint256 y; y < 64; ++y) rows[y] = _sload(base + y) ^ FORK_XOR;
    }

    function _validateRuns(bytes calldata runs) private pure returns (uint256 pixels) {
        if (runs.length == 0 || runs.length % 4 != 0 || runs.length / 4 > MAX_RUNS_PER_PAINT) revert InvalidRuns();
        uint256 previousY;
        for (uint256 o; o < runs.length; o += 4) {
            uint8 y = uint8(runs[o]);
            if (y < previousY) revert InvalidRuns();
            previousY = y;
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            if (y >= 64 || x0 > x1 || x1 >= 64 || color >= 16) revert InvalidRuns();
            pixels += uint256(x1) - uint256(x0) + 1;
        }
        if (pixels > MAX_PIXELS_PER_PAINT) revert TooManyPixels(pixels);
    }

    function _resolveOwner(address sender) private view returns (address owner) {
        (address sessionOwner,,,,, bool active) = PAINT.sessionInfo(sender);
        owner = active ? sessionOwner : sender;
    }

    function _incrementForksPainted(address owner) private {
        uint256 packed = _painter[owner];
        uint32 count = uint32(packed);
        unchecked { ++count; }
        _painter[owner] = (packed & ~uint256(type(uint32).max)) | uint256(count);
    }

    function _setLastForkBlock(address owner, uint48 blockNumber_) private {
        uint256 packed = _painter[owner];
        uint256 clearMask = ~(uint256(type(uint48).max) << 32);
        _painter[owner] = (packed & clearMask) | (uint256(blockNumber_) << 32);
    }

    function _packMeta(
        uint64 sourceFrameId,
        uint64 parentForkId,
        uint48 createdBlock,
        uint16 depth,
        uint8 background,
        uint8 face,
        uint32 season,
        bool isOpen,
        bool isSealed
    ) private pure returns (uint256 meta) {
        meta = uint256(sourceFrameId) | (uint256(parentForkId) << 64) | (uint256(createdBlock) << 128)
            | (uint256(depth) << 176) | (uint256(background) << 192) | (uint256(face) << 200)
            | (uint256(season) << 216);
        if (isOpen) meta |= uint256(1) << 208;
        if (isSealed) meta |= uint256(1) << 209;
    }

    function _packStats(
        uint64 paints,
        uint32 painters,
        uint48 lastPaintBlock,
        uint16 pixelsUsed,
        uint32 timesForked,
        uint48 sealedBlock
    ) private pure returns (uint256) {
        return uint256(paints) | (uint256(painters) << 64) | (uint256(lastPaintBlock) << 96)
            | (uint256(pixelsUsed) << 144) | (uint256(timesForked) << 160)
            | (uint256(sealedBlock) << 192) | (uint256(1) << 255);
    }

    function _incrementTimesForked(uint256 forkId) private {
        uint256 base = _requireFork(forkId);
        uint256 stats = _sload(base + 65);
        uint32 count = uint32(stats >> 160);
        unchecked { ++count; }
        uint256 mask = uint256(type(uint32).max) << 160;
        _sstore(base + 65, (stats & ~mask) | (uint256(count) << 160));
    }

    function _sload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") { sstore(slot, value) }
    }
}
