// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {R3OSMainnetScript} from "./lib/R3OSMainnetScript.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSPainterPass} from "../src/R3OSPainterPass.sol";
import {R3OSQuests} from "../src/labs/R3OSQuests.sol";
import {R3OSCardMemory} from "../src/monadcard/R3OSCardMemory.sol";

/// @notice Deploy CARD.DRV, then configure Paint, Pass and Quests directly or emit Safe calldata.
contract DeployMonadCard is R3OSMainnetScript {
    function run() external {
        address cardAddress = vm.envAddress("MONAD_CARD_ADDRESS");
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));
        R3OSPainterPass pass = R3OSPainterPass(vm.envAddress("PASS_ADDRESS"));
        R3OSQuests quests = R3OSQuests(vm.envAddress("QUESTS_ADDRESS"));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));

        _requireMainnetBroadcastApproval();
        if (block.chainid == 143) {
            require(deployer != address(0), "mainnet DEPLOYER_ADDRESS missing");
            require(address(paint).code.length != 0, "Paint has no code");
            require(address(pass).code.length != 0, "Pass has no code");
            require(address(quests).code.length != 0, "Quests has no code");
            require(paint.owner() == deployer, "mainnet Paint owner must still be deployer");
            require(pass.owner() == deployer, "mainnet Pass owner must still be deployer");
            require(quests.owner() == deployer, "mainnet Quests owner must still be deployer");
            require(paint.painterPass() == address(pass), "Paint/Pass mismatch");
            require(address(pass.PAINT()) == address(paint), "Pass/Paint mismatch");
            require(address(quests.PAINT()) == address(paint), "Quests/Paint mismatch");
        }

        if (deployer == address(0)) vm.startBroadcast();
        else vm.startBroadcast(deployer);
        R3OSCardMemory cardMemory = new R3OSCardMemory(cardAddress);
        (, address broadcaster,) = vm.readCallers();

        uint256 expectedExperimentId = paint.experimentCount();
        uint256 expectedSourceId = pass.stampSourceCount();
        uint256 expectedQuestId = quests.questCount();

        bytes memory experimentCall = abi.encodeCall(
            R3OSPaint.addExperiment,
            (address(cardMemory), "card-drv", "")
        );
        if (paint.owner() == broadcaster) {
            expectedExperimentId = paint.addExperiment(address(cardMemory), "card-drv", "");
        } else {
            console.log("SAFE calldata: Paint.addExperiment(card-drv)");
            console.logBytes(experimentCall);
        }

        bytes memory stampCall = abi.encodeCall(R3OSPainterPass.addStampSource, (address(cardMemory)));
        if (pass.owner() == broadcaster) {
            expectedSourceId = pass.addStampSource(address(cardMemory));
        } else {
            console.log("SAFE calldata: Pass.addStampSource(card-drv)");
            console.logBytes(stampCall);
        }

        R3OSQuests.Condition[] memory conditions = new R3OSQuests.Condition[](2);
        conditions[0] = R3OSQuests.Condition({
            target: cardAddress,
            selector: bytes4(keccak256("balanceOf(address)")),
            word: 0,
            op: 0,
            threshold: 1
        });
        conditions[1] = R3OSQuests.Condition({
            target: address(paint),
            selector: bytes4(keccak256("painterStats(address)")),
            word: 2,
            op: 0,
            threshold: 143
        });
        bytes memory questCall = abi.encodeCall(R3OSQuests.addQuest, ("CARD CARRIER", 0, 0, conditions));
        if (quests.owner() == broadcaster) {
            expectedQuestId = quests.addQuest("CARD CARRIER", 0, 0, conditions);
        } else {
            console.log("SAFE calldata: Quests.addQuest(CARD CARRIER)");
            console.logBytes(questCall);
        }
        vm.stopBroadcast();

        console.log("R3OSCardMemory", address(cardMemory));
        console.log("Monad Card", cardAddress);
        console.log("card-drv experiment id", expectedExperimentId);
        console.log("MONAD CARD stamp source id", expectedSourceId);
        console.log("MONAD CARD pass pin", 6 + expectedSourceId);
        console.log("CARD CARRIER quest id", expectedQuestId);
    }
}
