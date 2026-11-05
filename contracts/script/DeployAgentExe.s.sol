// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AgentBattle} from "../src/agentexe/AgentBattle.sol";
import {R3Names} from "../src/names/R3Names.sol";

/// @notice Deploys the two AGENT.EXE add-on contracts (the r3OS core is untouched).
///   OWNER=0x… BATTLE_START=1793876400 forge script script/DeployAgentExe.s.sol:DeployAgentExe \
///     --rpc-url $RPC --account <owner> --broadcast
/// BATTLE_START defaults to season 2's start (2026-11-05 11:00 UTC); the battle lasts 72 h and leftovers can be
/// rescued 30 days after the end.
contract DeployAgentExe is Script {
    function run() external {
        address owner = vm.envAddress("OWNER");
        uint64 start = uint64(vm.envOr("BATTLE_START", uint256(1_793_876_400)));
        vm.startBroadcast();
        AgentBattle battle = new AgentBattle(start, 72 hours, 30 days, owner);
        R3Names names = new R3Names(owner);
        vm.stopBroadcast();
        console2.log("AgentBattle", address(battle));
        console2.log("R3Names", address(names));
    }
}
