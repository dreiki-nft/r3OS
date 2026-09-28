// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsBrushes} from "../src/labs/R3tardsBrushes.sol";
import {BrushDNA} from "../src/lib/BrushDNA.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract BrushesTest is Test {
    R3tardsPaint paint;
    R3tardsBrushes brushes;
    MockR3tards r3tards;
    uint256 alicePk = 0xA11CE;
    address alice;

    function setUp() public {
        vm.roll(1_000_700);
        alice = vm.addr(alicePk);
        r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, alice, 512, 0, 512, 16, 256
        );
        vm.prank(alice);
        paint.setSeasonOutline(1, bytes(""), "");
        vm.warp(paint.seasonStartTime(1));
        brushes = new R3tardsBrushes(address(paint), uint64(vm.getBlockTimestamp()));
    }

    function testVectorsAndRunsHash() public view {
        assertEq(
            brushes.brushFromBlockhash(keccak256("fake block 0"), 101_672_712),
            0x0000000000000000060f67080000054e1c344141596545515d758d7246910140
        );
        assertEq(
            brushes.brushFromBlockhash(bytes32(uint256(1)), 1),
            0x000000000000000000000001000006261004c0034001300cc7d31694069027d8
        );
        assertEq(
            brushes.brushFromBlockhash(bytes32(type(uint256).max), 281_474_976_710_655),
            0x000000000000ffffffffffff0000084d1c34d557128447d144114be105501554
        );
        uint256 first = 0x0000000000000000060f67080000054e1c344141596545515d758d7246910140;
        assertEq(
            keccak256(brushes.brushRuns(first, 60, 60)),
            0xfb5f35c1a34b029157232a87417cf48b9de1c21fa230ff53c3f9d81a419e6fcc
        );
    }

    function testCatchWindowAndRules() public {
        uint256 current = vm.getBlockNumber();
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.NotCatchable.selector, current));
        vm.prank(alice);
        brushes.catchBrush(current);

        bytes32 h256 = keccak256("256-back");
        vm.setBlockhash(current - 256, h256);
        vm.prank(alice);
        uint8 slot = brushes.catchBrush(current - 256);
        assertEq(slot, 0);

        vm.roll(current + 1);
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.NotCatchable.selector, current - 256));
        vm.prank(alice);
        brushes.catchBrush(current - 256);

        uint256 src = vm.getBlockNumber() - 1;
        bytes32 h = keccak256("new source");
        vm.setBlockhash(src, h);
        vm.prank(alice);
        brushes.catchBrush(src);
        vm.setBlockhash(src - 1, keccak256("other source"));
        vm.expectRevert(R3tardsBrushes.AlreadyCaughtThisBlock.selector);
        vm.prank(alice);
        brushes.catchBrush(src - 1);

        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.AlreadyInBox.selector, src));
        vm.prank(alice);
        brushes.catchBrush(src);
    }

    function testRingWrapAndVerifiedOverwriteKeepsTotal() public {
        (uint8 verifiedSlot,,) = _catchStampVerify(alice, 10, 10, keccak256("verified"));
        (,,, uint32 verifiedBefore,) = _boxMeta(alice);
        assertEq(verifiedBefore, 1);

        for (uint256 i; i < 8; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            uint256 sourceBlock = vm.getBlockNumber() - 1;
            vm.setBlockhash(sourceBlock, keccak256(abi.encode("wrap", i)));
            vm.prank(alice);
            brushes.catchBrush(sourceBlock);
        }
        (uint256[8] memory boxWords, uint8 nextSlot, uint8 verifiedMask, uint32 catches, uint32 verifiedTotal,) = brushes.box(alice);
        assertEq(nextSlot, uint8((uint256(verifiedSlot) + 1) % 8));
        assertEq(verifiedMask & (uint8(1) << verifiedSlot), 0);
        assertEq(verifiedTotal, 1);
        assertEq(catches, 9);
        assertTrue(boxWords[verifiedSlot] != 0);
    }

    function testSessionCatchAndVerifyCreditedToOwner() public {
        address key = makeAddr("brush-session");
        _startSession(key, 200, 512);
        uint256 sourceBlock = vm.getBlockNumber() - 1;
        vm.setBlockhash(sourceBlock, keccak256("session brush"));
        vm.prank(key);
        uint8 slot = brushes.catchBrush(sourceBlock);
        (uint256[8] memory words,,,,,) = brushes.box(alice);
        uint256 brush = words[slot];
        bytes memory runs = BrushDNA.runs(brush, 20, 20);
        vm.prank(key);
        paint.paint(runs, new uint256[](0));
        vm.prank(key);
        brushes.verify(slot, 20, 20);
        (,, uint8 verifiedMask,, uint32 verifiedTotal,) = brushes.box(alice);
        assertTrue((verifiedMask & (uint8(1) << slot)) != 0);
        assertEq(verifiedTotal, 1);
    }

    function testVerifyOneAndFourRegions() public {
        _catchStampVerify(alice, 10, 10, keccak256("one region"));
        vm.roll(vm.getBlockNumber() + 1);
        _catchStampVerify(alice, 60, 60, keccak256("four regions"));
    }

    function testVerifyFailureErrorsAndSeasonChange() public {
        uint256 sourceBlock = vm.getBlockNumber() - 1;
        vm.setBlockhash(sourceBlock, keccak256("failure brush"));
        vm.prank(alice);
        uint8 slot = brushes.catchBrush(sourceBlock);
        (uint256[8] memory words,,,,,) = brushes.box(alice);
        uint256 brush = words[slot];
        bytes memory runs = BrushDNA.runs(brush, 20, 20);
        vm.prank(alice);
        paint.paint(runs, new uint256[](0));

        (uint8 px, uint8 py, uint8 want) = _firstFilled(brush, 20, 20);
        uint8 wrong = want == 1 ? 2 : 1;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        paint.paint(abi.encodePacked(bytes1(py), bytes1(px), bytes1(px), bytes1(wrong)), new uint256[](0));
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.NotOnCanvas.selector, px, py, want, wrong));
        vm.prank(alice);
        brushes.verify(slot, 20, 20);

        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.OffCanvas.selector, 249, 0));
        brushes.brushRuns(brush, 249, 0);
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.InvalidSlot.selector, 8));
        vm.prank(alice);
        brushes.verify(8, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.EmptySlot.selector, 7));
        vm.prank(makeAddr("empty owner"));
        brushes.verify(7, 0, 0);

        vm.roll(vm.getBlockNumber() + 1);
        (uint8 goodSlot,,) = _catchStampVerify(alice, 100, 100, keccak256("already verified"));
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.AlreadyVerified.selector, goodSlot));
        vm.prank(alice);
        brushes.verify(goodSlot, 100, 100);

        vm.roll(vm.getBlockNumber() + 1);
        uint256 laterSource = vm.getBlockNumber() - 1;
        vm.setBlockhash(laterSource, keccak256("season fail"));
        vm.prank(alice);
        uint8 seasonSlot = brushes.catchBrush(laterSource);
        (words,,,,,) = brushes.box(alice);
        bytes memory seasonRuns = BrushDNA.runs(words[seasonSlot], 150, 150);
        vm.prank(alice);
        paint.paint(seasonRuns, new uint256[](0));
        vm.warp(paint.seasonStartTime(2));
        vm.expectPartialRevert(R3tardsBrushes.NotOnCanvas.selector);
        vm.prank(alice);
        brushes.verify(seasonSlot, 150, 150);
    }

    function testBrushOverDefaultOutlineCannotVerify() public {
        R3tardsPaint defaultPaint = new R3tardsPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, alice, 512, 0, 512, 16, 256
        );
        R3tardsBrushes defaultBrushes = new R3tardsBrushes(address(defaultPaint), uint64(vm.getBlockTimestamp()));
        bytes memory outline = defaultPaint.genesisFrameData(0);
        (uint8 x, uint8 y) = _firstSafeOutlinePixel(outline);
        uint256 brush = uint256(0x55555555555555555555555555555555) | (uint256(4) << 128);
        vm.store(address(defaultBrushes), bytes32(defaultBrushes.boxBase(alice)), bytes32(brush));
        vm.prank(alice);
        defaultPaint.paint(BrushDNA.runs(brush, x, y), new uint256[](0));
        vm.expectRevert(abi.encodeWithSelector(R3tardsBrushes.NotOnCanvas.selector, x, y, uint8(4), uint8(0)));
        vm.prank(alice);
        defaultBrushes.verify(0, x, y);
    }

    function testStampFlipsAtThreeVerifiedBrushes() public {
        for (uint256 i; i < 3; ++i) {
            if (i != 0) vm.roll(vm.getBlockNumber() + 1);
            _catchStampVerify(alice, uint8(20 + i * 20), uint8(20 + i * 20), keccak256(abi.encode("stamp", i)));
        }
        (string memory name, bool earned) = brushes.stamp(alice);
        assertEq(name, "BLOCK DNA");
        assertTrue(earned);
    }

    function testPreviewBlock() public {
        uint256 sourceBlock = vm.getBlockNumber() - 1;
        bytes32 h = keccak256("preview");
        vm.setBlockhash(sourceBlock, h);
        assertEq(brushes.previewBlock(sourceBlock), BrushDNA.fromBlockhash(h, sourceBlock));
        assertEq(brushes.previewBlock(vm.getBlockNumber()), 0);
        vm.roll(vm.getBlockNumber() + 257);
        assertEq(brushes.previewBlock(sourceBlock), 0);
    }

    function testGasTargets() public {
        uint256 sourceBlock = vm.getBlockNumber() - 1;
        vm.setBlockhash(sourceBlock, keccak256("gas catch"));
        uint256 gasBefore = gasleft();
        vm.prank(alice);
        uint8 slot1 = brushes.catchBrush(sourceBlock);
        uint256 catchGas = gasBefore - gasleft();
        console.log("GAS Brushes catchBrush", catchGas);
        assertLt(catchGas, 160_000);

        (uint256[8] memory words,,,,,) = brushes.box(alice);
        vm.prank(alice);
        paint.paint(BrushDNA.runs(words[slot1], 10, 10), new uint256[](0));
        gasBefore = gasleft();
        vm.prank(alice);
        brushes.verify(slot1, 10, 10);
        uint256 oneRegionGas = gasBefore - gasleft();
        console.log("GAS Brushes verify one region", oneRegionGas);
        assertLt(oneRegionGas, 250_000);

        vm.roll(vm.getBlockNumber() + 1);
        uint256 src2 = vm.getBlockNumber() - 1;
        vm.setBlockhash(src2, keccak256("gas four"));
        vm.prank(alice);
        uint8 slot4 = brushes.catchBrush(src2);
        (words,,,,,) = brushes.box(alice);
        vm.prank(alice);
        paint.paint(BrushDNA.runs(words[slot4], 60, 60), new uint256[](0));
        gasBefore = gasleft();
        vm.prank(alice);
        brushes.verify(slot4, 60, 60);
        uint256 fourRegionGas = gasBefore - gasleft();
        console.log("GAS Brushes verify four regions", fourRegionGas);
        assertLt(fourRegionGas, 400_000);

        gasBefore = gasleft();
        brushes.stamp(alice);
        uint256 stampGas = gasBefore - gasleft();
        console.log("GAS Brushes stamp", stampGas);
        assertLt(stampGas, 20_000);
    }

    function _catchStampVerify(address owner, uint8 x, uint8 y, bytes32 h)
        internal
        returns (uint8 slot, uint256 brush, uint256 sourceBlock)
    {
        sourceBlock = vm.getBlockNumber() - 1;
        vm.setBlockhash(sourceBlock, h);
        vm.prank(owner);
        slot = brushes.catchBrush(sourceBlock);
        (uint256[8] memory words,,,,,) = brushes.box(owner);
        brush = words[slot];
        vm.prank(owner);
        paint.paint(BrushDNA.runs(brush, x, y), new uint256[](0));
        vm.prank(owner);
        brushes.verify(slot, x, y);
    }

    function _boxMeta(address owner)
        internal
        view
        returns (uint8 nextSlot, uint8 verifiedMask, uint32 catches, uint32 verifiedTotal, uint48 lastCatchBlock)
    {
        (, nextSlot, verifiedMask, catches, verifiedTotal, lastCatchBlock) = brushes.box(owner);
    }

    function _firstFilled(uint256 brush, uint8 x, uint8 y) internal pure returns (uint8 px, uint8 py, uint8 want) {
        for (uint256 r; r < 8; ++r) {
            for (uint256 c; c < 8; ++c) {
                uint256 slot = BrushDNA.cell(brush, r, c);
                if (slot == 0) continue;
                return (uint8(uint256(x) + c), uint8(uint256(y) + r), BrushDNA.colour(brush, slot));
            }
        }
        revert("empty brush");
    }

    function _firstSafeOutlinePixel(bytes memory outline) internal pure returns (uint8 x, uint8 y) {
        for (uint256 py; py <= 248; ++py) {
            uint256 row = (255 - py) * 128;
            for (uint256 px; px <= 248; ++px) {
                uint8 packed = uint8(outline[row + (px >> 1)]);
                uint8 nibble = (px & 1) == 0 ? packed >> 4 : packed & 0x0f;
                if (nibble != 0) return (uint8(px), uint8(py));
            }
        }
        revert("no safe outline pixel");
    }

    function _startSession(address key, uint256 blocks_, uint256 maxUnits) internal {
        uint256 expiry = vm.getBlockNumber() + blocks_;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        uint256 nonce = paint.sessionNonces(alice);
        bytes32 typehash = paint.SESSION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(typehash, alice, key, expiry, maxUnits, nonce, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("r3tards paint")),
                keccak256(bytes("2")),
                block.chainid,
                address(paint)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);
        vm.prank(key);
        paint.startSession(alice, key, expiry, maxUnits, nonce, deadline, abi.encodePacked(r, s, v));
    }
}
