// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract MonadNoveltyTest is Test {
    R3tardsPaint paint;
    MockR3tards r;
    address alice = address(0xA11CE);

    function setUp() public {
        vm.roll(1_000);
        r = new MockR3tards();
        paint = new R3tardsPaint(address(r), uint64(vm.getBlockTimestamp()), alice, alice, 20_000, 0, 20_000, 16, 256);
    }

    function testValidatorSealStoresCoinbaseForFrameAndFinale() public {
        address proposer1 = makeAddr("proposer1");
        vm.coinbase(proposer1);
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.prank(alice);
        uint256 frameId = paint.mintFrame();
        R3tardsPaint.FrameInfoData memory frameInfo = paint.frameInfo(frameId);
        assertEq(frameInfo.proposer, proposer1);

        vm.warp(paint.seasonEndTime(0) + 1);
        address proposer2 = address(0xBEEF);
        vm.coinbase(proposer2);
        uint256 finale = paint.mintSeasonFinale(0);
        R3tardsPaint.FrameInfoData memory finaleInfo = paint.frameInfo(finale);
        assertEq(finaleInfo.proposer, proposer2);
    }

    function testStormBoundaryBlocksAndNextStorm() public {
        assertTrue(paint.isStorm(0));
        assertTrue(paint.isStorm(599));
        assertFalse(paint.isStorm(600));
        assertFalse(paint.isStorm(199_999));
        assertTrue(paint.isStorm(200_000));
        assertTrue(paint.isStorm(200_599));
        assertFalse(paint.isStorm(200_600));

        vm.roll(199_999);
        assertEq(paint.nextStormStart(), 200_000);
        vm.roll(200_123);
        assertEq(paint.nextStormStart(), 400_000);
    }

    function testStormForcesDf1AmountAndCountsQuestStat() public {
        vm.roll(200_000);
        vm.prank(alice);
        paint.paint(hex"0000FF04", new uint256[](0));
        (,,,,,,,,, uint64 stormPaints) = paint.painterStats(alice);
        assertEq(stormPaints, 1);

        vm.prank(alice);
        uint256 frameId = paint.mintFrame();
        R3tardsPaint.FrameInfoData memory info = paint.frameInfo(frameId);
        assertEq(info.df1Amount, 200);
        assertTrue(paint.isStorm(info.blockNumber));
    }

    function testRegionWordsAndBlankMaskMatchNaiveReference() public {
        uint8 region = 5;
        vm.prank(alice);
        paint.paint(hex"50607F04", new uint256[](0));

        uint256[64] memory words = paint.regionWords(0, region);
        uint64[64] memory naive = _naiveBlankMask(0, region);

        uint256 before = gasleft();
        uint64[64] memory masks = paint.regionBlankMask(0, region);
        uint256 used = before - gasleft();
        console.log("GAS regionBlankMask", used);

        for (uint256 row; row < 64; ++row) {
            assertEq(masks[row], naive[row], "blank mask mismatch");
            uint256 globalY = (uint256(region) >> 2) * 64 + row;
            uint256 expectedWord;
            for (uint256 x; x < 64; ++x) {
                uint8 c = paint.backgroundPixelAt(0, (uint256(region) & 3) * 64 + x, globalY);
                expectedWord |= uint256(c) << (252 - x * 4);
            }
            assertEq(words[row], expectedWord, "region word mismatch");
        }
    }

    function _naiveBlankMask(uint256 season, uint8 region) internal view returns (uint64[64] memory masks) {
        bytes memory runs = paint.seasonOutlineRuns(season);
        uint64[64] memory outline;
        uint256 regionRow = uint256(region) >> 2;
        uint256 regionCol = uint256(region) & 3;
        uint256 minY = regionRow * 64;
        uint256 maxY = minY + 63;
        uint256 minX = regionCol * 64;
        uint256 maxX = minX + 63;

        for (uint256 o; o < runs.length; o += 3) {
            uint256 y = uint8(runs[o]);
            if (y < minY || y > maxY) continue;
            uint256 x0 = uint8(runs[o + 1]);
            uint256 x1 = uint8(runs[o + 2]);
            if (x1 < minX || x0 > maxX) continue;
            if (x0 < minX) x0 = minX;
            if (x1 > maxX) x1 = maxX;
            for (uint256 x = x0; x <= x1; ++x) {
                outline[y - minY] |= uint64(1) << uint64(63 - (x - minX));
            }
        }

        for (uint256 row; row < 64; ++row) {
            uint256 globalY = minY + row;
            for (uint256 x; x < 64; ++x) {
                uint64 bit = uint64(1) << uint64(63 - x);
                if ((outline[row] & bit) != 0) continue;
                if (paint.backgroundPixelAt(season, minX + x, globalY) == 0) masks[row] |= bit;
            }
        }
    }
}

