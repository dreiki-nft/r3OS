// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {R3OSFlipbook} from "../src/labs/R3OSFlipbook.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract FlipbookTest is Test {
    R3OSPaint paint;
    R3OSFlipbook flipbook;
    R3OSLabs labs;
    MockR3tards r3tards;

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob;
    address carol;
    address royalty;

    function setUp() public {
        vm.roll(1_000);
        alice = vm.addr(alicePk);
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        royalty = makeAddr("royalty");
        r3tards = new MockR3tards();
        paint = new R3OSPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, royalty, 512, 0, 512, 16, 256
        );
        labs = new R3OSLabs(address(paint), royalty);
        flipbook = new R3OSFlipbook(address(paint), address(labs), uint64(vm.getBlockTimestamp()), 300, _genesis());
        vm.prank(alice);
        uint256 experimentId = paint.addExperiment(address(flipbook), "flipbook", "");
        flipbook.bindExperimentId(experimentId);
    }

    function testGenesisExistsAndMatchesConstructorBytes() public view {
        (bytes memory pixels, uint48 blockNumber, address proposer, uint16 painted, uint8 painters) = flipbook.frame(0);
        assertEq(pixels, _genesis());
        assertEq(blockNumber, uint48(block.number));
        assertEq(proposer, block.coinbase);
        assertEq(painted, 0);
        assertEq(painters, 0);
        assertEq(flipbook.frameCount(), 1);
        assertEq(flipbook.lastFrameBlock(), uint48(block.number));
    }


    function testConstructorValidation() public {
        vm.expectRevert(R3OSFlipbook.ZeroAddress.selector);
        new R3OSFlipbook(address(0), address(labs), uint64(vm.getBlockTimestamp()), 300, _genesis());

        vm.expectRevert(R3OSFlipbook.ZeroAddress.selector);
        new R3OSFlipbook(address(paint), address(0), uint64(vm.getBlockTimestamp()), 300, _genesis());

        vm.expectRevert(R3OSFlipbook.InvalidConfig.selector);
        new R3OSFlipbook(address(paint), address(labs), uint64(vm.getBlockTimestamp()), 0, _genesis());

        vm.expectRevert(R3OSFlipbook.InvalidConfig.selector);
        new R3OSFlipbook(address(paint), address(labs), uint64(vm.getBlockTimestamp()), 300, new bytes(511));
    }

    function testNotOpenYet() public {
        R3OSFlipbook future = new R3OSFlipbook(
            address(paint), address(labs), uint64(vm.getBlockTimestamp() + 100), 300, _genesis()
        );
        vm.prank(alice);
        vm.expectRevert(R3OSFlipbook.NotOpenYet.selector);
        future.paint(hex"00000004");
    }

    function testFirstPaintStartsFrameAndCarriesPreviousExactly() public {
        bytes memory expected = _applyReference(_genesis(), hex"00030504");
        address proposer = makeAddr("proposer");
        vm.coinbase(proposer);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        flipbook.paint(hex"00030504");

        (bytes memory pixels, uint48 blockNumber, address sealedBy, uint16 painted, uint8 painters) = flipbook.frame(1);
        assertEq(pixels, expected);
        assertEq(blockNumber, uint48(block.number));
        assertEq(sealedBy, proposer);
        assertEq(painted, 3);
        assertEq(painters, 1);
    }

    function testTwoOwnersSameBlockShareOneFrame() public {
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        flipbook.paint(hex"00000104");
        vm.prank(bob);
        flipbook.paint(hex"01010205");
        assertEq(flipbook.frameCount(), 2);

        bytes memory expected = _applyReference(_applyReference(_genesis(), hex"00000104"), hex"01010205");
        (bytes memory pixels,,, uint16 painted, uint8 painters) = flipbook.frame(1);
        assertEq(pixels, expected);
        assertEq(painted, 4);
        assertEq(painters, 2);
    }

    function testSameOwnerCannotPaintTwiceInBlock() public {
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        flipbook.paint(hex"00000004");
        vm.prank(alice);
        vm.expectRevert(R3OSFlipbook.AlreadyPaintedThisBlock.selector);
        flipbook.paint(hex"01010104");
    }

    function testNoChangeRevertsAndDoesNotCreateFrame() public {
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        vm.expectRevert(R3OSFlipbook.NoChange.selector);
        flipbook.paint(hex"00000000");
        assertEq(flipbook.frameCount(), 1);
    }

    function testRunValidationAndPixelCap() public {
        vm.startPrank(alice);
        vm.expectRevert(R3OSFlipbook.InvalidRunsLength.selector);
        flipbook.paint(hex"");
        vm.expectRevert(R3OSFlipbook.InvalidRunsLength.selector);
        flipbook.paint(hex"00");

        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.InvalidRun.selector, 0));
        flipbook.paint(hex"20000001");
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.InvalidRun.selector, 0));
        flipbook.paint(hex"00020101");
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.InvalidRun.selector, 0));
        flipbook.paint(hex"00002001");
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.InvalidRun.selector, 0));
        flipbook.paint(hex"00000010");

        bytes memory tooManyRuns = new bytes(33 * 4);
        for (uint256 i; i < 33; ++i) {
            tooManyRuns[i * 4] = bytes1(uint8(i % 32));
            tooManyRuns[i * 4 + 1] = 0x00;
            tooManyRuns[i * 4 + 2] = 0x00;
            tooManyRuns[i * 4 + 3] = 0x01;
        }
        vm.expectRevert(R3OSFlipbook.TooManyRuns.selector);
        flipbook.paint(tooManyRuns);

        vm.expectRevert(R3OSFlipbook.TooManyPixels.selector);
        flipbook.paint(hex"00001F0101001F0102001F01");
        vm.stopPrank();
    }

    function testInkNewWalletAndCorePainterAndReset() public {
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        flipbook.paint(hex"00001F0101001F01"); // 64 px
        (uint256 available, uint256 limit, uint256 resetAt) = flipbook.inkAvailable(alice);
        assertEq(limit, 64);
        assertEq(available, 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.InsufficientInk.selector, 1, 0));
        flipbook.paint(hex"02000001");

        vm.prank(bob);
        paint.paint(hex"00000004", new uint256[](0));
        assertEq(paint.daysPainted(bob), 1);

        for (uint256 i; i < 4; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(bob);
            flipbook.paint(abi.encodePacked(uint8(4 + i * 2), uint8(0), uint8(31), uint8(2 + i)));
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(bob);
            flipbook.paint(abi.encodePacked(uint8(5 + i * 2), uint8(0), uint8(31), uint8(2 + i)));
        }
        (available, limit,) = flipbook.inkAvailable(bob);
        assertEq(limit, 256);
        assertEq(available, 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.InsufficientInk.selector, 1, 0));
        flipbook.paint(hex"0C000001");

        vm.roll(resetAt + 1);
        (available, limit, resetAt) = flipbook.inkAvailable(alice);
        assertEq(available, 64);
        assertEq(limit, 64);
        assertGt(resetAt, block.number);
    }

    function testSessionPaintCreditedToOwnerAndCannotMint() public {
        address key = vm.addr(0xBEEF);
        _startSession(key, 200, 1_000);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(key);
        flipbook.paint(hex"02000104");
        (,,, uint64 ownerFramePlusOne, uint32 ownerFrames,) = flipbook.painterInfo(alice);
        assertEq(ownerFramePlusOne, 2);
        assertEq(ownerFrames, 1);
        (,,, uint64 keyFramePlusOne,,) = flipbook.painterInfo(key);
        assertEq(keyFramePlusOne, 0);

        vm.prank(key);
        vm.expectRevert(R3OSFlipbook.SessionKeyPaintOnly.selector);
        flipbook.mintReel();
    }

    function testRingWraparoundRecentFramesOrderAndExpiry() public {
        bytes memory refModel = _genesis();
        bytes32[40] memory expectedHashes;
        expectedHashes[0] = keccak256(refModel);
        for (uint256 i; i < 39; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            uint8 color = i < 32 ? 2 : 3;
            bytes memory runs = abi.encodePacked(uint8(i % 32), uint8(i % 32), uint8(i % 32), color);
            refModel = _applyReference(refModel, runs);
            expectedHashes[i + 1] = keccak256(refModel);
            vm.prank(alice);
            flipbook.paint(runs);
        }
        assertEq(flipbook.frameCount(), 40);
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.FrameExpired.selector, 5));
        flipbook.frame(5);

        (uint64 first, bytes memory pixels, uint48[] memory blocks,,,) = _recent32();
        assertEq(first, 8);
        assertEq(pixels.length, 32 * 512);
        assertEq(blocks.length, 32);
        for (uint256 i; i < 32; ++i) {
            assertEq(_frameHashAt(pixels, i), expectedHashes[8 + i]);
            if (i + 1 < blocks.length) assertLt(blocks[i], blocks[i + 1]);
        }
    }

    function testFirstReelAtEightFramesIncludesGenesis() public {
        _makeFrames(7, alice);
        vm.prank(alice);
        uint256 id = flipbook.mintReel();

        (address pointer, uint64 firstFrame, uint8 count,) = flipbook.reelInfo(id);
        assertTrue(pointer != address(0));
        assertEq(firstFrame, 0);
        assertEq(count, 8);

        bytes memory reelBytes = flipbook.reelData(id);
        bytes memory genesis = _genesis();
        assertEq(uint8(reelBytes[0]), 8);
        for (uint256 i; i < 512; ++i) assertEq(reelBytes[1 + i], genesis[i]);
    }

    function testReelRulesAndSnapshotImmutability() public {
        vm.prank(alice);
        vm.expectRevert(R3OSFlipbook.NotEnoughFrames.selector);
        flipbook.mintReel();

        _makeFrames(7, alice);
        vm.prank(bob);
        vm.expectRevert(R3OSFlipbook.NotInReel.selector);
        flipbook.mintReel();

        vm.prank(alice);
        uint256 id = flipbook.mintReel();
        bytes memory reelBytes = flipbook.reelData(id);
        assertEq(uint8(reelBytes[0]), 8);
        assertEq(reelBytes.length, 1 + 8 * 512 + 8 * 29);
        bytes32 beforeHash = keccak256(bytes(labs.tokenURI(id)));

        _makeFrames(1, alice);
        uint256 minimumEnd = uint256(flipbook.lastReelEndFrame()) + flipbook.MIN_NEW_FRAMES_PER_REEL();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.ReelTooSoon.selector, minimumEnd));
        flipbook.mintReel();

        _makeFrames(31, alice);
        (,,,,, uint48 lastReelBlock) = flipbook.painterInfo(alice);
        uint256 until = uint256(lastReelBlock) + flipbook.REEL_COOLDOWN_BLOCKS();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSFlipbook.CooldownActive.selector, until));
        flipbook.mintReel();

        _makeFrames(2, bob);
        assertEq(keccak256(bytes(labs.tokenURI(id))), beforeHash);
    }

    function testReelOwnershipLivesInLabsAndBalanceProxyTracksTransfers() public {
        _makeFrames(7, alice);
        vm.prank(alice);
        uint256 id = flipbook.mintReel();
        assertEq(labs.ownerOf(id), alice);
        assertEq(flipbook.balanceOf(alice), 1);
        assertEq(flipbook.balanceOf(bob), 0);

        vm.prank(alice);
        labs.transferFrom(alice, bob, id);
        assertEq(labs.ownerOf(id), bob);
        assertEq(flipbook.balanceOf(alice), 0);
        assertEq(flipbook.balanceOf(bob), 1);
    }

    function testReelsPartitionHistoryWithoutOverlap() public {
        _makeFrames(7, alice);
        vm.prank(alice);
        uint256 firstId = flipbook.mintReel();
        (, uint64 firstStart, uint8 firstCount,) = flipbook.reelInfo(firstId);
        assertEq(firstStart, 0);
        assertEq(firstCount, 8);

        _makeFrames(32, alice);
        (,,,,, uint48 firstMintBlock) = flipbook.painterInfo(alice);
        vm.roll(uint256(firstMintBlock) + flipbook.REEL_COOLDOWN_BLOCKS());
        vm.prank(alice);
        uint256 secondId = flipbook.mintReel();
        (, uint64 secondStart, uint8 secondCount,) = flipbook.reelInfo(secondId);
        assertEq(secondStart, 8);
        assertEq(secondCount, 32);
        assertEq(secondStart, firstStart + firstCount);
    }

    function testStampAfterTenDistinctFrames() public {
        (string memory name, bool earned) = flipbook.stamp(alice);
        assertEq(name, "FLIPBOOK");
        assertFalse(earned);
        _makeFrames(10, alice);
        (, earned) = flipbook.stamp(alice);
        assertTrue(earned);
    }

    function testFuzzDifferentialSixtyBlocks(uint256 seed) public {
        address[3] memory owners = [alice, bob, carol];
        for (uint256 i; i < owners.length; ++i) {
            vm.prank(owners[i]);
            paint.paint(abi.encodePacked(uint8(0), uint8(i), uint8(i), uint8(i + 2)), new uint256[](0));
        }

        bytes memory refModel = _genesis();
        for (uint256 i; i < 60; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint8 y = uint8(seed % 32);
            uint8 x0 = uint8((seed >> 8) % 29);
            uint8 width = uint8(((seed >> 16) % 4) + 1);
            uint8 x1 = x0 + width - 1;
            uint8 color = uint8(((seed >> 24) % 15) + 1);
            uint8 current = _referencePixel(refModel, x0, y);
            if (color == current) color = color == 15 ? 1 : color + 1;
            bytes memory runs = abi.encodePacked(y, x0, x1, color);
            refModel = _applyReference(refModel, runs);
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(owners[(seed >> 32) % 3]);
            flipbook.paint(runs);
            (bytes memory onchain,,,,) = flipbook.frame(flipbook.frameCount() - 1);
            assertEq(onchain, refModel);
        }
    }

    function testGasTargetsAndSampleReel() public {
        bytes memory sixtyFour = hex"00001F0101001F01";
        vm.prank(alice);
        paint.paint(hex"00000004", new uint256[](0)); // unlock the 256-ink painter tier for the benchmark setup
        vm.roll(vm.getBlockNumber() + 1);
        uint256 before = gasleft();
        vm.prank(alice);
        flipbook.paint(sixtyFour);
        uint256 firstGas = before - gasleft();
        console.log("GAS flipbook first paint 64 px", firstGas);
        assertLt(firstGas, 175_000);

        before = gasleft();
        vm.prank(bob);
        flipbook.paint(hex"02000304");
        uint256 laterGas = before - gasleft();
        console.log("GAS flipbook later paint same block", laterGas);
        assertLt(laterGas, 175_000);

        while (flipbook.frameCount() < 32) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(alice);
            uint64 f = flipbook.frameCount();
            uint8 y = uint8(f % 32);
            uint8 x = uint8((f * 3) % 32);
            flipbook.paint(abi.encodePacked(y, x, x, uint8(2)));
        }

        before = gasleft();
        flipbook.recentFrames(32);
        uint256 recentGas = before - gasleft();
        console.log("GAS flipbook recentFrames(32)", recentGas);
        assertLt(recentGas, 330_000);

        before = gasleft();
        vm.prank(alice);
        uint256 id = flipbook.mintReel();
        uint256 mintGas = before - gasleft();
        console.log("GAS flipbook mintReel 32 frames", mintGas);
        assertLt(mintGas, 4_800_000);

        before = gasleft();
        string memory uri = labs.tokenURI(id);
        uint256 uriGas = before - gasleft();
        console.log("GAS Labs tokenURI reel", uriGas);
        console.log("BYTES flipbook tokenURI", bytes(uri).length);
        assertLt(uriGas, 9_000_000);
        bytes memory json = _decodeBase64DataUri(uri);
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".attributes[0].value"), "Reel");
        assertEq(vm.parseJsonUint(string(json), ".attributes[2].value"), 1);
        assertGt(bytes(vm.parseJsonString(string(json), ".attributes[9].value")).length, 0);
        assertEq(vm.parseJsonUint(string(json), ".attributes[10].value"), 32);
        vm.createDir("test-output", true);
        vm.writeFile("test-output/flipbook_reel.txt", uri);
    }

    function testWorstCaseReelTokenUriStaysUnderTwelveMillionAndUsesRealImage() public {
        for (uint256 i; i < 31; ++i) {
            vm.roll(vm.getBlockNumber() + flipbook.INK_WINDOW_BLOCKS() + 1);
            vm.coinbase(address(uint160(0x1000 + i)));
            uint8 colour = i % 2 == 0 ? 3 : 4;
            bytes memory runs = abi.encodePacked(
                uint8(0), uint8(0), uint8(31), colour,
                uint8(1), uint8(0), uint8(31), colour
            );
            vm.prank(alice);
            flipbook.paint(runs);
        }
        assertEq(flipbook.frameCount(), 32);

        uint256 before = gasleft();
        vm.prank(alice);
        uint256 id = flipbook.mintReel();
        uint256 mintGas = before - gasleft();
        console.log("GAS flipbook mintReel 32 frames worst case", mintGas);
        assertLt(mintGas, 4_800_000);

        before = gasleft();
        string memory uri = labs.tokenURI(id);
        uint256 uriGas = before - gasleft();
        console.log("GAS Labs tokenURI reel worst case", uriGas);
        assertLt(uriGas, 12_000_000);

        bytes memory json = _decodeBase64DataUri(uri);
        vm.parseJson(string(json));
        string memory image = vm.parseJsonString(string(json), ".image");
        assertGt(bytes(image).length, 10_000);
        assertEq(vm.parseJsonString(string(json), ".attributes[0].value"), "Reel");
        assertEq(vm.parseJsonUint(string(json), ".attributes[10].value"), 32);
    }

    function testGasWorstCasePaintAllWords() public {
        vm.prank(alice);
        paint.paint(hex"00000004", new uint256[](0));

        bytes memory runsA;
        bytes memory runsB;
        for (uint8 y; y < 32; ++y) {
            runsA = bytes.concat(runsA, abi.encodePacked(y, uint8(0), uint8(1), uint8(3)));
            runsB = bytes.concat(runsB, abi.encodePacked(y, uint8(0), uint8(1), uint8(4)));
        }

        vm.roll(vm.getBlockNumber() + 1);
        uint256 before = gasleft();
        vm.prank(alice);
        flipbook.paint(runsA);
        uint256 newFrameGas = before - gasleft();
        console.log("GAS flipbook worst-case new frame", newFrameGas);
        assertLt(newFrameGas, 240_000);

        before = gasleft();
        vm.prank(carol);
        flipbook.paint(runsB);
        uint256 sameFrameGas = before - gasleft();
        console.log("GAS flipbook worst-case same frame", sameFrameGas);
        assertLt(sameFrameGas, 240_000);
    }

    function _makeFrames(uint256 count, address painter) internal {
        for (uint256 i; i < count; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            uint64 f = flipbook.frameCount();
            uint8 y = uint8(f % 32);
            uint8 x = uint8((f * 5) % 32);
            uint8 color = uint8(2 + (f / 32) % 2);
            vm.prank(painter);
            flipbook.paint(abi.encodePacked(y, x, x, color));
        }
    }

    function _recent32()
        internal
        view
        returns (
            uint64 first,
            bytes memory pixels,
            uint48[] memory blocks,
            address[] memory proposers,
            uint16[] memory counts,
            uint8[] memory painters
        )
    {
        return flipbook.recentFrames(32);
    }

    function _genesis() internal view returns (bytes memory) {
        return vm.parseBytes(vm.trim(vm.readFile("script/flipbook-genesis.hex")));
    }

    function _frameHashAt(bytes memory packedFrames, uint256 frameIndex) internal pure returns (bytes32 hash) {
        bytes memory one = new bytes(512);
        uint256 srcOffset = frameIndex * 512;
        assembly ("memory-safe") {
            let src := add(add(packedFrames, 0x20), srcOffset)
            let dst := add(one, 0x20)
            for { let o := 0 } lt(o, 512) { o := add(o, 0x20) } {
                mstore(add(dst, o), mload(add(src, o)))
            }
        }
        hash = keccak256(one);
    }

    function _applyReference(bytes memory packed, bytes memory runs) internal pure returns (bytes memory out) {
        out = new bytes(packed.length);
        assembly ("memory-safe") {
            let src := add(packed, 0x20)
            let dst := add(out, 0x20)
            let length := mload(packed)
            for { let o := 0 } lt(o, length) { o := add(o, 0x20) } {
                mstore(add(dst, o), mload(add(src, o)))
            }
        }
        for (uint256 o; o < runs.length; o += 4) {
            uint8 y = uint8(runs[o]);
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            for (uint256 x = x0; x <= x1; ++x) {
                uint256 pixel = uint256(y) * 32 + x;
                uint256 bi = pixel >> 1;
                uint8 oldByte = uint8(out[bi]);
                if ((pixel & 1) == 0) out[bi] = bytes1((oldByte & 0x0F) | (color << 4));
                else out[bi] = bytes1((oldByte & 0xF0) | color);
            }
        }
    }


    function _decodeBase64DataUri(string memory uri) private pure returns (bytes memory out) {
        bytes memory src = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        uint256 len = src.length - prefix.length;
        uint256 padding = src[src.length - 1] == bytes1("=") ? 1 : 0;
        if (src[src.length - 2] == bytes1("=")) ++padding;
        out = new bytes((len / 4) * 3 - padding);
        uint256 j;
        for (uint256 i = prefix.length; i < src.length; i += 4) {
            uint256 n = (uint256(_b64(src[i])) << 18) | (uint256(_b64(src[i + 1])) << 12)
                | (uint256(_b64(src[i + 2])) << 6) | uint256(_b64(src[i + 3]));
            if (j < out.length) out[j++] = bytes1(uint8(n >> 16));
            if (j < out.length) out[j++] = bytes1(uint8(n >> 8));
            if (j < out.length) out[j++] = bytes1(uint8(n));
        }
    }

    function _b64(bytes1 c) private pure returns (uint8) {
        uint8 v = uint8(c);
        if (v >= 65 && v <= 90) return v - 65;
        if (v >= 97 && v <= 122) return v - 71;
        if (v >= 48 && v <= 57) return v + 4;
        if (v == 43) return 62;
        if (v == 47) return 63;
        return 0;
    }

    function _referencePixel(bytes memory packed, uint8 x, uint8 y) internal pure returns (uint8) {
        uint256 pixel = uint256(y) * 32 + x;
        uint8 value = uint8(packed[pixel >> 1]);
        return (pixel & 1) == 0 ? value >> 4 : value & 0x0F;
    }

    function _startSession(address key, uint256 blocks_, uint256 maxUnits) internal {
        uint256 expiry = vm.getBlockNumber() + blocks_;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        uint256 nonce = paint.sessionNonces(alice);
        bytes32 typehash = paint.SESSION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(typehash, alice, key, expiry, maxUnits, nonce, deadline));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("r3OS paint")), keccak256(bytes("2")), block.chainid, address(paint)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(alicePk, digest);
        vm.prank(key);
        paint.startSession(alice, key, expiry, maxUnits, nonce, deadline, abi.encodePacked(rr, ss, v));
    }
}
