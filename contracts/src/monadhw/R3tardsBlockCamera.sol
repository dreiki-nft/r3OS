// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {LibString} from "solady/utils/LibString.sol";
import {IR3tardsPaintData} from "../interfaces/IR3tardsPaintData.sol";
import {ILabTokenSource} from "../interfaces/ILabTokenSource.sol";
import {R3tardsLabs} from "../R3tardsLabs.sol";
import {MonadHW} from "../lib/MonadHW.sol";
import {R3tardsPalette} from "../lib/R3tardsPalette.sol";

/// @notice A one-block portrait camera using Monad consensus state as creative material.
/// @dev Proposer identity is provenance/art only. It is never used as randomness.
contract R3tardsBlockCamera is ILabTokenSource {
    using Strings for uint256;

    IR3tardsPaintData public immutable PAINT;
    R3tardsLabs public immutable LABS;
    uint256 public experimentId = type(uint256).max;

    struct Shot {
        // slot 0 (32 bytes)
        uint48 blockNumber;
        uint64 epoch;
        uint64 proposerValId;
        uint32 season;
        uint48 timestamp;
        // slot 1
        address capturer;
        bool inEpochDelay;
        bool proposerKnown;
        bool epochKnown;
        // slot 2
        bytes32 parentHash;
    }

    mapping(uint256 => Shot) private _shots;
    mapping(address => uint48) public lastCaptureBlock;

    error ZeroAddress();
    error ExperimentAlreadyBound();
    error InvalidExperiment(uint256 experimentId);
    error ExperimentNotBound();
    error AlreadyCapturedThisBlock();
    error SeasonTooLarge(uint256 season);
    error ShotDoesNotExist(uint256 tokenId);

    event Captured(
        uint256 indexed tokenId,
        address indexed capturer,
        uint256 indexed blockNumber,
        uint64 epoch,
        uint64 proposerValId,
        bytes32 parentHash
    );

    constructor(address paintCore, address labs) {
        if (paintCore == address(0) || labs == address(0)) revert ZeroAddress();
        PAINT = IR3tardsPaintData(paintCore);
        LABS = R3tardsLabs(labs);
    }

    function bindExperimentId(uint256 id) external {
        if (experimentId != type(uint256).max) revert ExperimentAlreadyBound();
        IR3tardsPaintData.ExperimentData memory info_ = PAINT.experimentInfo(id);
        if (info_.experiment != address(this) || info_.retired) revert InvalidExperiment(id);
        experimentId = id;
    }

    function capture() external returns (uint256 tokenId) {
        uint256 id = experimentId;
        if (id == type(uint256).max) revert ExperimentNotBound();
        if (lastCaptureBlock[msg.sender] == uint48(block.number)) revert AlreadyCapturedThisBlock();

        uint256 season_ = PAINT.currentSeason();
        if (season_ > type(uint32).max) revert SeasonTooLarge(season_);

        (uint64 proposerValId_, bool proposerKnown_) = MonadHW.proposerValId();
        (uint64 epoch_, bool inDelay_, bool epochKnown_) = MonadHW.epoch();
        bytes32 parentHash_ = blockhash(block.number - 1);

        lastCaptureBlock[msg.sender] = uint48(block.number);
        tokenId = LABS.mint(msg.sender, id);
        _shots[tokenId] = Shot({
            blockNumber: uint48(block.number),
            epoch: epoch_,
            proposerValId: proposerValId_,
            season: uint32(season_),
            timestamp: uint48(block.timestamp),
            capturer: msg.sender,
            inEpochDelay: inDelay_,
            proposerKnown: proposerKnown_,
            epochKnown: epochKnown_,
            parentHash: parentHash_
        });

        emit Captured(tokenId, msg.sender, block.number, epoch_, proposerValId_, parentHash_);
    }

    function shot(uint256 tokenId) external view returns (Shot memory) {
        Shot memory value = _shots[tokenId];
        if (value.capturer == address(0)) revert ShotDoesNotExist(tokenId);
        return value;
    }

    function previewPortrait(
        uint256 blockNumber,
        bytes32 parentHash,
        uint64 epoch_,
        bool inDelay,
        bool epochKnown,
        uint64 valId,
        bool proposerKnown,
        uint32 season,
        address capturer
    ) external pure returns (bytes memory svg) {
        Shot memory preview = Shot({
            blockNumber: uint48(blockNumber),
            epoch: epoch_,
            proposerValId: valId,
            season: season,
            timestamp: 0,
            capturer: capturer,
            inEpochDelay: inDelay,
            proposerKnown: proposerKnown,
            epochKnown: epochKnown,
            parentHash: parentHash
        });
        return portraitSvg(preview);
    }

    function portraitSvg(Shot memory value) internal pure returns (bytes memory) {
        (uint8[1024] memory pixels,,) = _portrait(value);
        return _render(pixels);
    }

    function labToken(uint256 tokenId) external view returns (
        string memory kind,
        string memory description,
        bytes memory imageSvg,
        string memory attributes,
        uint8 dominantColour,
        uint8 coloursUsed
    ) {
        Shot memory value = _shots[tokenId];
        if (value.capturer == address(0)) revert ShotDoesNotExist(tokenId);
        (uint8[1024] memory pixels, uint8 dominant, uint8 used) = _portrait(value);

        kind = "block portrait";
        description = "one monad block, photographed as proposer, epoch and parent-hash pixels.";
        imageSvg = _render(pixels);
        dominantColour = dominant;
        coloursUsed = used;

        string memory proposer = value.proposerKnown
            ? string.concat("validator ", uint256(value.proposerValId).toString())
            : "unknown";
        string memory epochText = value.epochKnown ? uint256(value.epoch).toString() : "unknown";
        attributes = string(
            abi.encodePacked(
                ',{"trait_type":"Block","display_type":"number","value":', uint256(value.blockNumber).toString(), '}',
                ',{"trait_type":"Timestamp","display_type":"date","value":', uint256(value.timestamp).toString(), '}',
                ',{"trait_type":"Epoch","value":"', epochText, '"}',
                ',{"trait_type":"Epoch Delay","value":"', value.epochKnown ? (value.inEpochDelay ? "yes" : "no") : "unknown", '"}',
                ',{"trait_type":"Proposer","value":"', proposer, '"}',
                ',{"trait_type":"Parent Hash","value":"', _shortHash(value.parentHash), '"}',
                ',{"trait_type":"Season","display_type":"number","value":', (uint256(value.season) + 1).toString(), '}',
                ',{"trait_type":"Captured By","value":"', LibString.toHexStringChecksummed(value.capturer), '"}',
                ',{"trait_type":"Staking Device","value":"', (value.proposerKnown || value.epochKnown) ? "present" : "absent", '"}'
            )
        );
    }

    function canBurn(uint256 tokenId) external view returns (bool) {
        if (_shots[tokenId].capturer == address(0)) revert ShotDoesNotExist(tokenId);
        return false;
    }

    function _portrait(Shot memory value)
        private
        pure
        returns (uint8[1024] memory pixels, uint8 dominantColour, uint8 coloursUsed)
    {
        uint8 bg0 = 1;
        uint8 bg1 = 1;
        uint8 pattern;
        if (value.epochKnown) {
            bytes32 epochSeed = keccak256(abi.encodePacked("epoch", value.epoch));
            bg0 = uint8(epochSeed[0]) & 15;
            bg1 = uint8(epochSeed[1]) & 15;
            if (bg1 == bg0) bg1 = (bg0 + 1) & 15;
            pattern = uint8(value.epoch & 3);
        }

        for (uint256 y; y < 32; ++y) {
            for (uint256 x; x < 32; ++x) {
                uint8 colour = bg0;
                if (pattern == 1) colour = (y & 1) == 0 ? bg0 : bg1;
                else if (pattern == 2) colour = (x & 1) == 0 ? bg0 : bg1;
                else if (pattern == 3) colour = ((x + y) & 1) == 0 ? bg0 : bg1;
                pixels[y * 32 + x] = colour;
            }
        }

        uint8 frameColour = uint8((uint256(value.season) % 15) + 1);
        for (uint256 i; i < 32; ++i) {
            pixels[i] = frameColour;
            pixels[31 * 32 + i] = frameColour;
            pixels[i * 32] = frameColour;
            pixels[i * 32 + 31] = frameColour;
        }

        if (value.epochKnown && value.inEpochDelay) {
            for (uint256 x; x < 32; ++x) pixels[x] = (x & 1) == 0 ? 4 : 5;
        }

        if (value.proposerKnown) _knownGlyph(pixels, value.proposerValId);
        else _unknownGlyph(pixels);

        for (uint256 i; i < 16; ++i) {
            uint8 a = uint8(value.parentHash[i]);
            uint8 b = uint8(value.parentHash[16 + i]);
            uint256 x = uint256(a >> 4) * 2 + (b & 1);
            uint256 y = uint256(a & 0x0f) * 2 + ((b >> 1) & 1);
            if (x >= 10 && x <= 21 && y >= 8 && y <= 19) y = (i & 1) == 0 ? 3 : 25;
            pixels[y * 32 + x] = 7;
        }

        uint8 corner = uint8(uint160(value.capturer)) & 15;
        if (corner == 0) corner = 12;
        pixels[1 * 32 + 1] = corner;
        pixels[1 * 32 + 2] = corner;
        pixels[2 * 32 + 1] = corner;
        pixels[2 * 32 + 2] = corner;

        uint32 barcode = uint32(value.blockNumber);
        for (uint256 x; x < 32; ++x) {
            uint8 colour = ((barcode >> (31 - x)) & 1) == 1 ? 7 : 1;
            pixels[30 * 32 + x] = colour;
            pixels[31 * 32 + x] = colour;
        }

        uint256[16] memory counts;
        for (uint256 i; i < 1024; ++i) ++counts[pixels[i]];
        uint256 best;
        for (uint8 i; i < 16; ++i) {
            if (counts[i] != 0) ++coloursUsed;
            if (counts[i] > best) {
                best = counts[i];
                dominantColour = i;
            }
        }
    }

    function _knownGlyph(uint8[1024] memory pixels, uint64 valId) private pure {
        bytes32 seed = keccak256(abi.encodePacked("validator", valId));
        uint8 c0 = uint8(seed[0]) & 15;
        uint8 c1 = uint8(seed[1]) & 15;
        if (c1 == c0) c1 = (c0 + 1) & 15;
        uint256 bits = uint256(seed);
        for (uint256 y; y < 12; ++y) {
            for (uint256 x; x < 6; ++x) {
                uint256 bit = y * 6 + x;
                if (((bits >> bit) & 1) == 0) continue;
                uint8 colour = ((bits >> (bit + 96)) & 1) == 0 ? c0 : c1;
                uint256 px = 10 + x;
                uint256 py = 8 + y;
                pixels[py * 32 + px] = colour;
                pixels[py * 32 + (21 - x)] = colour;
            }
        }
    }

    function _unknownGlyph(uint8[1024] memory pixels) private pure {
        // Fixed 12x12 question-mark glyph. Black/white palette dithering reads as grey without adding a 17th colour.
        for (uint256 x = 13; x <= 18; ++x) _setGrey(pixels, x, 10);
        _setGrey(pixels, 12, 11);
        _setGrey(pixels, 19, 11);
        _setGrey(pixels, 19, 12);
        _setGrey(pixels, 18, 13);
        _setGrey(pixels, 17, 14);
        _setGrey(pixels, 16, 15);
        _setGrey(pixels, 16, 17);
    }

    function _setGrey(uint8[1024] memory pixels, uint256 x, uint256 y) private pure {
        pixels[y * 32 + x] = ((x + y) & 1) == 0 ? 1 : 7;
    }

    function _render(uint8[1024] memory pixels) private pure returns (bytes memory svg) {
        svg = new bytes(96_000);
        uint256 cursor;
        cursor = _append(svg, cursor, bytes('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32" shape-rendering="crispEdges">'));
        for (uint256 y; y < 32; ++y) {
            uint256 x;
            while (x < 32) {
                uint8 colour = pixels[y * 32 + x];
                uint256 end = x + 1;
                while (end < 32 && pixels[y * 32 + end] == colour) ++end;
                cursor = _append(svg, cursor, bytes('<rect x="'));
                cursor = _appendSmall(svg, cursor, x);
                cursor = _append(svg, cursor, bytes('" y="'));
                cursor = _appendSmall(svg, cursor, y);
                cursor = _append(svg, cursor, bytes('" width="'));
                cursor = _appendSmall(svg, cursor, end - x);
                cursor = _append(svg, cursor, bytes('" height="1" fill="#'));
                cursor = _appendRgb(svg, cursor, R3tardsPalette.rgb(colour));
                cursor = _append(svg, cursor, bytes('"/>'));
                x = end;
            }
        }
        cursor = _append(svg, cursor, bytes('</svg>'));
        assembly ("memory-safe") { mstore(svg, cursor) }
    }

    function _append(bytes memory out, uint256 cursor, bytes memory value) private pure returns (uint256 next) {
        uint256 length = value.length;
        assembly ("memory-safe") {
            let src := add(value, 0x20)
            let dst := add(add(out, 0x20), cursor)
            for { let end := add(src, length) } lt(src, end) { src := add(src, 0x20) dst := add(dst, 0x20) } {
                mstore(dst, mload(src))
            }
        }
        return cursor + length;
    }

    function _appendSmall(bytes memory out, uint256 cursor, uint256 value) private pure returns (uint256) {
        if (value >= 10) out[cursor++] = bytes1(uint8(48 + value / 10));
        out[cursor++] = bytes1(uint8(48 + value % 10));
        return cursor;
    }

    function _appendRgb(bytes memory out, uint256 cursor, uint24 rgb) private pure returns (uint256) {
        bytes16 chars = "0123456789ABCDEF";
        for (uint256 shift = 20; ; shift -= 4) {
            out[cursor++] = chars[(rgb >> shift) & 0x0f];
            if (shift == 0) break;
        }
        return cursor;
    }

    function _shortHash(bytes32 value) private pure returns (string memory) {
        bytes16 chars = "0123456789abcdef";
        bytes memory out = new bytes(15);
        out[0] = bytes1(uint8(0x30));
        out[1] = bytes1(uint8(0x78));
        for (uint256 i; i < 4; ++i) {
            uint8 b = uint8(value[i]);
            out[2 + i * 2] = chars[b >> 4];
            out[3 + i * 2] = chars[b & 0x0f];
        }
        out[10] = 0xe2;
        out[11] = 0x80;
        out[12] = 0xa6;
        uint8 tail = uint8(value[31]);
        out[13] = chars[tail >> 4];
        out[14] = chars[tail & 0x0f];
        return string(out);
    }
}
