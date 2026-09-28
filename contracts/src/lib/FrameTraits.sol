// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {LibString} from "solady/utils/LibString.sol";
import {IR3tardsPaintData} from "../interfaces/IR3tardsPaintData.sol";

/// @notice Shared marketplace traits for opt-in frame renderers.
/// @dev Returns the comma-separated JSON attribute objects without the surrounding array brackets.
library FrameTraits {
    using Strings for uint256;

    function attributes(IR3tardsPaintData core, uint256 tokenId) internal view returns (string memory) {
        if (tokenId == 0) return _liveAttributes(core);

        IR3tardsPaintData.FrameInfoData memory f = core.frameInfo(tokenId);
        return string(
            abi.encodePacked(
                '{"trait_type":"Season","value":', (uint256(f.season) + 1).toString(),
                '},{"trait_type":"Frame","value":', uint256(f.frameNumber).toString(),
                '},{"trait_type":"Season frame","value":', uint256(f.seasonFrameIndex).toString(),
                '},{"trait_type":"Monad block","value":', uint256(f.blockNumber).toString(),
                '},{"trait_type":"DF1","value":', uint256(f.df1Amount).toString(),
                '},{"trait_type":"Paints since previous frame","value":',
                uint256(f.paintsSincePreviousFrame).toString(),
                '},{"trait_type":"Face","value":"', f.faceColor == 1 ? "black" : "white",
                '"},{"trait_type":"Background","value":"', _backgroundName(f.backgroundColor),
                '"},{"trait_type":"Holder at mint","value":"', f.holderAtMint ? "yes" : "no",
                '"},{"trait_type":"Sealed by","value":"', LibString.toHexStringChecksummed(f.proposer),
                '"},{"trait_type":"Storm","value":"', core.isStorm(f.blockNumber) ? "yes" : "no", '"}',
                _character(core, f.season)
            )
        );
    }

    function _liveAttributes(IR3tardsPaintData core) private view returns (string memory) {
        uint256 season = core.currentSeason();
        return string(
            abi.encodePacked(
                '{"trait_type":"Season","value":', (season + 1).toString(),
                '},{"trait_type":"Face","value":"', core.faceColor(season) == 1 ? "black" : "white",
                '"},{"trait_type":"Background","value":"', _backgroundName(core.backgroundColor(season)),
                '"},{"trait_type":"Storm","value":"', core.isStorm(block.number) ? "yes" : "no", '"}',
                _character(core, season)
            )
        );
    }

    function _character(IR3tardsPaintData core, uint256 season) private view returns (string memory) {
        string memory guest = core.seasonGuest(season);
        if (bytes(guest).length != 0) {
            return string.concat(',{"trait_type":"Guest","value":"', _jsonEscape(guest), '"}');
        }
        if (!core.hasCustomOutline(season)) return ',{"trait_type":"Character","value":"r3tard"}';
        return "";
    }

    function _backgroundName(uint8 color) private pure returns (string memory) {
        if (color == 0) return "white";
        if (color == 5) return "gold";
        if (color == 6) return "og";
        if (color == 8) return "green";
        if (color == 9) return "nad";
        if (color == 10) return "purple";
        return "DF1 cyan";
    }

    function _jsonEscape(string memory value) private pure returns (string memory) {
        bytes memory src = bytes(value);
        uint256 extra;
        for (uint256 i; i < src.length; ++i) {
            if (src[i] == 0x22 || src[i] == 0x5c) ++extra;
        }
        if (extra == 0) return value;

        bytes memory out = new bytes(src.length + extra);
        uint256 j;
        for (uint256 i; i < src.length; ++i) {
            bytes1 c = src[i];
            if (c == 0x22 || c == 0x5c) out[j++] = 0x5c;
            out[j++] = c;
        }
        return string(out);
    }
}
