// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract R3tardsPaintBenchmark is R3tardsPaint {
    constructor(address r, address recipient)
        R3tardsPaint(r, uint64(block.timestamp), recipient, recipient, 200_000, 0, 200_000, 16, 256)
    {}

    function _maxRegionPixels() internal pure override returns (uint256) {
        return 4_096;
    }
}

contract GasBenchmarksTest is Test {
    MockR3tards r;
    R3tardsPaintBenchmark bench;
    R3tardsPaint prod;
    address alice = address(0xA11CE);

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        bench = new R3tardsPaintBenchmark(address(r), alice);
        prod = new R3tardsPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 200_000, 0, 200_000, 16, 256
        );
    }

    function testGasDeployUnder30M() public {
        uint256 g = gasleft();
        new R3tardsPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 32, 16, 256, 16, 256
        );
        uint256 used = g - gasleft();
        console.log("GAS deploy", used);
        assertLt(used, 20_000_000);
    }

    function testGasFullCanvasFreshWetDry() public {
        bytes memory fresh = _fullCanvas(4);
        uint256 freshUsed = _measurePaint(bench, fresh);
        console.log("GAS full-canvas fresh area", freshUsed);

        vm.roll(vm.getBlockNumber() + 1);
        bytes memory wet = _fullCanvas(5);
        uint256 wetUsed = _measurePaint(bench, wet);
        console.log("GAS full-canvas wet repaint", wetUsed);

        _advanceToDryWindow();
        bytes memory dry = _fullCanvas(6);
        uint256 dryUsed = _measurePaint(bench, dry);
        console.log("GAS full-canvas dry repaint", dryUsed);
    }

    function testGas8192FreshWetDry() public {
        bytes memory fresh = _spread8192(4);
        uint256 freshUsed = _measurePaint(prod, fresh);
        console.log("GAS 8192-px fresh area", freshUsed);
        assertLe(freshUsed, 9_900_000);

        vm.roll(vm.getBlockNumber() + 1);
        bytes memory wet = _spread8192(5);
        uint256 wetUsed = _measurePaint(prod, wet);
        console.log("GAS 8192-px wet repaint", wetUsed);
        assertLe(wetUsed, 3_700_000);

        _advanceToDryWindow();
        bytes memory dry = _spread8192(6);
        uint256 dryUsed = _measurePaint(prod, dry);
        console.log("GAS 8192-px dry repaint", dryUsed);
        assertLe(dryUsed, 3_800_000);
    }

    function testGas128FreshWetDry() public {
        uint256 freshUsed = _measurePaint(prod, hex"00007F04");
        console.log("GAS 128-px fresh area", freshUsed);
        assertLe(freshUsed, 800_000);

        vm.roll(vm.getBlockNumber() + 1);
        uint256 wetUsed = _measurePaint(prod, hex"00007F05");
        console.log("GAS 128-px wet repaint", wetUsed);
        assertLe(wetUsed, 250_000);

        _advanceToDryWindow();
        uint256 dryUsed = _measurePaint(prod, hex"00007F06");
        console.log("GAS 128-px dry repaint", dryUsed);
        assertLe(dryUsed, 260_000);
    }

    function testGas20StrokeFreshWetDry() public {
        uint256 freshUsed = _measurePaint(prod, hex"00001304");
        console.log("GAS 20-px fresh area", freshUsed);
        assertLe(freshUsed, 400_000);

        vm.roll(vm.getBlockNumber() + 1);
        uint256 wetUsed = _measurePaint(prod, hex"00001305");
        console.log("GAS 20-px wet repaint", wetUsed);
        assertLe(wetUsed, 170_000);

        _advanceToDryWindow();
        uint256 dryUsed = _measurePaint(prod, hex"00001306");
        console.log("GAS 20-px dry repaint", dryUsed);
        assertLe(dryUsed, 175_000);
    }

    function testGasMintFrameUnder8M() public {
        vm.prank(alice);
        prod.paint(hex"00001304", new uint256[](0));

        uint256 g = gasleft();
        vm.prank(alice);
        prod.mintFrame();
        uint256 used = g - gasleft();
        console.log("GAS mintFrame", used);
        assertLt(used, 8_500_000);
    }

    function testGasTokenURIUnder11M() public {
        uint256 g = gasleft();
        prod.tokenURI(0);
        uint256 used = g - gasleft();
        console.log("GAS tokenURI(0)", used);
        assertLt(used, 10_000_000);
    }

    function testGasFrameTokenURIUnder11M() public {
        vm.prank(alice);
        prod.paint(hex"00001304", new uint256[](0));
        vm.prank(alice);
        uint256 id = prod.mintFrame();

        uint256 g = gasleft();
        prod.tokenURI(id);
        uint256 used = g - gasleft();
        console.log("GAS tokenURI(frame)", used);
        assertLt(used, 10_000_000);
    }

    function _measurePaint(R3tardsPaint target, bytes memory runs) internal returns (uint256 used) {
        uint256 g = gasleft();
        vm.prank(alice);
        target.paint(runs, new uint256[](0));
        used = g - gasleft();
    }

    function _advanceToDryWindow() internal {
        vm.roll(vm.getBlockNumber() + prod.WET_WINDOW_BLOCKS() * 2 + 1);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
    }

    function _fullCanvas(uint8 color) internal pure returns (bytes memory runs) {
        for (uint16 y; y < 256; ++y) {
            runs = bytes.concat(runs, abi.encodePacked(uint8(y), uint8(0), uint8(255), color));
        }
    }

    function _spread8192(uint8 color) internal pure returns (bytes memory runs) {
        for (uint8 band; band < 4; ++band) {
            for (uint8 dy; dy < 8; ++dy) {
                uint8 y = band * 64 + dy;
                runs = bytes.concat(runs, abi.encodePacked(y, uint8(0), uint8(255), color));
            }
        }
    }
}
