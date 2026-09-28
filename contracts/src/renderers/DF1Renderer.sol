// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "solady/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IFrameRenderer} from "../interfaces/IFrameRenderer.sol";
import {IR3tardsPaintData} from "../interfaces/IR3tardsPaintData.sol";
import {DF1} from "../lib/DF1.sol";
import {FrameTraits} from "../lib/FrameTraits.sol";
import {Source64} from "../lib/Source64.sol";
import {Bmp64} from "../lib/Bmp64.sol";

/// @notice Exact DF1 v1 opt-in renderer at 64x64, enlarged to 1024x1024 with nearest-neighbour pixels.
contract DF1Renderer is IFrameRenderer {
    using Strings for uint256;

    uint256 private constant SIZE = 64;
    uint256 private constant RGB_BYTES = SIZE * SIZE * 3;

    function tokenURI(address paint, uint256 tokenId) external view returns (string memory) {
        IR3tardsPaintData core = IR3tardsPaintData(paint);
        (bytes memory source, uint32 seed, uint256 amount) = _source64(core, tokenId);
        bytes memory filtered = DF1.applyDf1(source, seed, amount);
        bytes memory bmp = Bmp64.encode(filtered);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
            '<image width="1024" height="1024" style="image-rendering:pixelated" href="data:image/bmp;base64,',
            Base64.encode(bmp), '"/></svg>'
        );
        string memory name = tokenId == 0
            ? unicode"r3tards paint live canvas · df1"
            : string.concat("r3tards paint frame #", tokenId.toString(), unicode" · df1");
        bytes memory json = abi.encodePacked(
            '{"name":"', name,
            '","description":"exact DF1 v1, rendered fully onchain from the stored r3tards paint frame.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '","attributes":[',
            FrameTraits.attributes(core, tokenId),
            ',{"trait_type":"View","value":"df1"}',
            ',{"trait_type":"DF1 seed","value":', uint256(seed).toString(), '}',
            ',{"trait_type":"DF1 amount","value":', amount.toString(), '}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    /// @notice Reconstruct the exact 64x64 top-down RGB source used before DF1 is applied.
    function source64(address paint, uint256 tokenId)
        external
        view
        returns (bytes memory rgb, uint32 seed, uint256 amount)
    {
        return _source64(IR3tardsPaintData(paint), tokenId);
    }

    /// @notice Return the exact post-DF1 64x64 top-down RGB bytes used by this renderer.
    function df1Rgb64(address paint, uint256 tokenId) external view returns (bytes memory) {
        (bytes memory source, uint32 seed, uint256 amount) = _source64(IR3tardsPaintData(paint), tokenId);
        return DF1.applyDf1(source, seed, amount);
    }

    function _source64(IR3tardsPaintData core, uint256 tokenId)
        private
        view
        returns (bytes memory rgb, uint32 seed, uint256 amount)
    {
        uint256 season;
        uint8 face;
        uint8 background;
        if (tokenId == 0) {
            season = core.currentSeason();
            face = core.faceColor(season);
            background = core.backgroundColor(season);
            seed = core.df1Seed(0);
            amount = core.isStorm(block.number) ? 200 : 100;
        } else {
            IR3tardsPaintData.FrameInfoData memory info = core.frameInfo(tokenId);
            season = info.season;
            face = info.faceColor;
            background = info.backgroundColor;
            seed = core.df1Seed(tokenId);
            amount = info.df1Amount < 100 ? 100 : info.df1Amount;
        }

        uint256[64] memory cells = Source64.rows(core.frameData(tokenId), core.genesisFrameData(season), face);
        uint24[16] memory rawPalette = core.palette();
        uint256[16] memory pl;
        for (uint256 i; i < 16; ++i) pl[i] = rawPalette[i];
        pl[0] = rawPalette[background];
        rgb = new bytes(RGB_BYTES);

        assembly ("memory-safe") {
            let dst := add(rgb, 0x20)
            for { let y := 0 } lt(y, 64) { y := add(y, 1) } {
                let row := mload(add(cells, mul(y, 0x20)))
                for { let x := 0 } lt(x, 64) { x := add(x, 1) } {
                    let c := mload(add(pl, mul(and(shr(sub(252, mul(4, x)), row), 0x0F), 0x20)))
                    mstore8(dst, shr(16, c))
                    mstore8(add(dst, 1), shr(8, c))
                    mstore8(add(dst, 2), c)
                    dst := add(dst, 3)
                }
            }
        }
    }
}
