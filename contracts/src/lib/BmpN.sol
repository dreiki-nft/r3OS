// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Encodes a top-down square RGB raster as a 24-bit bottom-up BMP.
/// @dev Handles arbitrary small square sizes, including the row padding required by 24-bit BMPs.
library BmpN {
    uint256 private constant BMP_HEADER = 54;

    error InvalidRaster();

    function encode(bytes memory rgb, uint256 size) internal pure returns (bytes memory bmp) {
        if (size == 0 || size > type(uint32).max) revert InvalidRaster();
        uint256 rowBytes = size * 3;
        uint256 expected = rowBytes * size;
        if (rgb.length != expected) revert InvalidRaster();
        uint256 stride = (rowBytes + 3) & ~uint256(3);
        uint256 pixelBytes = stride * size;
        if (pixelBytes > type(uint32).max || BMP_HEADER + pixelBytes > type(uint32).max) revert InvalidRaster();

        bmp = new bytes(BMP_HEADER + pixelBytes);
        bmp[0] = 0x42;
        bmp[1] = 0x4d;
        _le32(bmp, 2, uint32(bmp.length));
        _le32(bmp, 10, uint32(BMP_HEADER));
        _le32(bmp, 14, 40);
        _le32(bmp, 18, uint32(size));
        _le32(bmp, 22, uint32(size));
        _le16(bmp, 26, 1);
        _le16(bmp, 28, 24);
        _le32(bmp, 34, uint32(pixelBytes));

        assembly ("memory-safe") {
            let header := 54
            let sp := add(rgb, 0x20)
            let bp := add(bmp, 0x20)
            for { let y := 0 } lt(y, size) { y := add(y, 1) } {
                let d := add(bp, add(header, mul(sub(sub(size, 1), y), stride)))
                let s := add(sp, mul(y, rowBytes))
                for { let x := 0 } lt(x, size) { x := add(x, 1) } {
                    let w := mload(s)
                    mstore8(d, byte(2, w))
                    mstore8(add(d, 1), byte(1, w))
                    mstore8(add(d, 2), byte(0, w))
                    s := add(s, 3)
                    d := add(d, 3)
                }
            }
        }
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
