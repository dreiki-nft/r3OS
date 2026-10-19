// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {R3Names} from "../src/names/R3Names.sol";

contract R3NamesTest is Test {
    R3Names names;
    address owner = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xA2);
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

    function testOwnerAssignsNames() public {
        address[] memory ws = new address[](2);
        string[] memory ns = new string[](2);
        (ws[0], ws[1], ns[0], ns[1]) = (alice, bob, "pixel", "glitch");
        vm.prank(owner);
        names.assign(ws, ns);
        assertEq(names.nameOf(alice), "pixel");
        assertEq(names.resolve("glitch"), bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, human));
        vm.prank(human);
        names.assign(ws, ns);
    }

    function testNamesAreUniqueAndReplaceable() public {
        _assign(alice, "pixel");
        vm.prank(owner);
        address[] memory ws = new address[](1);
        string[] memory ns = new string[](1);
        (ws[0], ns[0]) = (bob, "pixel");
        vm.expectRevert(abi.encodeWithSelector(R3Names.NameTaken.selector, "pixel", alice));
        names.assign(ws, ns);
        _assign(alice, "crayon");
        assertEq(names.resolve("pixel"), address(0), "old name freed");
        assertEq(names.nameOf(alice), "crayon");
        _assign(bob, "pixel");
        assertEq(names.resolve("pixel"), bob);
    }

    function testOnlyPlainNames() public {
        assertTrue(names.validName("anon-07_x"));
        assertFalse(names.validName(""));
        assertFalse(names.validName("Pixel"));
        assertFalse(names.validName("pixel.r3"));
        assertFalse(names.validName(unicode"pіxel")); // Cyrillic і
        assertFalse(names.validName("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")); // 33
        address[] memory ws = new address[](1);
        string[] memory ns = new string[](1);
        (ws[0], ns[0]) = (alice, "Bad Name");
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
        _assign(alice, "pixel");
        vm.prank(owner);
        names.clear(alice);
        assertEq(names.nameOf(alice), "");
        assertEq(names.resolve("pixel"), address(0));
    }
}
