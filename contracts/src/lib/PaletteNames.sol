// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical marketplace names for the 16-colour r3tards palette.
library PaletteNames {
    function name(uint8 index) internal pure returns (string memory) {
        if (index == 0) return "background";
        if (index == 1) return "black";
        if (index == 2) return "trippie brown";
        if (index == 3) return "old man olive";
        if (index == 4) return "juicy red";
        if (index == 5) return "gold";
        if (index == 6) return "og pink";
        if (index == 7) return "white";
        if (index == 8) return "green";
        if (index == 9) return "nad magenta";
        if (index == 10) return "purple";
        if (index == 11) return "DF1 cyan";
        if (index == 12) return "BTC orange";
        if (index == 13) return "waifu pink";
        if (index == 14) return "pill purple";
        if (index == 15) return "emoji orange";
        return "background";
    }
}
