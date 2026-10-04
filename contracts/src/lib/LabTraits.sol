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

    /// @dev Flipbook reels contain 8..32 frames. The buckets cover that real range.
    function reelLength(uint256 frames) internal pure returns (string memory) {
        if (frames <= 11) return "Short";
        if (frames <= 19) return "Medium";
        if (frames <= 27) return "Long";
        return "Epic";
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

    function dreamSize(uint256 pixels) internal pure returns (string memory) {
        if (pixels < 256) return "Nap";
        if (pixels < 1_024) return "Dream";
        return "Epic dream";
    }

    function nightShift(uint256 helpers) internal pure returns (string memory) {
        if (helpers <= 1) return "Alone";
        if (helpers <= 5) return "Helped";
        return "Crowd";
    }

    function survival(uint256 basisPoints) internal pure returns (string memory) {
        if (basisPoints >= 9_000) return "Intact";
        if (basisPoints >= 5_000) return "Scarred";
        return "Ghost";
    }

    /// @param depth One-based marketplace depth: 1 for a frame fork, 2 for its child.
    function lineage(uint256 depth) internal pure returns (string memory) {
        if (depth <= 1) return "Original";
        if (depth == 2) return "Remix";
        return "Deep remix";
    }
}
