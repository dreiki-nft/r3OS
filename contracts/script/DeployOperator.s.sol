// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {R3OSMainnetScript} from "./lib/R3OSMainnetScript.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSOperatorRecord} from "../src/operator/R3OSOperatorRecord.sol";
import {R3OSSystemEvent, IAggregatorV3} from "../src/operator/R3OSSystemEvent.sol";

/// @notice Add-on deployment for the operator record and permanent system-event latch.
/// @dev Operator Record v1 keeps legacy source slots for testnet/history compatibility. Fresh r3OS mainnet
///      deployments intentionally pass zero for retired subsystems instead of deploying dead applications.
contract DeployOperator is R3OSMainnetScript {
    struct Resolved {
        address quests;
        address auction;
        address recycleBin;
        address blockCamera;
        address pageExe;
        address cardMemory;
    }

    function run() external {
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        address feed = vm.envAddress("MON_USD_FEED");
        uint256 thresholdMilliUsd = vm.envOr("MON_PRICE_TRIGGER_MILLI_USD", uint256(333));
        // Mainnet must choose this explicitly after checking the live feed update policy/freshness; never inherit the
        // permissive local/testnet default by accident.
        uint256 maxAge = block.chainid == 143
            ? vm.envUint("MON_FEED_MAX_AGE")
            : vm.envOr("MON_FEED_MAX_AGE", uint256(90_000));

        _requireMainnetBroadcastApproval();
        if (block.chainid == 143) {
            require(deployer != address(0), "mainnet DEPLOYER_ADDRESS missing");
            require(address(paint).code.length != 0, "Paint has no code");
            require(paint.owner() == deployer, "mainnet Paint owner must still be deployer");
            require(paint.painterPass() != address(0) && paint.painterPass().code.length != 0, "Painter Pass missing");
        }

        Resolved memory resolved = _resolve(paint);
        _logResolved(paint, resolved);
        if (block.chainid == 143) _requireResolved(resolved);
        _checkFeed(feed);

        R3OSOperatorRecord.Sources memory sources = R3OSOperatorRecord.Sources({
            paint: address(paint),
            pass: paint.painterPass(),
            quests: resolved.quests,
            flipbook: address(0),
            weeds: address(0),
            forks: address(0),
            brushes: address(0),
            auction: resolved.auction,
            sleepwalker: address(0),
            recycleBin: resolved.recycleBin,
            blockCamera: resolved.blockCamera,
            kernelDebugger: address(0),
            pageExe: resolved.pageExe,
            cardMemory: resolved.cardMemory
        });

        if (deployer == address(0)) vm.startBroadcast();
        else vm.startBroadcast(deployer);
        R3OSOperatorRecord record = new R3OSOperatorRecord(sources);
        R3OSSystemEvent systemEvent = new R3OSSystemEvent(feed, thresholdMilliUsd, maxAge);
        (, address broadcaster,) = vm.readCallers();

        uint256 recordId = paint.experimentCount();
        uint256 eventId = recordId + 1;

        bytes memory recordCall =
            abi.encodeCall(R3OSPaint.addExperiment, (address(record), "operator-record", ""));
        bytes memory eventCall =
            abi.encodeCall(R3OSPaint.addExperiment, (address(systemEvent), "system-event", ""));

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

        console.log("R3OSOperatorRecord", address(record));
        console.log("R3OSSystemEvent", address(systemEvent));
        console.log("operator-record experiment id", recordId);
        console.log("system-event experiment id", eventId);
        console.log("MON / USD feed", feed);
        console.log("trigger milli-USD", thresholdMilliUsd);
        console.log("feed max age seconds", maxAge);
    }

    function _resolve(R3OSPaint paint) private view returns (Resolved memory out) {
        uint256 count = paint.experimentCount();
        for (uint256 i; i < count; ++i) {
            R3OSPaint.ExperimentData memory info = paint.experimentInfo(i);
            if (info.retired || info.experiment == address(0)) continue;
            bytes32 name = keccak256(bytes(info.name));
            if (name == keccak256("quests")) out.quests = info.experiment;
            else if (name == keccak256("finale auction")) out.auction = info.experiment;
            else if (name == keccak256("recycle-bin")) out.recycleBin = info.experiment;
            else if (name == keccak256("block-camera")) out.blockCamera = info.experiment;
            else if (name == keccak256("page-exe")) out.pageExe = info.experiment;
            else if (name == keccak256("card-drv")) out.cardMemory = info.experiment;
        }
    }

    function _requireResolved(Resolved memory r) private view {
        require(r.quests != address(0) && r.quests.code.length != 0, "quests missing");
        require(r.auction != address(0) && r.auction.code.length != 0, "finale auction missing");
        require(r.recycleBin != address(0) && r.recycleBin.code.length != 0, "recycle-bin missing");
        require(r.blockCamera != address(0) && r.blockCamera.code.length != 0, "block-camera missing");
        require(r.pageExe != address(0) && r.pageExe.code.length != 0, "page-exe missing");
        require(r.cardMemory != address(0) && r.cardMemory.code.length != 0, "card-drv missing");
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

    function _logResolved(R3OSPaint paint, Resolved memory r) private view {
        console.log("Paint", address(paint));
        console.log("Painter Pass", paint.painterPass());
        _logSource("quests", r.quests);
        _logSource("finale auction", r.auction);
        _logSource("recycle-bin", r.recycleBin);
        _logSource("block-camera", r.blockCamera);
        _logSource("page-exe", r.pageExe);
        _logSource("card-drv", r.cardMemory);
        console.log("legacy Operator Record v1 sources: zeroed on fresh mainnet");
    }

    function _logSource(string memory name, address value) private pure {
        if (value == address(0)) {
            console.log(name, "MISSING");
        } else {
            console.log(name, value);
        }
    }
}
