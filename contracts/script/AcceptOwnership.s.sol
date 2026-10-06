// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {R3OSMainnetScript} from "./lib/R3OSMainnetScript.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSPainterPass} from "../src/R3OSPainterPass.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {R3OSQuests} from "../src/labs/R3OSQuests.sol";

interface IOwnable2StepLike {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
}

/// @notice Explicit second-stage ownership acceptance for the four Ownable2Step launch contracts.
/// @dev EOAs can broadcast through this script. Contract final owners (for example a Safe) receive
///      target + calldata output instead; the Safe must execute those calls itself after approval.
contract AcceptOwnership is R3OSMainnetScript {
    bytes32 private constant BUILT_IN = keccak256("built-in");
    bytes32 private constant DIFF = keccak256("diff");
    bytes32 private constant TIMELAPSE = keccak256("season timelapse");
    bytes32 private constant DF1 = keccak256("df1");

    function run() external {
        address finalOwner = vm.envAddress("FINAL_OWNER");
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));
        R3OSLabs labs = R3OSLabs(vm.envAddress("LABS_ADDRESS"));
        R3OSPainterPass pass = R3OSPainterPass(vm.envAddress("PASS_ADDRESS"));
        R3OSQuests quests = R3OSQuests(vm.envAddress("QUESTS_ADDRESS"));

        _requireMainnetBroadcastApproval();
        _requireMainnetBroadcastFlag(
            "CONFIRM_ACCEPT_OWNERSHIP",
            "ownership acceptance blocked: set CONFIRM_ACCEPT_OWNERSHIP=true after explicit approval"
        );

        require(finalOwner != address(0), "final owner is zero");
        require(address(paint).code.length != 0, "Paint has no code");
        require(address(labs).code.length != 0, "Labs has no code");
        require(address(pass).code.length != 0, "Pass has no code");
        require(address(quests).code.length != 0, "Quests has no code");
        require(address(labs.CORE()) == address(paint), "Labs/Paint mismatch");
        require(address(pass.PAINT()) == address(paint), "Pass/Paint mismatch");
        require(address(quests.PAINT()) == address(paint), "Quests/Paint mismatch");
        require(paint.painterPass() == address(pass), "Paint/Pass mismatch");
        require(!paint.renderersFrozen(), "renderers already frozen before ownership acceptance");
        require(!paint.experimentsFrozen(), "experiments must remain open at launch");

        _requireRegistryComplete(paint);
        require(pass.stampSourceCount() == 3, "unexpected Pass stamp-source count");

        address[4] memory targets = [address(paint), address(labs), address(pass), address(quests)];
        string[4] memory labels = ["R3OSPaint", "R3OSLabs", "R3OSPainterPass", "R3OSQuests"];
        bool[4] memory needsAcceptance;
        uint256 pendingCount;
        for (uint256 i; i < targets.length; ++i) {
            IOwnable2StepLike ownable = IOwnable2StepLike(targets[i]);
            address current = ownable.owner();
            address pending = ownable.pendingOwner();
            if (current == finalOwner) {
                require(pending == address(0), "accepted owner still has pending transfer");
                continue;
            }
            require(pending == finalOwner, "pending owner mismatch");
            needsAcceptance[i] = true;
            ++pendingCount;
        }

        if (pendingCount == 0) {
            console.log("ownership already held by FINAL_OWNER; no acceptance transaction required", finalOwner);
            return;
        }

        if (finalOwner.code.length != 0 && !_isEip7702Delegation(finalOwner)) {
            bytes memory callData = abi.encodeWithSignature("acceptOwnership()");
            console.log("FINAL_OWNER is a contract; DO NOT impersonate it with startBroadcast(address)");
            for (uint256 i; i < targets.length; ++i) {
                if (needsAcceptance[i]) _logSafeCall(labels[i], targets[i], callData);
            }
            console.log("execute these calls from FINAL_OWNER using its normal multisig/account flow");
            return;
        }

        vm.startBroadcast(finalOwner);
        for (uint256 i; i < targets.length; ++i) {
            if (needsAcceptance[i]) IOwnable2StepLike(targets[i]).acceptOwnership();
        }
        vm.stopBroadcast();

        console.log("ownership acceptance complete for", finalOwner);
    }

    function _requireRegistryComplete(R3OSPaint paint) private view {
        require(paint.rendererCount() == 4, "unexpected renderer count");
        _requireRendererName(paint, 0, BUILT_IN);
        _requireRendererName(paint, 1, DIFF);
        _requireRendererName(paint, 2, TIMELAPSE);
        _requireRendererName(paint, 3, DF1);

        string[10] memory names = [
            "finale auction",
            "quests",
            "recycle-bin",
            "cd-burner",
            "card-drv",
            "page-exe",
            "block-camera",
            "operator-record",
            "system-event",
            "router-lab"
        ];
        require(paint.experimentCount() == names.length, "unexpected experiment count");
        for (uint256 i; i < names.length; ++i) {
            R3OSPaint.ExperimentData memory info = paint.experimentInfo(i);
            require(info.experiment != address(0) && info.experiment.code.length != 0, "experiment missing code");
            require(!info.retired, "launch experiment retired");
            require(keccak256(bytes(info.name)) == keccak256(bytes(names[i])), "experiment order/name mismatch");
        }
    }

    function _requireRendererName(R3OSPaint paint, uint256 id, bytes32 expected) private view {
        (address renderer, string memory name_) = paint.rendererInfo(id);
        if (id == 0) require(renderer == address(0), "built-in renderer address mismatch");
        else require(renderer != address(0) && renderer.code.length != 0, "renderer missing code");
        require(keccak256(bytes(name_)) == expected, "renderer order/name mismatch");
    }

    function _logSafeCall(string memory label, address target, bytes memory callData) private pure {
        console.log(label, target);
        console.log("calldata");
        console.logBytes(callData);
    }
}
