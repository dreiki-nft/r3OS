// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @notice Shared safety boundary for r3OS mainnet deployment scripts.
/// @dev Dry-runs are intentionally allowed without approval. A real `forge script --broadcast`
///      or `--resume` on chain 143 requires CONFIRM_MAINNET=true at the exact execution step.
abstract contract R3OSMainnetScript is Script {
    function _isBroadcastContext() internal view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)
            || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    function _isEip7702Delegation(address account) internal view returns (bool) {
        bytes memory code = account.code;
        return code.length == 23
            && code[0] == bytes1(0xef)
            && code[1] == bytes1(0x01)
            && code[2] == bytes1(0x00);
    }

    function _requireMainnetBroadcastApproval() internal view {
        if (block.chainid == 143 && _isBroadcastContext()) {
            require(vm.envOr("CONFIRM_MAINNET", false), "mainnet broadcast blocked: set CONFIRM_MAINNET=true after explicit approval");
        }
    }

    function _requireMainnetBroadcastFlag(string memory name, string memory message) internal view {
        if (block.chainid == 143 && _isBroadcastContext()) {
            require(vm.envOr(name, false), message);
        }
    }
}
