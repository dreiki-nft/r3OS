// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";

contract R3tardsPaintTest is Test {
    R3tardsPaint internal paint;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        paint = new R3tardsPaint();
        vm.fee(100 gwei);
    }

    function testCanvasLayoutConstants() public view {
        assertEq(paint.CANVAS_BASE_SLOT() % 128, 0);
        assertEq(paint.OUTLINE_BASE_SLOT() % 128, 0);
        assertEq(paint.FACE_MASK_BASE_SLOT() % 128, 0);
        assertEq(paint.CANVAS_SLOT_COUNT(), 1024);
        assertEq(paint.MASK_SLOT_COUNT(), 256);
    }

    function testGenesisHasWhiteBackgroundAndBlackLineArt() public view {
        assertEq(paint.pixelAt(0, 0), 0);
        assertEq(paint.pixelAt(112, 90), 1); // sacred line art
        assertEq(paint.pixelAt(128, 150), 0); // interior remains background
        assertEq(paint.faceColorIndex(), 1);
    }

    function testPatchWritesExactColorAtBaseFeeFloor() public {
        vm.prank(alice);
        uint256 tokenId = paint.paintAndMint(hex"00000004", 0);

        assertEq(tokenId, 1);
        assertEq(paint.pixelAt(0, 0), 4);
        assertEq(paint.ownerOf(1), alice);
        assertEq(paint.totalMints(), 1);

        (
            address painter,
            uint64 blockNumber,
            uint96 baseFee,
            uint32 pixelWrites,
            uint8 df1,
            uint8 intendedFaceColor,
            uint8 finalFaceColor,
            bytes32 seed
        ) = paint.mintInfo(1);

        assertEq(painter, alice);
        assertGt(blockNumber, 0);
        assertEq(baseFee, 100 gwei);
        assertEq(pixelWrites, 1);
        assertEq(df1, 0);
        assertEq(intendedFaceColor, 0);
        assertEq(finalFaceColor, 0);
        assertTrue(seed != bytes32(0));
    }

    function testLineColorOnlyMintWorks() public {
        vm.prank(alice);
        uint256 tokenId = paint.paintAndMint(hex"", 0);
        assertEq(tokenId, 1);
        assertEq(paint.faceColorIndex(), 0);
        assertEq(paint.pixelAt(112, 90), 0);
    }

    function testHorizontalRunIsInclusive() public {
        vm.prank(alice);
        paint.paintAndMint(hex"FA3C3F0B", 0);
        for (uint256 x = 60; x <= 63; ++x) {
            assertEq(paint.pixelAt(x, 250), 11);
        }
    }

    function testProtectedPixelsIgnoreBackgroundWrites() public {
        vm.prank(alice);
        paint.paintAndMint(hex"5A707004", 0); // y=90, x=112..112, juicy red
        assertEq(paint.pixelAt(112, 90), 1); // sacred line ignores background write

        vm.prank(alice);
        paint.paintAndMint(hex"96808004", 0); // y=150, x=128..128, interior area is editable
        assertEq(paint.pixelAt(128, 150), 4);
    }

    function testMultipleRuns() public {
        bytes memory runs = abi.encodePacked(
            hex"00000104", // y0 x0..1 red
            hex"01020305"  // y1 x2..3 gold
        );
        vm.prank(alice);
        paint.paintAndMint(runs, 0);

        assertEq(paint.pixelAt(0, 0), 4);
        assertEq(paint.pixelAt(1, 0), 4);
        assertEq(paint.pixelAt(2, 1), 5);
        assertEq(paint.pixelAt(3, 1), 5);
    }

    function testInvalidPatchLengthReverts() public {
        vm.expectRevert(R3tardsPaint.InvalidPatchLength.selector);
        paint.paintAndMint(hex"000001", 0);
    }

    function testEmptyPatchReverts() public {
        vm.expectRevert(R3tardsPaint.EmptyPatch.selector);
        paint.paintAndMint(hex"", 0);
    }

    function testRunWithStartAfterEndReverts() public {
        vm.expectRevert();
        paint.paintAndMint(hex"000A0901", 0);
    }

    function testBadColorReverts() public {
        vm.expectRevert();
        paint.paintAndMint(hex"00000010", 0);
    }

    function testBadFaceColorReverts() public {
        vm.expectRevert(R3tardsPaint.InvalidFaceColor.selector);
        paint.paintAndMint(hex"", 2);
    }

    function testDf1Curve() public view {
        uint256 floor = paint.DF1_BASE_FEE_FLOOR();
        assertEq(paint.df1LevelForBaseFee(floor), 0);
        assertEq(paint.df1LevelForBaseFee(floor * 2), 20);
        assertEq(paint.df1LevelForBaseFee(floor * 4), 40);
        assertEq(paint.df1LevelForBaseFee(floor * 8), 60);
        assertEq(paint.df1LevelForBaseFee(floor * 16), 80);
        assertEq(paint.df1LevelForBaseFee(floor * 32), 100);
    }

    function testNFTsAreNormalTransferableERC721s() public {
        vm.prank(alice);
        paint.paintAndMint(hex"00000004", 0);

        vm.prank(alice);
        paint.transferFrom(alice, bob, 1);
        assertEq(paint.ownerOf(1), bob);
    }

    function testEveryMintGetsNextTokenId() public {
        vm.prank(alice);
        assertEq(paint.paintAndMint(hex"00000004", 0), 1);
        vm.prank(bob);
        assertEq(paint.paintAndMint(hex"00010005", 1), 2);
        assertEq(paint.totalMints(), 2);
    }

    function testCanvasLengths() public view {
        assertEq(paint.getCanvas().length, 32_768);
        assertEq(paint.getBackgroundCanvas().length, 32_768);
    }

    function testBMPHeaderAndDimensions() public view {
        bytes memory bmp = paint.renderBMP();
        assertEq(bmp.length, 32_886);
        assertEq(uint8(bmp[0]), 0x42);
        assertEq(uint8(bmp[1]), 0x4d);
        assertEq(uint8(bmp[10]), 0x76);
        assertEq(uint8(bmp[18]), 0x00);
        assertEq(uint8(bmp[19]), 0x01);
        assertEq(uint8(bmp[28]), 0x04);
        assertEq(uint8(bmp[29]), 0x00);
    }

    function testPaletteMatchesCanonicalColors() public view {
        assertEq(paint.paletteColor(0), 0xFFFFFF);
        assertEq(paint.paletteColor(1), 0x000000);
        assertEq(paint.paletteColor(11), 0x5FEDDF);
        assertEq(paint.paletteColor(15), 0xD47827);
    }

    function testTokenURIIsFullyOnchainDataURI() public {
        vm.prank(alice);
        paint.paintAndMint(hex"00000004", 0);
        string memory uri = paint.tokenURI(1);
        assertTrue(bytes(uri).length > 1_000);
        assertEq(_slice(uri, 0, 29), "data:application/json;base64,");
    }

    function _slice(string memory input, uint256 start, uint256 length) internal pure returns (string memory) {
        bytes memory source = bytes(input);
        bytes memory result = new bytes(length);
        for (uint256 i; i < length; ++i) result[i] = source[start + i];
        return string(result);
    }
}
