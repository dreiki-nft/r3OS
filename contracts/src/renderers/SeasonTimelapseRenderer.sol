// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "solady/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IFrameRenderer} from "../interfaces/IFrameRenderer.sol";
import {IR3OSPaintData} from "../interfaces/IR3OSPaintData.sol";
import {FrameTraits} from "../lib/FrameTraits.sol";

/// @notice Finale-only animated renderer. Samples at most four frames, downsamples each to 128x128,
/// then builds the SVG in one pre-sized buffer instead of repeated string concatenation.
contract SeasonTimelapseRenderer is IFrameRenderer {
    using Strings for uint256;

    uint256 public constant MAX_TIMELAPSE_FRAMES = 4;
    uint256 private constant PIXEL_BYTES_128 = 8_192;
    uint256 private constant BMP_OFFSET = 118;
    uint256 private constant NIBBLE_ONES =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    function tokenURI(address paint, uint256 tokenId) external view returns (string memory) {
        IR3OSPaintData core = IR3OSPaintData(paint);
        IR3OSPaintData.FrameInfoData memory finale = core.frameInfo(tokenId);
        if (!finale.finale) revert("timelapse: finale only");

        (,,,, uint64 regularFrames,,,) = core.seasonInfo(finale.season);
        uint256 totalVisuals = uint256(regularFrames) + 1;
        uint256 count = totalVisuals < MAX_TIMELAPSE_FRAMES ? totalVisuals : MAX_TIMELAPSE_FRAMES;
        bytes memory outlineMask = _outlineMask128(core.seasonOutlineRuns(finale.season));
        uint24[16] memory colors = core.palette();
        bytes[] memory images = new bytes[](count);
        uint256 imagesLength;

        for (uint256 i; i < count; ++i) {
            uint256 visualIndex = count == 1 ? totalVisuals - 1 : (i * (totalVisuals - 1)) / (count - 1);
            uint256 frameId = visualIndex == regularFrames
                ? tokenId
                : core.seasonFrameToken(finale.season, uint48(visualIndex + 1));
            IR3OSPaintData.FrameInfoData memory info = core.frameInfo(frameId);
            bytes memory pixels = core.frameData128(frameId);
            _stampOutline(pixels, outlineMask, info.faceColor);
            bytes memory bmp = _buildBMP128(pixels, info.backgroundColor, colors);
            images[i] = bytes(Base64.encode(bmp));
            imagesLength += images[i].length;
        }

        bytes memory svg = _buildSvg(images, imagesLength);
        bytes memory json = abi.encodePacked(
            '{"name":"r3OS paint season ', (uint256(finale.season) + 1).toString(),
            ' timelapse","description":"sampled frames from this season, rendered with that season own outline.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(svg), '\",\"attributes\":[',
            FrameTraits.attributes(core, tokenId), ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    /// @dev Built once per tokenURI: 0xF nibble wherever the season outline covers the sampled pixel.
    function _outlineMask128(bytes memory runs) private pure returns (bytes memory mask) {
        mask = new bytes(PIXEL_BYTES_128);
        for (uint256 o; o < runs.length; o += 3) {
            uint256 y = uint8(runs[o]);
            if ((y & 1) != 0) continue; // top-left sample of each 2x2 source block
            uint256 x0 = uint8(runs[o + 1]);
            uint256 x1 = uint8(runs[o + 2]);
            uint256 x = (x0 & 1) == 0 ? x0 : x0 + 1;
            uint256 row = 127 - (y >> 1); // packed data is BMP bottom-up
            for (; x <= x1; x += 2) {
                uint256 sx = x >> 1;
                uint256 index = row * 64 + (sx >> 1);
                mask[index] = bytes1(uint8(mask[index]) | ((sx & 1) == 0 ? 0xF0 : 0x0F));
            }
        }
    }

    /// @dev Word-level: pixels = (pixels & ~mask) | (faceNibbles & mask).
    function _stampOutline(bytes memory pixels, bytes memory mask, uint8 face) private pure {
        uint256 fill = NIBBLE_ONES * face;
        assembly ("memory-safe") {
            let p := add(pixels, 0x20)
            let m := add(mask, 0x20)
            for { let i := 0 } lt(i, PIXEL_BYTES_128) { i := add(i, 0x20) } {
                let mw := mload(add(m, i))
                if mw { mstore(add(p, i), or(and(mload(add(p, i)), not(mw)), and(fill, mw))) }
            }
        }
    }

    function _buildBMP128(bytes memory pixels, uint8 background, uint24[16] memory colors)
        private
        pure
        returns (bytes memory bmp)
    {
        bmp = new bytes(BMP_OFFSET + PIXEL_BYTES_128);
        bmp[0] = 0x42;
        bmp[1] = 0x4d;
        _le32(bmp, 2, uint32(bmp.length));
        _le32(bmp, 10, uint32(BMP_OFFSET));
        _le32(bmp, 14, 40);
        _le32(bmp, 18, 128);
        _le32(bmp, 22, 128);
        _le16(bmp, 26, 1);
        _le16(bmp, 28, 4);
        _le32(bmp, 34, uint32(PIXEL_BYTES_128));
        _le32(bmp, 46, 16);
        _le32(bmp, 50, 16);
        for (uint256 i; i < 16; ++i) {
            uint24 rgb = i == 0 ? colors[background] : colors[i];
            uint256 p = 54 + i * 4;
            bmp[p] = bytes1(uint8(rgb));
            bmp[p + 1] = bytes1(uint8(rgb >> 8));
            bmp[p + 2] = bytes1(uint8(rgb >> 16));
        }
        assembly ("memory-safe") {
            let src := add(pixels, 0x20)
            let dst := add(add(bmp, 0x20), BMP_OFFSET)
            for { let i := 0 } lt(i, PIXEL_BYTES_128) { i := add(i, 0x20) } {
                mstore(add(dst, i), mload(add(src, i)))
            }
        }
    }

    function _buildSvg(bytes[] memory images, uint256 imagesLength) private pure returns (bytes memory out) {
        uint256 count = images.length;
        uint256 visiblePct = count == 1 ? 100 : 100 / count;
        uint256 hiddenPct = count == 1 ? 100 : visiblePct + 1;
        bytes memory prefix = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
            '<style>@keyframes f{0%,', visiblePct.toString(), '%{opacity:1}', hiddenPct.toString(),
            '%,100%{opacity:0}}.f{opacity:0;animation-name:f;animation-timing-function:steps(1,end);animation-iteration-count:infinite}</style>'
        );
        bytes memory suffix = bytes('</svg>');
        bytes[] memory heads = new bytes[](count);
        bytes memory tail = bytes('"/>');
        uint256 total = prefix.length + suffix.length + imagesLength + tail.length * count;
        for (uint256 i; i < count; ++i) {
            heads[i] = abi.encodePacked(
                '<image class="f" width="1024" height="1024" style="image-rendering:pixelated;animation-duration:',
                count.toString(), 's;animation-delay:-', ((count - i) % count).toString(), 's" href="data:image/bmp;base64,'
            );
            total += heads[i].length;
        }

        out = new bytes(total);
        uint256 cursor;
        cursor = _copy(out, cursor, prefix);
        for (uint256 i; i < count; ++i) {
            cursor = _copy(out, cursor, heads[i]);
            cursor = _copy(out, cursor, images[i]);
            cursor = _copy(out, cursor, tail);
        }
        _copy(out, cursor, suffix);
    }

    function _copy(bytes memory dst, uint256 cursor, bytes memory src) private pure returns (uint256 next) {
        uint256 len = src.length;
        assembly ("memory-safe") {
            let source := add(src, 0x20)
            let target := add(add(dst, 0x20), cursor)
            for { let i := 0 } lt(i, len) { i := add(i, 0x20) } {
                mstore(add(target, i), mload(add(source, i)))
            }
        }
        next = cursor + len;
    }

    function _le16(bytes memory b, uint256 o, uint16 v) private pure {
        b[o] = bytes1(uint8(v));
        b[o + 1] = bytes1(uint8(v >> 8));
    }

    function _le32(bytes memory b, uint256 o, uint32 v) private pure {
        b[o] = bytes1(uint8(v));
        b[o + 1] = bytes1(uint8(v >> 8));
        b[o + 2] = bytes1(uint8(v >> 16));
        b[o + 3] = bytes1(uint8(v >> 24));
    }
}
