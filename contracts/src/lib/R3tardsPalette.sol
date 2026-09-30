// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Exact 16-colour r3tards palette for pure renderers that cannot call the core.
library R3tardsPalette {
    function rgb(uint8 index) internal pure returns (uint24) {
        if (index == 0) return 0xFFFFFF;
        if (index == 1) return 0x000000;
        if (index == 2) return 0x965E4B;
        if (index == 3) return 0x877549;
        if (index == 4) return 0xC52020;
        if (index == 5) return 0xFEC343;
        if (index == 6) return 0xEE93E3;
        if (index == 7) return 0xFFFFFF;
        if (index == 8) return 0x07992F;
        if (index == 9) return 0xA0055D;
        if (index == 10) return 0x694B87;
        if (index == 11) return 0x5FEDDF;
        if (index == 12) return 0xF7931A;
        if (index == 13) return 0xC864AA;
        if (index == 14) return 0x9F70DA;
        return 0xD47827;
    }
}
