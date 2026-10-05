// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {R3OSMainnetScript} from "./lib/R3OSMainnetScript.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";

/// @notice Optional post-acceptance renderer freeze. The experiment registry intentionally remains open.
/// @dev EOAs can broadcast through this script. Contract owners receive target + calldata output for
///      their normal multisig/account flow. Mainnet broadcast requires a separate freeze approval flag.
contract FreezeRenderers is R3OSMainnetScript {
    function run() external {
        address finalOwner = vm.envAddress("FINAL_OWNER");
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));

        _requireMainnetBroadcastApproval();
        _requireMainnetBroadcastFlag(
            "CONFIRM_FREEZE_RENDERERS",
            "renderer freeze blocked: set CONFIRM_FREEZE_RENDERERS=true after explicit approval"
        );

        require(finalOwner != address(0), "final owner is zero");
        require(address(paint).code.length != 0, "Paint has no code");
        require(paint.owner() == finalOwner, "final owner has not accepted Paint");
        require(!paint.renderersFrozen(), "renderers already frozen");
        require(!paint.experimentsFrozen(), "experiment registry must remain open");
        require(paint.rendererCount() == 4, "unexpected renderer count");
        require(paint.experimentCount() == 10, "unexpected experiment count");

        if (finalOwner.code.length != 0) {
            console.log("FINAL_OWNER is a contract; execute this call through its normal multisig/account flow");
            console.log("R3OSPaint", address(paint));
            console.log("calldata");
            console.logBytes(abi.encodeWithSignature("freezeRenderers()"));
            return;
        }

        vm.startBroadcast(finalOwner);
        paint.freezeRenderers();
        vm.stopBroadcast();

        console.log("R3OSPaint renderers frozen", address(paint));
        console.log("experiment registry remains open");
    }
}
