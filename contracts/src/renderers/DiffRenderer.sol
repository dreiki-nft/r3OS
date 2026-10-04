// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "solady/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IFrameRenderer} from "../interfaces/IFrameRenderer.sol";
import {IR3OSPaintData} from "../interfaces/IR3OSPaintData.sol";
import {FrameTraits} from "../lib/FrameTraits.sol";

contract DiffRenderer is IFrameRenderer {
    using Strings for uint256;
    uint256 private constant PIXEL_BYTES = 32_768;
    uint256 private constant BMP_OFFSET = 118;
    uint256 private constant NIBBLE_LSB =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    function tokenURI(address paint, uint256 tokenId) external view returns (string memory) {
        if (tokenId == 0) revert("diff: live canvas unsupported");
        IR3OSPaintData core = IR3OSPaintData(paint);
        IR3OSPaintData.FrameInfoData memory info = core.frameInfo(tokenId);
        bytes memory current = core.frameCompositeData(tokenId);
        bytes memory previous;

        if (info.finale) {
            if (info.seasonFrameIndex == 0) previous = core.genesisFrameData(info.season);
            else previous = core.frameCompositeData(core.seasonFrameToken(info.season, info.seasonFrameIndex));
        } else if (info.seasonFrameIndex <= 1) {
            previous = core.genesisFrameData(info.season);
        } else {
            previous = core.frameCompositeData(core.seasonFrameToken(info.season, info.seasonFrameIndex - 1));
        }

        bytes memory diff = new bytes(PIXEL_BYTES);
        for (uint256 o; o < PIXEL_BYTES; o += 32) {
            uint256 a;
            uint256 b;
            assembly ("memory-safe") {
                a := mload(add(add(current, 0x20), o))
                b := mload(add(add(previous, 0x20), o))
            }
            uint256 lsb = _nibbleNonZeroLsb(a ^ b);
            uint256 changedMask = lsb * 0xF;
            uint256 word = (a & ~changedMask) | (lsb * 4); // juicy red on changed nibbles
            assembly ("memory-safe") { mstore(add(add(diff, 0x20), o), word) }
        }

        uint24[16] memory colors = core.palette();
        bytes memory bmp = _buildBMP(diff, colors);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
            '<image width="1024" height="1024" style="image-rendering:pixelated" href="data:image/bmp;base64,',
            Base64.encode(bmp), '"/></svg>'
        );
        string memory json = string.concat(
            '{"name":"r3OS paint diff #', tokenId.toString(),
            '","description":"pixels changed since the previous frame in this season are highlighted red.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)), '\",\"attributes\":[', FrameTraits.attributes(core, tokenId), ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _nibbleNonZeroLsb(uint256 x) private pure returns (uint256) {
        uint256 y = x | (x >> 1);
        y |= y >> 2;
        return y & NIBBLE_LSB;
    }

    function _buildBMP(bytes memory pixels, uint24[16] memory colors) private pure returns (bytes memory bmp) {
        bmp = new bytes(BMP_OFFSET + PIXEL_BYTES);
        bmp[0] = 0x42; bmp[1] = 0x4d;
        _le32(bmp, 2, uint32(bmp.length)); _le32(bmp, 10, uint32(BMP_OFFSET)); _le32(bmp, 14, 40);
        _le32(bmp, 18, 256); _le32(bmp, 22, 256); _le16(bmp, 26, 1); _le16(bmp, 28, 4);
        _le32(bmp, 34, uint32(PIXEL_BYTES)); _le32(bmp, 46, 16); _le32(bmp, 50, 16);
        for (uint256 i; i < 16; ++i) {
            uint24 rgb = colors[i];
            uint256 p = 54 + i * 4;
            bmp[p] = bytes1(uint8(rgb)); bmp[p + 1] = bytes1(uint8(rgb >> 8)); bmp[p + 2] = bytes1(uint8(rgb >> 16));
        }
        assembly ("memory-safe") {
            let src := add(pixels, 0x20)
            let dst := add(add(bmp, 0x20), BMP_OFFSET)
            for { let i := 0 } lt(i, PIXEL_BYTES) { i := add(i, 0x20) } { mstore(add(dst, i), mload(add(src, i))) }
        }
    }

    function _le16(bytes memory b, uint256 o, uint16 v) private pure { b[o]=bytes1(uint8(v)); b[o+1]=bytes1(uint8(v>>8)); }
    function _le32(bytes memory b, uint256 o, uint32 v) private pure {
        b[o]=bytes1(uint8(v)); b[o+1]=bytes1(uint8(v>>8)); b[o+2]=bytes1(uint8(v>>16)); b[o+3]=bytes1(uint8(v>>24));
    }
}
