// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {R3tardsPageExe} from "../src/monadhw/R3tardsPageExe.sol";
import {R3tardsBlockCamera} from "../src/monadhw/R3tardsBlockCamera.sol";
import {R3tardsKernelDebugger} from "../src/monadhw/R3tardsKernelDebugger.sol";

/// @notice Add-on deployment for Monad Hardware experiments. Deploy.s.sol stays untouched.
contract DeployMonadHW is Script {
    function run() external {
        R3tardsPaint paint = R3tardsPaint(vm.envAddress("PAINT_ADDRESS"));
        R3tardsLabs labs = R3tardsLabs(vm.envAddress("LABS_ADDRESS"));
        address cardMemory = vm.envOr("CARD_MEMORY_ADDRESS", address(0));

        vm.startBroadcast();
        R3tardsPageExe page = new R3tardsPageExe();
        R3tardsBlockCamera camera = new R3tardsBlockCamera(address(paint), address(labs), cardMemory);
        R3tardsKernelDebugger kernel = new R3tardsKernelDebugger();

        uint256 pageId = paint.addExperiment(address(page), "page-exe", "");
        uint256 cameraId = paint.addExperiment(address(camera), "block-camera", "");
        uint256 kernelId = paint.addExperiment(address(kernel), "kernel-debugger", "");
        camera.bindExperimentId(cameraId);
        vm.stopBroadcast();

        console.log("R3tardsPageExe", address(page));
        console.log("R3tardsBlockCamera", address(camera));
        console.log("R3tardsKernelDebugger", address(kernel));
        console.log("Block Camera CARD_MEMORY", cardMemory);
        console.log("page-exe experiment id", pageId);
        console.log("block-camera experiment id", cameraId);
        console.log("kernel-debugger experiment id", kernelId);
    }
}
