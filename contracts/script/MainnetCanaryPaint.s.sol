// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {R3OSMainnetScript} from "./lib/R3OSMainnetScript.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";

/// @notice Phase 9D mainnet canary: one visually-idempotent real Paint transaction.
/// @dev The selected pixel must be blank and outside the outline. The call paints it once and
///      restores it to blank in the same transaction. Painter accounting/heat/logs advance, while
///      the final canvas image remains unchanged. Broadcast needs its own explicit approval flag.
contract MainnetCanaryPaint is R3OSMainnetScript {
    uint256 private constant STORM_SAFETY_BLOCKS = 64;

    function run() external {
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));
        address finalOwner = vm.envAddress("FINAL_OWNER");
        address painter = vm.envOr("CANARY_PAINTER", finalOwner);
        uint256 x = vm.envUint("CANARY_X");
        uint256 y = vm.envUint("CANARY_Y");
        uint256 color = vm.envUint("CANARY_COLOR");

        _requireMainnetBroadcastApproval();
        _requireMainnetBroadcastFlag(
            "CONFIRM_MAINNET_CANARY",
            "mainnet canary blocked: set CONFIRM_MAINNET_CANARY=true after explicit approval"
        );

        require(block.chainid == 143, "canary is mainnet-only");
        require(address(paint).code.length != 0, "Paint has no code");
        require(painter == finalOwner, "canary painter must equal FINAL_OWNER");
        require(paint.owner() == finalOwner, "Paint owner mismatch");
        require(x < 256 && y < 256, "canary coordinate out of bounds");
        require(color > 0 && color < 16, "canary color must be 1..15");

        uint256 season = paint.currentSeason();
        require(paint.backgroundPixelAt(season, x, y) == 0, "canary background pixel is not blank");
        require(paint.pixelAt(season, x, y) == 0, "canary pixel overlaps outline or nonblank state");
        require(!paint.isStorm(block.number), "canary blocked during storm");
        require(paint.nextStormStart() > block.number + STORM_SAFETY_BLOCKS, "canary too close to next storm");

        uint8 region = uint8((y >> 6) * 4 + (x >> 6));
        (,,,,, uint256 pressure) = paint.regionState(season, region);
        require(pressure <= 2, "canary region DF1 pressure too high");

        // [y, x0, x1, color] twice on the same pixel: blank -> color -> blank.
        bytes memory runs = abi.encodePacked(
            uint8(y), uint8(x), uint8(x), uint8(color),
            uint8(y), uint8(x), uint8(x), uint8(0)
        );
        uint256[] memory r3tardIds = new uint256[](0);

        console.log("canary painter", painter);
        console.log("canary season", season);
        console.log("canary x/y/color", x, y, color);
        console.log("canary region/pressure", uint256(region), pressure);

        vm.startBroadcast(painter);
        paint.paint(runs, r3tardIds);
        vm.stopBroadcast();

        require(paint.backgroundPixelAt(season, x, y) == 0, "canary simulation did not restore background pixel");
        require(paint.pixelAt(season, x, y) == 0, "canary simulation did not restore visible pixel");
        console.log("canary visual state restored");
    }
}
