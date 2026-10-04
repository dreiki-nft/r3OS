// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IR3OSPaintData} from "../interfaces/IR3OSPaintData.sol";
import {IStampSource} from "../interfaces/IStampSource.sol";
import {BrushDNA} from "../lib/BrushDNA.sol";

/// @notice Catch deterministic block-hash brushes, stamp them through normal core paint, then verify them onchain.
/// @dev No owner, no admin, no funds. Each resolved owner has one 128-slot-aligned storage page.
contract R3OSBrushes is IStampSource {
    error ZeroAddress();
    error NotOpenYet();
    error NotCatchable(uint256 blockNumber);
    error AlreadyCaughtThisBlock();
    error AlreadyInBox(uint256 blockNumber);
    error InvalidSlot(uint8 slot);
    error EmptySlot(uint8 slot);
    error OffCanvas(uint8 x, uint8 y);
    error AlreadyVerified(uint8 slot);
    error NotOnCanvas(uint8 x, uint8 y, uint8 want, uint8 got);

    event BrushCaught(address indexed owner, address sender, uint8 slot, uint256 indexed blockNumber, uint256 brush);
    event BrushVerified(
        address indexed owner,
        address sender,
        uint8 slot,
        uint256 indexed blockNumber,
        uint8 x,
        uint8 y,
        uint256 season
    );

    uint256 public constant BOX_SIZE = 8;
    uint256 public constant CATCH_WINDOW_BLOCKS = 256;
    uint256 public constant STAMP_THRESHOLD = 3;

    IR3OSPaintData public immutable PAINT;
    uint64 public immutable OPEN_TIME;

    constructor(address paintCore, uint64 openTime) {
        if (paintCore == address(0)) revert ZeroAddress();
        PAINT = IR3OSPaintData(paintCore);
        OPEN_TIME = openTime;
    }

    function catchBrush(uint256 blockNumber) external returns (uint8 slot) {
        _requireOpen();
        address owner = _resolveOwner(msg.sender);
        uint256 currentBlock = block.number;
        if (
            blockNumber >= currentBlock || currentBlock - blockNumber > CATCH_WINDOW_BLOCKS
                || blockhash(blockNumber) == bytes32(0)
        ) revert NotCatchable(blockNumber);

        uint256 base = boxBase(owner);
        uint256 meta = _sload(base + 8);
        uint48 lastCatchBlock = uint48(meta >> 80);
        if (lastCatchBlock == uint48(currentBlock)) revert AlreadyCaughtThisBlock();

        for (uint256 i; i < BOX_SIZE; ++i) {
            uint256 existing = _sload(base + i);
            if (existing != 0 && BrushDNA.blockNumberOf(existing) == blockNumber) revert AlreadyInBox(blockNumber);
        }

        slot = uint8(meta);
        uint8 verifiedMask = uint8(meta >> 8);
        uint32 catches = uint32(meta >> 16);
        uint32 verifiedTotal = uint32(meta >> 48);
        uint256 brush = BrushDNA.fromBlockhash(blockhash(blockNumber), blockNumber);
        _sstore(base + slot, brush);
        verifiedMask &= uint8(~(uint8(1) << slot));
        unchecked { ++catches; }
        uint8 nextSlot = uint8((uint256(slot) + 1) % BOX_SIZE);
        _sstore(base + 8, _packMeta(nextSlot, verifiedMask, catches, verifiedTotal, uint48(currentBlock)));
        emit BrushCaught(owner, msg.sender, slot, blockNumber, brush);
    }

    function verify(uint8 slot, uint8 x, uint8 y) external {
        _requireOpen();
        if (slot >= BOX_SIZE) revert InvalidSlot(slot);
        if (x > 248 || y > 248) revert OffCanvas(x, y);

        address owner = _resolveOwner(msg.sender);
        uint256 base = boxBase(owner);
        uint256 brush = _sload(base + slot);
        if (brush == 0) revert EmptySlot(slot);
        uint256 meta = _sload(base + 8);
        uint8 verifiedMask = uint8(meta >> 8);
        if ((verifiedMask & (uint8(1) << slot)) != 0) revert AlreadyVerified(slot);

        uint256 season = PAINT.currentSeason();
        uint256 xLast = uint256(x) + 7;
        uint256 yLast = uint256(y) + 7;
        uint8 rx0 = uint8(uint256(x) >> 6);
        uint8 rx1 = uint8(xLast >> 6);
        uint8 ry0 = uint8(uint256(y) >> 6);
        uint8 ry1 = uint8(yLast >> 6);

        uint8 region00 = uint8(uint256(ry0) * 4 + rx0);
        uint256[64] memory words00 = PAINT.regionWords(season, region00);
        uint256[64] memory words01;
        uint256[64] memory words10;
        uint256[64] memory words11;
        if (rx1 != rx0) words01 = PAINT.regionWords(season, uint8(uint256(ry0) * 4 + rx1));
        if (ry1 != ry0) words10 = PAINT.regionWords(season, uint8(uint256(ry1) * 4 + rx0));
        if (rx1 != rx0 && ry1 != ry0) words11 = PAINT.regionWords(season, uint8(uint256(ry1) * 4 + rx1));

        for (uint256 r; r < 8; ++r) {
            for (uint256 c; c < 8; ++c) {
                uint256 colorSlot = BrushDNA.cell(brush, r, c);
                if (colorSlot == 0) continue;
                uint256 px = uint256(x) + c;
                uint256 py = uint256(y) + r;
                uint256 rowIndex = py & 63;
                uint256 rowWord;
                bool right = (px >> 6) != rx0;
                bool down = (py >> 6) != ry0;
                if (!right && !down) rowWord = words00[rowIndex];
                else if (right && !down) rowWord = words01[rowIndex];
                else if (!right && down) rowWord = words10[rowIndex];
                else rowWord = words11[rowIndex];
                uint8 got = uint8((rowWord >> (252 - 4 * (px & 63))) & 0x0f);
                uint8 want = BrushDNA.colour(brush, colorSlot);
                if (got != want) revert NotOnCanvas(uint8(px), uint8(py), want, got);
            }
        }

        verifiedMask |= uint8(1) << slot;
        uint8 nextSlot = uint8(meta);
        uint32 catches = uint32(meta >> 16);
        uint32 verifiedTotal = uint32(meta >> 48);
        uint48 lastCatchBlock = uint48(meta >> 80);
        unchecked { ++verifiedTotal; }
        _sstore(base + 8, _packMeta(nextSlot, verifiedMask, catches, verifiedTotal, lastCatchBlock));
        emit BrushVerified(owner, msg.sender, slot, BrushDNA.blockNumberOf(brush), x, y, season);
    }

    function boxBase(address owner) public pure returns (uint256) {
        return uint256(keccak256(abi.encode("r3tards.brushes.box", owner))) & ~uint256(127);
    }

    function box(address owner)
        external
        view
        returns (
            uint256[8] memory brushes,
            uint8 nextSlot,
            uint8 verifiedMask,
            uint32 catches,
            uint32 verifiedTotal,
            uint48 lastCatchBlock
        )
    {
        uint256 base = boxBase(owner);
        for (uint256 i; i < BOX_SIZE; ++i) brushes[i] = _sload(base + i);
        uint256 meta = _sload(base + 8);
        nextSlot = uint8(meta);
        verifiedMask = uint8(meta >> 8);
        catches = uint32(meta >> 16);
        verifiedTotal = uint32(meta >> 48);
        lastCatchBlock = uint48(meta >> 80);
    }

    function brushFromBlockhash(bytes32 blockHash, uint256 blockNumber) external pure returns (uint256) {
        return BrushDNA.fromBlockhash(blockHash, blockNumber);
    }

    function brushRuns(uint256 brush, uint8 x, uint8 y) external pure returns (bytes memory) {
        if (x > 248 || y > 248) revert OffCanvas(x, y);
        return BrushDNA.runs(brush, x, y);
    }

    function previewBlock(uint256 blockNumber) external view returns (uint256) {
        uint256 currentBlock = block.number;
        if (blockNumber >= currentBlock || currentBlock - blockNumber > CATCH_WINDOW_BLOCKS) return 0;
        bytes32 h = blockhash(blockNumber);
        if (h == bytes32(0)) return 0;
        return BrushDNA.fromBlockhash(h, blockNumber);
    }

    function stamp(address painter) external view returns (string memory name, bool earned) {
        uint256 meta = _sload(boxBase(painter) + 8);
        return ("BLOCK DNA", uint32(meta >> 48) >= STAMP_THRESHOLD);
    }

    function _resolveOwner(address sender) private view returns (address owner) {
        (address sessionOwner,,,,, bool active) = PAINT.sessionInfo(sender);
        owner = active ? sessionOwner : sender;
    }

    function _requireOpen() private view {
        if (block.timestamp < OPEN_TIME) revert NotOpenYet();
    }

    function _packMeta(uint8 nextSlot, uint8 verifiedMask, uint32 catches, uint32 verifiedTotal, uint48 lastCatchBlock)
        private
        pure
        returns (uint256)
    {
        return uint256(nextSlot) | (uint256(verifiedMask) << 8) | (uint256(catches) << 16)
            | (uint256(verifiedTotal) << 48) | (uint256(lastCatchBlock) << 80);
    }

    function _sload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") { sstore(slot, value) }
    }
}
