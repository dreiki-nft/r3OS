// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {R3OSPaint} from "../src/R3OSPaint.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract BudgetsWetHeatRegionsTest is Test {
    R3OSPaint p;
    MockR3tards r;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    bytes32 constant PAINTED_SIG = keccak256("Painted(uint256,address,address,bytes,bytes,uint32,uint16)");

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        p = new R3OSPaint(address(r), uint64(vm.getBlockTimestamp()), alice, alice, 32, 16, 256, 16, 256);
    }

    function testTrustRampAtSixteenPixels() public {
        vm.prank(alice);
        p.paint(hex"00000F04", new uint256[](0));
        (uint32 activeDays,,,,,,,,,) = p.painterStats(alice);
        assertEq(activeDays, 1);
        (,,, uint256 limit,) = p.budgetOf(alice, new uint256[](0));
        assertEq(limit, 48);
    }

    function testActiveDayCreditsOncePerUtcDay() public {
        vm.prank(alice); p.paint(hex"00000F04", new uint256[](0));
        vm.prank(alice); p.paint(hex"00101F04", new uint256[](0));
        (uint32 days1,,,,,,,,,) = p.painterStats(alice);
        assertEq(days1, 1);

        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice); p.paint(hex"00202F04", new uint256[](0));
        (uint32 days2,,,,,,,,,) = p.painterStats(alice);
        assertEq(days2, 2);
    }

    function testHolderQuotaPersistsAcrossTransferMidDay() public {
        r.mint(alice, 77);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 77;
        vm.prank(alice);
        p.paint(hex"00002704", ids); // 40 blank pixels => 32 hourly + 8 token

        vm.prank(alice);
        r.transfer(77, bob);
        (uint256 hourly, uint256 holder, uint256 total,,) = p.budgetOf(bob, ids);
        assertEq(hourly, 32);
        assertEq(holder, 248);
        assertEq(total, 280);
    }

    function testMainnetPartnerCollectionsAddSmallerWalletBonuses() public {
        vm.chainId(143);
        R3OSPaint mainnetPaint = new R3OSPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 32, 16, 256, 16, 512
        );
        bytes4 balanceOf = bytes4(keccak256("balanceOf(address)"));
        vm.mockCall(mainnetPaint.SKRUMPEYS(), abi.encodeWithSelector(balanceOf, alice), abi.encode(uint256(1)));
        vm.mockCall(mainnetPaint.MONAD_CARDS(), abi.encodeWithSelector(balanceOf, alice), abi.encode(uint256(1)));

        (uint256 hourly, uint256 holder, uint256 total,,) =
            mainnetPaint.budgetOf(alice, new uint256[](0));
        assertEq(hourly, 32);
        assertEq(holder, 256);
        assertEq(total, 288);

        (bool skrumpeyHolder, uint256 skrumpeyAvailable, bool cardHolder, uint256 cardAvailable) =
            mainnetPaint.partnerBudgetOf(alice);
        assertTrue(skrumpeyHolder);
        assertTrue(cardHolder);
        assertEq(skrumpeyAvailable, 128);
        assertEq(cardAvailable, 128);
        assertLt(skrumpeyAvailable, mainnetPaint.HOLDER_PIXELS_PER_DAY());
        assertLt(cardAvailable, mainnetPaint.HOLDER_PIXELS_PER_DAY());

        vm.prank(alice);
        mainnetPaint.paint(hex"00002704", new uint256[](0)); // 40 blank pixels => 32 hourly + 8 partner

        (, skrumpeyAvailable,, cardAvailable) = mainnetPaint.partnerBudgetOf(alice);
        assertEq(skrumpeyAvailable, 120);
        assertEq(cardAvailable, 128);

        vm.warp(vm.getBlockTimestamp() + 1 days);
        (, skrumpeyAvailable,, cardAvailable) = mainnetPaint.partnerBudgetOf(alice);
        assertEq(skrumpeyAvailable, 128);
        assertEq(cardAvailable, 128);
    }

    function testMainnetOrdinaryBudgetDoesNotDependOnPartnerReads() public {
        vm.chainId(143);
        R3OSPaint mainnetPaint = new R3OSPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 32, 16, 256, 16, 512
        );
        bytes4 balanceOf = bytes4(keccak256("balanceOf(address)"));
        vm.mockCallRevert(mainnetPaint.SKRUMPEYS(), abi.encodeWithSelector(balanceOf, alice), bytes("offline"));
        vm.mockCallRevert(mainnetPaint.MONAD_CARDS(), abi.encodeWithSelector(balanceOf, alice), bytes("offline"));

        vm.prank(alice);
        mainnetPaint.paint(hex"00000F04", new uint256[](0)); // 16 px fits ordinary hourly budget

        (, uint32 pixelsToday,,,,,,,,) = mainnetPaint.painterStats(alice);
        assertEq(pixelsToday, 16);
    }

    function testPartnerBalanceProbeFailureFailsClosed() public {
        vm.chainId(143);
        R3OSPaint mainnetPaint = new R3OSPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 32, 16, 256, 16, 512
        );
        bytes4 balanceOf = bytes4(keccak256("balanceOf(address)"));
        vm.mockCallRevert(mainnetPaint.SKRUMPEYS(), abi.encodeWithSelector(balanceOf, alice), bytes("offline"));
        vm.mockCallRevert(mainnetPaint.MONAD_CARDS(), abi.encodeWithSelector(balanceOf, alice), bytes("offline"));

        (uint256 hourly, uint256 holder, uint256 total,,) =
            mainnetPaint.budgetOf(alice, new uint256[](0));
        assertEq(hourly, 32);
        assertEq(holder, 0);
        assertEq(total, 32);
    }

    function testPartnerBalanceProbeRejectsOversizedReturn() public {
        vm.chainId(143);
        R3OSPaint mainnetPaint = new R3OSPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 32, 16, 256, 16, 512
        );
        bytes4 balanceOf = bytes4(keccak256("balanceOf(address)"));
        vm.mockCall(
            mainnetPaint.SKRUMPEYS(),
            abi.encodeWithSelector(balanceOf, alice),
            abi.encode(uint256(1), uint256(2))
        );

        (bool holder, uint256 available,,) = mainnetPaint.partnerBudgetOf(alice);
        assertFalse(holder);
        assertEq(available, 0);
    }

    function testPartnerBonusesAreMainnetOnly() public {
        bytes4 balanceOf = bytes4(keccak256("balanceOf(address)"));
        vm.mockCall(p.SKRUMPEYS(), abi.encodeWithSelector(balanceOf, alice), abi.encode(uint256(1)));
        vm.mockCall(p.MONAD_CARDS(), abi.encodeWithSelector(balanceOf, alice), abi.encode(uint256(1)));

        (, uint256 holder, uint256 total,,) = p.budgetOf(alice, new uint256[](0));
        assertEq(holder, 0);
        assertEq(total, 32);
    }

    function testDuplicateR3tardIdsRevert() public {
        r.mint(alice, 1);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.DuplicateR3tardId.selector, 1));
        p.paint(hex"00000004", ids);
    }

    function testWetEpochIsPerPixel() public {
        R3OSPaint rich = _rich(10_000);
        vm.prank(alice);
        rich.paint(hex"00000104", new uint256[](0));

        vm.roll(vm.getBlockNumber() + rich.WET_WINDOW_BLOCKS() * 2 + 1);
        vm.prank(alice);
        rich.paint(hex"00000005", new uint256[](0));

        (,, uint256 wet) = rich.tileState(0, 0);
        assertTrue((wet & 1) != 0);
        assertTrue((wet & 2) == 0);
    }

    function testBlankPrimingDoesNotWetOtherPixel() public {
        R3OSPaint rich = _rich(10_000);
        vm.prank(alice);
        rich.paint(hex"00010104", new uint256[](0));

        vm.roll(vm.getBlockNumber() + rich.WET_WINDOW_BLOCKS() * 2 + 1);
        vm.prank(alice);
        rich.paint(hex"00000005", new uint256[](0));

        (,, uint256 wet) = rich.tileState(0, 0);
        assertTrue((wet & 1) != 0);
        assertTrue((wet & 2) == 0);
    }

    function testKeepAliveAttackDoesNotKeepOldTileWet() public {
        R3OSPaint rich = _rich(10_000);
        bytes memory initial;
        for (uint8 y; y < 15; ++y) {
            initial = bytes.concat(initial, abi.encodePacked(y, uint8(0), uint8(15), uint8(4)));
        }
        vm.prank(alice);
        rich.paint(initial, new uint256[](0)); // 240 pixels

        vm.roll(vm.getBlockNumber() + rich.WET_WINDOW_BLOCKS() * 2 + 1);

        // Touch exactly one old pixel. Only that pixel enters the new epoch bitmap.
        vm.prank(alice);
        rich.paint(hex"00000005", new uint256[](0));

        bytes memory wipe;
        for (uint8 y; y < 15; ++y) {
            wipe = bytes.concat(wipe, abi.encodePacked(y, uint8(0), uint8(15), uint8(6)));
        }
        vm.recordLogs();
        vm.prank(alice);
        rich.paint(wipe, new uint256[](0));

        // x0,y0 is wet (1 unit); the remaining 239 are dry (2 units each).
        assertEq(_units(vm.getRecordedLogs(), address(rich)), 479);
    }

    function testHeatBuildsAndDecays() public {
        vm.prank(alice);
        p.paint(hex"00000F04", new uint256[](0));
        (, uint32 heat,) = p.tileState(0, 0);
        assertEq(heat, 16);

        vm.roll(vm.getBlockNumber() + 4);
        (, heat,) = p.tileState(0, 0);
        assertEq(heat, 8);
    }

    function testRegionCapCountsActualWritesAfterSameColorSkips() public {
        R3OSPaint rich = _rich(10_000);
        vm.prank(alice);
        rich.paint(hex"0000FF04", new uint256[](0)); // 256 writes total, 64 in region 0

        vm.prank(bob);
        vm.expectRevert(R3OSPaint.NoChange.selector);
        rich.paint(hex"0000FF04", new uint256[](0));

        (, uint32 inBlock,,,,) = rich.regionState(0, 0);
        assertEq(inBlock, 64);
    }

    function testRegionCapRevertsAbove512ActualPixels() public {
        bytes memory runs;
        for (uint8 y; y < 8; ++y) {
            runs = bytes.concat(runs, abi.encodePacked(y, uint8(0), uint8(63), uint8(4)));
        }
        R3OSPaint rich = _rich(10_000);
        vm.prank(alice);
        rich.paint(runs, new uint256[](0));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.RegionBusy.selector, 0));
        rich.paint(hex"08000004", new uint256[](0));
    }

    function _rich(uint32 budget) internal returns (R3OSPaint) {
        return new R3OSPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, budget, 0, budget, 16, 256
        );
    }

    function _units(Vm.Log[] memory logs, address emitter) internal pure returns (uint32 units) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter == emitter && l.topics.length != 0 && l.topics[0] == PAINTED_SIG) {
                (,, units,) = abi.decode(l.data, (bytes, bytes, uint32, uint16));
                return units;
            }
        }
        revert("Painted not found");
    }
}
