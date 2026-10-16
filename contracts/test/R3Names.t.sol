// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {R3Names} from "../src/names/R3Names.sol";

contract R3NamesTest is Test {
    R3Names names;
    address owner = address(0xA11CE);
    address agent1 = address(0xA1);
    address agent2 = address(0xA2);
    address human = address(0xB0B);

    function setUp() public {
        names = new R3Names(owner);
    }

    function _assign(address w, string memory n) internal {
        address[] memory ws = new address[](1);
        string[] memory ns = new string[](1);
        (ws[0], ns[0]) = (w, n);
        vm.prank(owner);
        names.assign(ws, ns);
    }

    function testOwnerAssignsAgentNames() public {
        address[] memory ws = new address[](2);
        string[] memory ns = new string[](2);
        (ws[0], ws[1], ns[0], ns[1]) = (agent1, agent2, "harlan", "voss");
        vm.prank(owner);
        names.assign(ws, ns);
        assertEq(names.nameOf(agent1), "harlan");
        assertEq(names.resolve("voss"), agent2);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, human));
        vm.prank(human);
        names.assign(ws, ns);
    }

    function testNamesAreUniqueAndReplaceable() public {
        _assign(agent1, "harlan");
        vm.prank(owner);
        address[] memory ws = new address[](1);
        string[] memory ns = new string[](1);
        (ws[0], ns[0]) = (agent2, "harlan");
        vm.expectRevert(abi.encodeWithSelector(R3Names.NameTaken.selector, "harlan", agent1));
        names.assign(ws, ns);
        _assign(agent1, "mercer");
        assertEq(names.resolve("harlan"), address(0), "old name freed");
        assertEq(names.nameOf(agent1), "mercer");
        _assign(agent2, "harlan");
        assertEq(names.resolve("harlan"), agent2);
    }

    function testOnlyPlainNames() public {
        assertTrue(names.validName("agent_07-x"));
        assertFalse(names.validName(""));
        assertFalse(names.validName("Harlan"));
        assertFalse(names.validName("harlan.r3"));
        assertFalse(names.validName(unicode"hаrlan")); // Cyrillic а
        assertFalse(names.validName("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")); // 33
        address[] memory ws = new address[](1);
        string[] memory ns = new string[](1);
        (ws[0], ns[0]) = (agent1, "Bad Name");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(R3Names.BadName.selector, "Bad Name"));
        names.assign(ws, ns);
    }

    function testCommunityLater() public {
        vm.prank(human);
        vm.expectRevert(R3Names.RegistrationClosed.selector);
        names.register("dreiki");
        vm.prank(owner);
        names.setRegistrationOpen(true);
        vm.prank(human);
        names.register("dreiki");
        assertEq(names.nameOf(human), "dreiki");
        vm.prank(human);
        names.release();
        assertEq(names.nameOf(human), "");
        assertEq(names.resolve("dreiki"), address(0));
    }

    function testModeration() public {
        _assign(agent1, "harlan");
        vm.prank(owner);
        names.clear(agent1);
        assertEq(names.nameOf(agent1), "");
        assertEq(names.resolve("harlan"), address(0));
    }
}
