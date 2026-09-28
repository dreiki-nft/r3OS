// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BmpN} from "./BmpN.sol";

/// @notice Backwards-compatible 64x64 wrapper around the generic BMP encoder.
library Bmp64 {
    function encode(bytes memory rgb64) internal pure returns (bytes memory bmp) {
        return BmpN.encode(rgb64, 64);
    }
}
