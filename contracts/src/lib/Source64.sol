// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The shared 64x64 view of a 256x256 frame, used by DF1Renderer.
/// @dev Output rows are top-down. Row y is one word: pixel x is the nibble at bits [252 - 4x, 255 - 4x],
/// which is also the byte layout of a 4bpp BMP row (high nibble = left pixel).
/// Each 64x64 cell samples the top-left pixel of its 4x4 source block. A cell becomes the face colour when
/// at least 6 of its 16 source pixels are outline pixels.
library Source64 {
    /// @param background  frameData(tokenId): 256x256 4bpp, BMP bottom-up (32,768 bytes).
    /// @param outline     genesisFrameData(season): same layout, outline nibbles = 1, all others = 0.
    function rows(bytes memory background, bytes memory outline, uint8 face)
        internal
        pure
        returns (uint256[64] memory out)
    {
        uint64[64] memory mask = outlineMask64(outline);
        assembly ("memory-safe") {
            let lane16 := 0x000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F
            let lane32 := 0x000000FF000000FF000000FF000000FF000000FF000000FF000000FF000000FF
            let lane64 := 0x000000000000FFFF000000000000FFFF000000000000FFFF000000000000FFFF
            let lane128 := or(shl(128, 0xFFFFFFFF), 0xFFFFFFFF)
            let low64 := 0xFFFFFFFFFFFFFFFF
            let faceWord := mul(and(face, 0x0F), 0x1111111111111111111111111111111111111111111111111111111111111111)
            let src := add(background, 0x20)
            for { let y := 0 } lt(y, 64) { y := add(y, 1) } {
                // top-down source row 4y is bottom-up row 255 - 4y
                let p := add(src, mul(sub(255, mul(4, y)), 128))
                let row := 0
                for { let k := 0 } lt(k, 4) { k := add(k, 1) } {
                    // 64 source pixels; keep pixels 0, 4, 8, ... = the high nibble of every even byte
                    let x := and(shr(12, mload(add(p, mul(k, 32)))), lane16)
                    x := and(or(x, shr(12, x)), lane32)
                    x := and(or(x, shr(24, x)), lane64)
                    x := and(or(x, shr(48, x)), lane128)
                    x := and(or(x, shr(96, x)), low64)
                    row := or(row, shl(sub(192, mul(64, k)), x))
                }
                // spread the 64 outline bits (bit 63 - x) to one nibble each, then paint those nibbles face
                let b := mload(add(mask, mul(y, 0x20)))
                b := and(or(b, shl(96, b)), lane128)
                b := and(or(b, shl(48, b)), lane64)
                b := and(or(b, shl(24, b)), lane32)
                b := and(or(b, shl(12, b)), lane16)
                b := and(or(b, shl(6, b)), 0x0303030303030303030303030303030303030303030303030303030303030303)
                b := and(or(b, shl(3, b)), 0x1111111111111111111111111111111111111111111111111111111111111111)
                let nibbles := mul(b, 0x0F)
                row := or(and(row, not(nibbles)), and(faceWord, nibbles))
                mstore(add(out, mul(y, 0x20)), row)
            }
        }
    }

    /// @notice 64 row masks; bit 63 - x set when cell (x, y) has at least 6 of 16 outline pixels.
    /// @dev Constant cost: it does not depend on how many runs the season outline was written with.
    function outlineMask64(bytes memory outline) internal pure returns (uint64[64] memory mask) {
        assembly ("memory-safe") {
            // 16 lanes of 16 bits per word; one lane = one 4-pixel-wide cell.
            let lo := 0x000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F
            let ten := 0x000A000A000A000A000A000A000A000A000A000A000A000A000A000A000A000A
            let one := 0x0001000100010001000100010001000100010001000100010001000100010001
            let m2 := 0x0000000300000003000000030000000300000003000000030000000300000003
            let m4 := 0x000000000000000F000000000000000F000000000000000F000000000000000F
            let m8 := or(shl(128, 0xFF), 0xFF)
            let src := add(outline, 0x20)
            for { let cy := 0 } lt(cy, 64) { cy := add(cy, 1) } {
                // top-down rows 4cy..4cy+3 are bottom-up rows 252-4cy..255-4cy
                let base := add(src, mul(sub(252, mul(4, cy)), 128))
                let row := 0
                for { let k := 0 } lt(k, 4) { k := add(k, 1) } {
                    let p := add(base, mul(k, 32))
                    // each nibble is 0 or 1, so four rows sum to at most 4 per nibble
                    let s := add(add(mload(p), mload(add(p, 128))), add(mload(add(p, 256)), mload(add(p, 384))))
                    // fold 4 nibbles per lane: lane total is 0..16
                    let t := add(add(and(s, lo), and(shr(4, s), lo)), add(and(shr(8, s), lo), and(shr(12, s), lo)))
                    // lane total >= 6  <=>  bit 4 of (total + 10)
                    let x := and(shr(4, add(t, ten)), one)
                    // gather the 16 lane flags (lane 0 = leftmost cell = MSB lane) into 16 bits
                    x := and(or(x, shr(15, x)), m2)
                    x := and(or(x, shr(30, x)), m4)
                    x := and(or(x, shr(60, x)), m8)
                    x := and(or(x, shr(120, x)), 0xFFFF)
                    row := or(row, shl(sub(48, mul(16, k)), x))
                }
                mstore(add(mask, mul(cy, 0x20)), row)
            }
        }
    }
}
