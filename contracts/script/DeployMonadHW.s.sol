// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {R3OSPageExe} from "../src/monadhw/R3OSPageExe.sol";
import {R3OSBlockCamera} from "../src/monadhw/R3OSBlockCamera.sol";

/// @notice Add-on deployment for Monad hardware features used by the active r3OS UI.
contract DeployMonadHW is Script {
    function run() external {
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));
        R3OSLabs labs = R3OSLabs(vm.envAddress("LABS_ADDRESS"));
        address cardMemory = vm.envOr("CARD_MEMORY_ADDRESS", address(0));

        vm.startBroadcast();
        R3OSPageExe page = new R3OSPageExe();
        R3OSBlockCamera camera = new R3OSBlockCamera(address(paint), address(labs), cardMemory);

        uint256 pageId = paint.addExperiment(address(page), "page-exe", "");
        uint256 cameraId = paint.addExperiment(address(camera), "block-camera", "");
        camera.bindExperimentId(cameraId);
        vm.stopBroadcast();

        console.log("R3OSPageExe", address(page));
        console.log("R3OSBlockCamera", address(camera));
        console.log("Block Camera CARD_MEMORY", cardMemory);
        console.log("page-exe experiment id", pageId);
        console.log("block-camera experiment id", cameraId);
    }
}
