// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {R3OSMainnetScript} from "./lib/R3OSMainnetScript.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {R3OSPageExe} from "../src/monadhw/R3OSPageExe.sol";
import {R3OSBlockCamera} from "../src/monadhw/R3OSBlockCamera.sol";
import {R3OSCardMemory} from "../src/monadcard/R3OSCardMemory.sol";

/// @notice Add-on deployment for Monad hardware features used by the active r3OS UI.
contract DeployMonadHW is R3OSMainnetScript {
    function run() external {
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));
        R3OSLabs labs = R3OSLabs(vm.envAddress("LABS_ADDRESS"));
        address cardMemory = vm.envOr("CARD_MEMORY_ADDRESS", address(0));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));

        _requireMainnetBroadcastApproval();
        if (block.chainid == 143) {
            require(deployer != address(0), "mainnet DEPLOYER_ADDRESS missing");
            require(address(paint).code.length != 0, "Paint has no code");
            require(address(labs).code.length != 0, "Labs has no code");
            require(paint.owner() == deployer, "mainnet Paint owner must still be deployer");
            require(address(labs.CORE()) == address(paint), "Labs/Paint mismatch");
            require(cardMemory != address(0) && cardMemory.code.length != 0, "mainnet Card Memory missing");
            require(
                R3OSCardMemory(cardMemory).MONAD_CARD() == 0x0000CA12D5c07085022eBC74867157449919Fd67,
                "wrong Card Memory / Monad Card"
            );
        }

        if (deployer == address(0)) vm.startBroadcast();
        else vm.startBroadcast(deployer);
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
