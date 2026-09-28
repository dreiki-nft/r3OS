// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Block DNA brush v1: an 8x8, mirror-symmetric, up-to-3-colour brush derived from a block hash.
library BrushDNA {
    /// @dev Brush word layout:
    ///   bits [16r + 2c, 16r + 2c + 1]  cell (row r, column c), 0 = transparent, 1..3 = colour slot
    ///   bits [128..131] colour 1, [132..135] colour 2, [136..139] colour 3 (palette indices, never 0 or 7)
    ///   bits [160..207] source block number
    function fromBlockhash(bytes32 blockHash, uint256 blockNumber) internal pure returns (uint256 brush) {
        uint256 dna = uint256(keccak256(abi.encode("r3tards.brush.v1", blockHash, blockNumber)));
        for (uint256 r; r < 8; ++r) {
            for (uint256 c; c < 4; ++c) {
                uint256 v = (dna >> (3 * (r * 4 + c))) & 7;
                uint256 s = v <= 2 ? 0 : v <= 5 ? 1 : v == 6 ? 2 : 3;
                brush |= s << (16 * r + 2 * c);
                brush |= s << (16 * r + 2 * (7 - c));
            }
        }
        brush |= uint256(_colour((dna >> 96) & 0xFF)) << 128;
        brush |= uint256(_colour((dna >> 104) & 0xFF)) << 132;
        brush |= uint256(_colour((dna >> 112) & 0xFF)) << 136;
        brush |= (blockNumber & 0xFFFFFFFFFFFF) << 160;
    }

    /// @dev 14 usable colours: palette 1..15 without 7 (7 is a second white).
    function _colour(uint256 b) private pure returns (uint8) {
        uint256 i = b % 14;
        return uint8(i < 6 ? i + 1 : i + 2);
    }

    function cell(uint256 brush, uint256 r, uint256 c) internal pure returns (uint256) {
        return (brush >> (16 * r + 2 * c)) & 3;
    }

    function colour(uint256 brush, uint256 slot) internal pure returns (uint8) {
        return uint8((brush >> (124 + 4 * slot)) & 0x0F);
    }

    function blockNumberOf(uint256 brush) internal pure returns (uint256) {
        return (brush >> 160) & 0xFFFFFFFFFFFF;
    }

    /// @notice Core paint runs (y, x0, x1, colour) that stamp this brush with its top-left at (x, y).
    function runs(uint256 brush, uint8 x, uint8 y) internal pure returns (bytes memory out) {
        out = new bytes(64 * 4);
        uint256 n;
        for (uint256 r; r < 8; ++r) {
            uint256 c;
            while (c < 8) {
                uint256 s = cell(brush, r, c);
                if (s == 0) { ++c; continue; }
                uint256 c0 = c;
                while (c + 1 < 8 && cell(brush, r, c + 1) == s) ++c;
                out[n * 4] = bytes1(uint8(y + r));
                out[n * 4 + 1] = bytes1(uint8(x + c0));
                out[n * 4 + 2] = bytes1(uint8(x + c));
                out[n * 4 + 3] = bytes1(colour(brush, s));
                ++n;
                ++c;
            }
        }
        assembly ("memory-safe") { mstore(out, mul(n, 4)) }
    }
}
