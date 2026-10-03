// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsOperatorRecord} from "../src/operator/R3tardsOperatorRecord.sol";
import {R3tardsSystemEvent, IAggregatorV3} from "../src/operator/R3tardsSystemEvent.sol";

/// @notice Add-on deployment for the operator record and permanent system-event latch.
contract DeployOperator is Script {
    struct Resolved {
        address quests;
        address flipbook;
        address weeds;
        address forks;
        address brushes;
        address auction;
        address sleepwalker;
        address recycleBin;
        address blockCamera;
        address kernelDebugger;
        address pageExe;
        address cardMemory;
    }

    function run() external {
        R3tardsPaint paint = R3tardsPaint(vm.envAddress("PAINT_ADDRESS"));
        address feed = vm.envAddress("MON_USD_FEED");
        uint256 thresholdMilliUsd = vm.envOr("MON_PRICE_TRIGGER_MILLI_USD", uint256(333));
        // Mainnet must choose this explicitly after checking the live feed heartbeat; never inherit the
        // permissive local/testnet default by accident.
        uint256 maxAge = block.chainid == 143
            ? vm.envUint("MON_FEED_MAX_AGE")
            : vm.envOr("MON_FEED_MAX_AGE", uint256(90_000));

        Resolved memory resolved = _resolve(paint);
        _logResolved(paint, resolved);
        _checkFeed(feed);

        R3tardsOperatorRecord.Sources memory sources = R3tardsOperatorRecord.Sources({
            paint: address(paint),
            pass: paint.painterPass(),
            quests: resolved.quests,
            flipbook: resolved.flipbook,
            weeds: resolved.weeds,
            forks: resolved.forks,
            brushes: resolved.brushes,
            auction: resolved.auction,
            sleepwalker: resolved.sleepwalker,
            recycleBin: resolved.recycleBin,
            blockCamera: resolved.blockCamera,
            kernelDebugger: resolved.kernelDebugger,
            pageExe: resolved.pageExe,
            cardMemory: resolved.cardMemory
        });

        vm.startBroadcast();
        R3tardsOperatorRecord record = new R3tardsOperatorRecord(sources);
        R3tardsSystemEvent systemEvent = new R3tardsSystemEvent(feed, thresholdMilliUsd, maxAge);
        (, address broadcaster,) = vm.readCallers();

        uint256 recordId = paint.experimentCount();
        uint256 eventId = recordId + 1;

        bytes memory recordCall =
            abi.encodeCall(R3tardsPaint.addExperiment, (address(record), "operator-record", ""));
        bytes memory eventCall =
            abi.encodeCall(R3tardsPaint.addExperiment, (address(systemEvent), "system-event", ""));

        if (paint.owner() == broadcaster) {
            recordId = paint.addExperiment(address(record), "operator-record", "");
            eventId = paint.addExperiment(address(systemEvent), "system-event", "");
        } else {
            console.log("SAFE calldata: Paint.addExperiment(operator-record)");
            console.logBytes(recordCall);
            console.log("SAFE calldata: Paint.addExperiment(system-event)");
            console.logBytes(eventCall);
        }
        vm.stopBroadcast();

        console.log("R3tardsOperatorRecord", address(record));
        console.log("R3tardsSystemEvent", address(systemEvent));
        console.log("operator-record experiment id", recordId);
        console.log("system-event experiment id", eventId);
        console.log("MON / USD feed", feed);
        console.log("trigger milli-USD", thresholdMilliUsd);
        console.log("feed max age seconds", maxAge);
    }

    function _resolve(R3tardsPaint paint) private view returns (Resolved memory out) {
        uint256 count = paint.experimentCount();
        for (uint256 i; i < count; ++i) {
            R3tardsPaint.ExperimentData memory info = paint.experimentInfo(i);
            if (info.retired || info.experiment == address(0)) continue;
            bytes32 name = keccak256(bytes(info.name));
            if (name == keccak256("quests")) out.quests = info.experiment;
            else if (name == keccak256("flipbook")) out.flipbook = info.experiment;
            else if (name == keccak256("weeds")) out.weeds = info.experiment;
            else if (name == keccak256("forks")) out.forks = info.experiment;
            else if (name == keccak256("brushes")) out.brushes = info.experiment;
            else if (name == keccak256("finale auction")) out.auction = info.experiment;
            else if (name == keccak256("sleepwalker")) out.sleepwalker = info.experiment;
            else if (name == keccak256("recycle-bin")) out.recycleBin = info.experiment;
            else if (name == keccak256("block-camera")) out.blockCamera = info.experiment;
            else if (name == keccak256("kernel-debugger")) out.kernelDebugger = info.experiment;
            else if (name == keccak256("page-exe")) out.pageExe = info.experiment;
            else if (name == keccak256("card-drv")) out.cardMemory = info.experiment;
        }
    }

    function _checkFeed(address feed) private view {
        IAggregatorV3 oracle = IAggregatorV3(feed);
        string memory description = oracle.description();
        uint8 decimals = oracle.decimals();
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();

        console.log("feed description", description);
        console.log("feed decimals", decimals);
        console.log("feed round", uint256(roundId));
        console.log("feed answer");
        console.logInt(answer);
        console.log("feed updatedAt", updatedAt);

        if (block.chainid == 143) {
            require(keccak256(bytes(description)) == keccak256(bytes("MON / USD")), "wrong feed description");
            require(decimals == 8, "wrong feed decimals");
        }
    }

    function _logResolved(R3tardsPaint paint, Resolved memory r) private view {
        console.log("Paint", address(paint));
        console.log("Painter Pass", paint.painterPass());
        _logSource("quests", r.quests);
        _logSource("flipbook", r.flipbook);
        _logSource("weeds", r.weeds);
        _logSource("forks", r.forks);
        _logSource("brushes", r.brushes);
        _logSource("finale auction", r.auction);
        _logSource("sleepwalker", r.sleepwalker);
        _logSource("recycle-bin", r.recycleBin);
        _logSource("block-camera", r.blockCamera);
        _logSource("kernel-debugger", r.kernelDebugger);
        _logSource("page-exe", r.pageExe);
        _logSource("card-drv", r.cardMemory);
    }

    function _logSource(string memory name, address value) private pure {
        if (value == address(0)) {
            console.log(name, "MISSING");
        } else {
            console.log(name, value);
        }
    }
}
