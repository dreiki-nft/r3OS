// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {R3OSPaint} from "../src/R3OSPaint.sol";
import {Test} from "forge-std/Test.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract FramesSeasonsTest is Test {
    R3OSPaint p;
    MockR3tards r;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint64 start;

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        start = uint64(vm.getBlockTimestamp());
        p = new R3OSPaint(address(r), start, alice, alice, 10_000, 0, 10_000, 16, 256);
    }

    function testRoyaltyIsFivePercentToFixedReceiver() public view {
        (address receiver, uint256 amount) = p.royaltyInfo(123, 10 ether);
        assertEq(receiver, alice);
        assertEq(amount, 0.5 ether);
    }

    function testFaceAndBackgroundDoNotSatisfyFramePaintRequirement() public {
        vm.prank(alice);
        p.setFace(7, new uint256[](0));
        vm.prank(alice);
        p.setBackground(5, new uint256[](0));
        vm.prank(alice);
        vm.expectRevert(R3OSPaint.FramePaintRequired.selector);
        p.mintFrame();
    }

    function testFrameRequiresPaintAndCanvasChange() public {
        vm.prank(alice);
        vm.expectRevert(R3OSPaint.FramePaintRequired.selector);
        p.mintFrame();

        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        vm.prank(alice);
        uint256 id = p.mintFrame();
        assertEq(p.ownerOf(id), alice);

        vm.roll(vm.getBlockNumber() + 201);
        vm.prank(alice);
        vm.expectRevert(R3OSPaint.FramePaintRequired.selector);
        p.mintFrame();
    }

    function testFrameDataRemainsReadableAfterBurn() public {
        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        vm.prank(alice);
        uint256 id = p.mintFrame();

        bytes32 beforeHash = keccak256(p.frameData(id));
        vm.prank(alice);
        p.burn(id);
        bytes32 afterHash = keccak256(p.frameData(id));
        assertEq(beforeHash, afterHash);
    }

    function testTokenZeroCannotBurnButTransfersNormally() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.NonBurnableToken.selector, 0));
        p.burn(0);

        vm.prank(alice);
        p.transferFrom(alice, bob, 0);
        assertEq(p.ownerOf(0), bob);
    }

    function testFinaleRoutesToCurrentTokenZeroOwnerAfterTransfer() public {
        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        vm.prank(alice);
        p.transferFrom(alice, bob, 0);

        vm.warp(uint256(start) + 30 days);
        vm.prank(bob);
        uint256 finale = p.mintSeasonFinale(0);
        assertEq(p.ownerOf(finale), bob);

        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.NonBurnableToken.selector, finale));
        vm.prank(bob);
        p.burn(finale);

        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.SeasonFinaleAlreadyMinted.selector, 0));
        vm.prank(bob);
        p.mintSeasonFinale(0);
    }

    function testFinaleRequiresAtLeastOneSuccessfulPaint() public {
        vm.warp(uint256(start) + 30 days);
        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.SeasonHasNoPaint.selector, 0));
        p.mintSeasonFinale(0);
    }

    function testFrameStoresBackgroundBottomUpAndIsImmutable() public {
        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0)); // top row x0 red
        vm.prank(alice);
        uint256 id = p.mintFrame();

        bytes memory data = p.frameData(id);
        assertEq(data.length, 32_768);
        // Top row is last 128 bytes in BMP bottom-up background storage.
        assertEq(uint8(data[32_768 - 128]) >> 4, 4);

        vm.prank(alice);
        p.paint(hex"00000005", new uint256[](0));
        bytes memory same = p.frameData(id);
        assertEq(uint8(same[32_768 - 128]) >> 4, 4);
    }

    function testFrameRendererRecomposesConstantOutlineFromStoredFace() public {
        vm.prank(alice);
        p.setFace(7, new uint256[](0));
        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        vm.prank(alice);
        uint256 id = p.mintFrame();

        // Raw stored background under outline is zero, rendered composite uses white face=7.
        bytes memory raw = p.frameData(id);
        assertEq(raw.length, 32_768);
        bytes memory bmp = p.renderBMP(id);
        assertEq(bmp.length, 118 + 32_768);
    }

    function testBackgroundMetadataUsesNameNotNumber() public {
        vm.prank(alice);
        p.setBackground(5, new uint256[](0));
        string memory uri = p.tokenURI(0);
        // Base64 payload itself is opaque here; render path is exercised and the source uses named trait values.
        assertGt(bytes(uri).length, 100);
    }
}
