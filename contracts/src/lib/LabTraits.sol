// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared string buckets used by r3OS labs marketplace metadata.
library LabTraits {
    function palette(uint256 colours) internal pure returns (string memory) {
        if (colours <= 2) return "Mono";
        if (colours <= 5) return "Few";
        if (colours <= 10) return "Rich";
        return "Full";
    }

    function tempo(uint256 averageMs) internal pure returns (string memory) {
        if (averageMs <= 400) return "Real-time";
        if (averageMs <= 1_000) return "Smooth";
        if (averageMs <= 5_000) return "Steady";
        return "Slow";
    }

    function validatorMix(uint256 validators) internal pure returns (string memory) {
        if (validators <= 1) return "Single";
        if (validators <= 4) return "Few";
        return "Many";
    }

    function crowd(uint256 painters) internal pure returns (string memory) {
        if (painters <= 1) return "Solo";
        if (painters == 2) return "Duo";
        if (painters <= 9) return "Group";
        return "Crowd";
    }

    function activity(uint256 paints) internal pure returns (string memory) {
        if (paints == 0) return "Untouched";
        if (paints <= 9) return "Light";
        if (paints <= 99) return "Worked";
        return "Busy";
    }

    function cdFormat(uint256 tracks) internal pure returns (string memory) {
        if (tracks <= 1) return "Single";
        if (tracks <= 4) return "EP";
        if (tracks <= 8) return "Album";
        return "Full length";
    }

    function survival(uint256 basisPoints) internal pure returns (string memory) {
        if (basisPoints >= 9_000) return "Intact";
        if (basisPoints >= 5_000) return "Scarred";
        return "Ghost";
    }
}
