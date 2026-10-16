// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {AgentBattle} from "../src/agentexe/AgentBattle.sol";

contract Rejecter { receive() external payable { revert("no"); } }

contract AgentBattleTest is Test {
    AgentBattle b;
    address owner = address(0xA11CE);
    address treasury = address(0x7EA5);
    address h1 = address(0xB0B001); // clear of the 0x1000+ precompile range on Monad
    address h2 = address(0xB0B002);
    uint64 start;

    function setUp() public {
        start = uint64(block.timestamp + 100);
        b = new AgentBattle(start, 72 hours, 30 days, owner);
        vm.deal(treasury, 100 ether);
    }

    function testTaxViaPlainTransferFitsSmallGas() public {
        vm.prank(treasury);
        (bool ok,) = address(b).call{value: 1 ether, gas: 60_000}("");
        assertTrue(ok);
        assertEq(b.totalTaxed(), 1 ether);
        assertEq(address(b).balance, 1 ether);
    }

    function testWindowsAndQuestView() public {
        address[] memory w = new address[](2);
        uint8[] memory m = new uint8[](2);
        (w[0], w[1], m[0], m[1]) = (h1, h2, 1, 2);
        vm.prank(owner);
        b.recordFought(w, m);
        m[0] = 6;
        vm.prank(owner);
        b.recordFought(w, m);
        assertEq(b.daysFought(h1), 3);
        assertEq(b.daysFought(h2), 1);
        m[0] = 8;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentBattle.BadWindows.selector, h1, uint8(8)));
        b.recordFought(w, m);
        vm.expectRevert(AgentBattle.NotOwner.selector);
        b.recordFought(w, m);
    }

    function testPayoutOnlyAfterEnd() public {
        vm.prank(treasury);
        (bool ok,) = address(b).call{value: 10 ether}("");
        assertTrue(ok);
        address[] memory to = new address[](2);
        uint256[] memory amt = new uint256[](2);
        (to[0], to[1], amt[0], amt[1]) = (h1, h2, 6 ether, 4 ether);
        vm.prank(owner);
        vm.expectRevert(AgentBattle.BattleNotOver.selector);
        b.payout(to, amt);
        vm.warp(start + 72 hours);
        vm.prank(owner);
        b.payout(to, amt);
        assertEq(h1.balance, 6 ether);
        assertEq(h2.balance, 4 ether);
        assertEq(b.totalPaid(), 10 ether);
        assertEq(address(b).balance, 0);
    }

    function test_RejectingRecipientRevertsBatchAndRescueWaits() public {
        vm.prank(treasury);
        (bool ok,) = address(b).call{value: 3 ether}("");
        assertTrue(ok);
        Rejecter r = new Rejecter();
        address[] memory to = new address[](1);
        uint256[] memory amt = new uint256[](1);
        (to[0], amt[0]) = (address(r), 1 ether);
        vm.warp(start + 72 hours);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentBattle.TransferFailed.selector, address(r), 1 ether));
        b.payout(to, amt);
        vm.prank(owner);
        vm.expectRevert(AgentBattle.TooEarly.selector);
        b.rescue(owner);
        vm.warp(start + 72 hours + 30 days);
        vm.prank(owner);
        b.rescue(owner);
        assertEq(owner.balance, 3 ether);
    }

    function testOwnershipTwoStep() public {
        vm.prank(owner);
        b.transferOwnership(h1);
        assertEq(b.owner(), owner);
        vm.prank(h2);
        vm.expectRevert(AgentBattle.NotPendingOwner.selector);
        b.acceptOwnership();
        vm.prank(h1);
        b.acceptOwnership();
        assertEq(b.owner(), h1);
    }
}
