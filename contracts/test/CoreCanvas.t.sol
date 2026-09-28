// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {Test} from "forge-std/Test.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract CoreCanvasTest is Test {
    R3tardsPaint p;
    MockR3tards r;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint64 start;

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        start = uint64(vm.getBlockTimestamp());
        p = new R3tardsPaint(address(r), start, alice, alice, 32, 16, 256, 16, 256);
    }

    function testLayoutAndGenesis() public view {
        assertEq(p.canvasBaseSlot(0) % 128, 0);
        assertEq(p.canvasBaseSlot(1) % 128, 0);
        assertEq(p.regionStateBaseSlot(0) % 128, 0);
        assertEq(p.regionPageSlot(0, 1) - p.regionPageSlot(0, 0), 128);
        assertEq(p.OUTLINE_BASE_SLOT() % 128, 0);
        assertTrue(p.canvasBaseSlot(0) != p.canvasBaseSlot(1));
        assertEq(p.pixelAt(0, 112, 90), 1);
        assertEq(p.backgroundPixelAt(0, 112, 90), 0);
        assertEq(p.paletteColor(7), 0xFFFFFF);
    }

    function testOutlineCoveredWriteIsCompleteNoOp() public {
        vm.prank(alice);
        vm.expectRevert(R3tardsPaint.NoChange.selector);
        p.paint(hex"5A707004", new uint256[](0));
        assertEq(p.backgroundPixelAt(0, 112, 90), 0);
    }

    function testWordWriterCrossesSlotBoundary() public {
        vm.prank(alice);
        p.paint(hex"003C4304", new uint256[](0)); // x60..67
        for (uint256 x = 60; x <= 67; ++x) assertEq(p.backgroundPixelAt(0, x, 0), 4);
    }

    function testFaceWhiteIsSevenAndBackgroundPaletteEntryZeroChanges() public {
        r.mint(alice, 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(alice);
        p.setFace(7, ids);
        assertEq(p.faceColor(0), 7);

        vm.roll(vm.getBlockNumber() + 1_001);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.prank(alice);
        p.setBackground(5, ids);

        bytes memory bmp = p.renderBMP(0);
        assertEq(uint8(bmp[54]), 0x43); // B
        assertEq(uint8(bmp[55]), 0xC3); // G
        assertEq(uint8(bmp[56]), 0xFE); // R
    }

    function testFaceAndBackgroundCooldownsAndAllowedColors() public {
        R3tardsPaint rich = new R3tardsPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 10_000, 0, 10_000, 16, 256
        );
        vm.prank(alice);
        rich.setFace(7, new uint256[](0));

        vm.prank(alice);
        vm.expectRevert(R3tardsPaint.NoChange.selector);
        rich.setFace(7, new uint256[](0));

        uint256 faceUntil = vm.getBlockNumber() + rich.FACE_FLIP_COOLDOWN_BLOCKS();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.CooldownActive.selector, faceUntil));
        rich.setFace(1, new uint256[](0));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.InvalidBackgroundColor.selector, 4));
        rich.setBackground(4, new uint256[](0));

        vm.prank(alice);
        rich.setBackground(5, new uint256[](0));
        uint256 bgUntil = vm.getBlockNumber() + rich.BACKGROUND_COOLDOWN_BLOCKS();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.CooldownActive.selector, bgUntil));
        rich.setBackground(6, new uint256[](0));
    }

    function testSeasonRolloverIsFreshAndActionsBeforeStartRevert() public {
        R3tardsPaint future = new R3tardsPaint(
            address(r), uint64(vm.getBlockTimestamp() + 100), alice, alice, 32, 16, 256, 16, 256
        );
        vm.prank(alice);
        vm.expectRevert(R3tardsPaint.NotOpenYet.selector);
        future.paint(hex"00000004", new uint256[](0));

        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        assertEq(p.backgroundPixelAt(0, 0, 0), 4);

        vm.warp(uint256(start) + 30 days);
        assertEq(p.currentSeason(), 1);
        assertEq(p.backgroundPixelAt(1, 0, 0), 0);
        assertEq(p.faceColor(1), 1);
    }

    function testWritesInDifferentRegionsHaveDisjointStorageWrites() public {
        vm.record();
        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        (, bytes32[] memory aWrites) = vm.accesses(address(p));

        vm.record();
        vm.prank(bob);
        p.paint(hex"00C0C004", new uint256[](0));
        (, bytes32[] memory bWrites) = vm.accesses(address(p));

        for (uint256 i; i < aWrites.length; ++i) {
            for (uint256 j; j < bWrites.length; ++j) assertTrue(aWrites[i] != bWrites[j]);
        }
    }

    function testRenderSVGSample() public {
        vm.prank(alice);
        p.paint(hex"00000F04", new uint256[](0));
        string memory svg = p.renderSVG(0);
        assertGt(bytes(svg).length, 1_000);
        vm.writeFile("test-output/live.svg", svg);
    }

    function testConstructorValidation() public {
        vm.expectRevert(R3tardsPaint.InvalidConfig.selector);
        new R3tardsPaint(address(r), start, alice, alice, 300, 0, 256, 16, 256);

        vm.expectRevert(R3tardsPaint.InvalidConfig.selector);
        new R3tardsPaint(address(r), start, alice, alice, 32, 16, 256, 16, 65_536);
    }
}
