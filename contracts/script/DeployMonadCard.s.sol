// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsPainterPass} from "../src/R3tardsPainterPass.sol";
import {R3tardsQuests} from "../src/labs/R3tardsQuests.sol";
import {R3tardsCardMemory} from "../src/monadcard/R3tardsCardMemory.sol";

/// @notice Deploy CARD.DRV, then configure Paint, Pass and Quests directly or emit Safe calldata.
contract DeployMonadCard is Script {
    function run() external {
        address cardAddress = vm.envAddress("MONAD_CARD_ADDRESS");
        R3tardsPaint paint = R3tardsPaint(vm.envAddress("PAINT_ADDRESS"));
        R3tardsPainterPass pass = R3tardsPainterPass(vm.envAddress("PASS_ADDRESS"));
        R3tardsQuests quests = R3tardsQuests(vm.envAddress("QUESTS_ADDRESS"));

        vm.startBroadcast();
        R3tardsCardMemory cardMemory = new R3tardsCardMemory(cardAddress);
        (, address broadcaster,) = vm.readCallers();

        uint256 expectedExperimentId = paint.experimentCount();
        uint256 expectedSourceId = pass.stampSourceCount();
        uint256 expectedQuestId = quests.questCount();

        bytes memory experimentCall = abi.encodeCall(
            R3tardsPaint.addExperiment,
            (address(cardMemory), "card-drv", "")
        );
        if (paint.owner() == broadcaster) {
            expectedExperimentId = paint.addExperiment(address(cardMemory), "card-drv", "");
        } else {
            console.log("SAFE calldata: Paint.addExperiment(card-drv)");
            console.logBytes(experimentCall);
        }

        bytes memory stampCall = abi.encodeCall(R3tardsPainterPass.addStampSource, (address(cardMemory)));
        if (pass.owner() == broadcaster) {
            expectedSourceId = pass.addStampSource(address(cardMemory));
        } else {
            console.log("SAFE calldata: Pass.addStampSource(card-drv)");
            console.logBytes(stampCall);
        }

        R3tardsQuests.Condition[] memory conditions = new R3tardsQuests.Condition[](2);
        conditions[0] = R3tardsQuests.Condition({
            target: cardAddress,
            selector: bytes4(keccak256("balanceOf(address)")),
            word: 0,
            op: 0,
            threshold: 1
        });
        conditions[1] = R3tardsQuests.Condition({
            target: address(paint),
            selector: bytes4(keccak256("painterStats(address)")),
            word: 2,
            op: 0,
            threshold: 143
        });
        bytes memory questCall = abi.encodeCall(R3tardsQuests.addQuest, ("CARD CARRIER", 0, 0, conditions));
        if (quests.owner() == broadcaster) {
            expectedQuestId = quests.addQuest("CARD CARRIER", 0, 0, conditions);
        } else {
            console.log("SAFE calldata: Quests.addQuest(CARD CARRIER)");
            console.logBytes(questCall);
        }
        vm.stopBroadcast();

        console.log("R3tardsCardMemory", address(cardMemory));
        console.log("Monad Card", cardAddress);
        console.log("card-drv experiment id", expectedExperimentId);
        console.log("MONAD CARD stamp source id", expectedSourceId);
        console.log("MONAD CARD pass pin", 6 + expectedSourceId);
        console.log("CARD CARRIER quest id", expectedQuestId);
    }
}
