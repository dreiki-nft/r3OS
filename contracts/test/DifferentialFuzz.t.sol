// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract DifferentialFuzzTest is Test {
    R3tardsPaint p;
    MockR3tards r;
    address alice = address(0xA11CE);
    bytes32 constant PAINTED_SIG = keccak256("Painted(uint256,address,address,bytes,bytes,uint32,uint16)");

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        p = new R3tardsPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 20_000, 0, 20_000, 16, 256
        );
    }

    function testUnitCounterBlankWetDryReference() public {
        vm.recordLogs();
        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        assertEq(_units(vm.getRecordedLogs()), 1);

        vm.recordLogs();
        vm.prank(alice);
        p.paint(hex"00000005", new uint256[](0));
        assertEq(_units(vm.getRecordedLogs()), 1);

        vm.roll(vm.getBlockNumber() + p.WET_WINDOW_BLOCKS() * 2 + 1);
        vm.recordLogs();
        vm.prank(alice);
        p.paint(hex"00000006", new uint256[](0));
        assertEq(_units(vm.getRecordedLogs()), 2);
    }


    function testStormReferenceStillMatchesWriterAndUnits() public {
        vm.roll(200_000);
        bytes memory runs = hex"00000F04";
        vm.recordLogs();
        vm.prank(alice);
        p.paint(runs, new uint256[](0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_units(logs), 16);

        bytes memory chain = p.getBackgroundCanvas();
        for (uint256 x; x < 16; ++x) {
            uint256 bi = x / 2;
            uint8 stored = uint8(chain[bi]);
            uint8 color = x % 2 == 0 ? stored >> 4 : stored & 0x0F;
            assertTrue(color >= 1 && color <= 15);
        }
    }

    function testFuzzWordWriterAndFreshUnitCounter(uint8 y, uint8 a, uint8 b, uint8 colorSeed) public {
        uint8 x0 = a < b ? a : b;
        uint8 x1 = a < b ? b : a;
        uint8 color = uint8(uint256(colorSeed) % 15 + 1);

        bool[256] memory outline;
        uint256 expectedUnits;
        for (uint256 x = x0; x <= x1; ++x) {
            outline[x] = p.pixelAt(0, x, y) == 1;
            if (!outline[x]) ++expectedUnits;
        }
        if (expectedUnits == 0) return;

        bytes memory runs = abi.encodePacked(y, x0, x1, color);
        vm.recordLogs();
        vm.prank(alice);
        p.paint(runs, new uint256[](0));
        assertEq(_units(vm.getRecordedLogs()), expectedUnits);

        for (uint256 x = x0; x <= x1; ++x) {
            assertEq(p.backgroundPixelAt(0, x, y), outline[x] ? 0 : color);
        }
    }

    function testFuzzDryOverwriteCostsTwoPerActualPixel(uint8 y, uint8 a, uint8 b) public {
        uint8 x0 = a < b ? a : b;
        uint8 x1 = a < b ? b : a;

        uint256 actual;
        for (uint256 x = x0; x <= x1; ++x) {
            if (p.pixelAt(0, x, y) != 1) ++actual;
        }
        if (actual == 0 || actual > 250) return; // stay under per-tile heat ceiling for this focused reference

        bytes memory first = abi.encodePacked(y, x0, x1, uint8(4));
        vm.prank(alice);
        p.paint(first, new uint256[](0));

        vm.roll(vm.getBlockNumber() + p.WET_WINDOW_BLOCKS() * 2 + 1);
        bytes memory second = abi.encodePacked(y, x0, x1, uint8(5));
        vm.recordLogs();
        vm.prank(alice);
        p.paint(second, new uint256[](0));
        assertEq(_units(vm.getRecordedLogs()), actual * 2);
    }

    function _units(Vm.Log[] memory logs) internal view returns (uint32 units) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter == address(p) && l.topics.length != 0 && l.topics[0] == PAINTED_SIG) {
                (,, units,) = abi.decode(l.data, (bytes, bytes, uint32, uint16));
                return units;
            }
        }
        revert("Painted not found");
    }
}
