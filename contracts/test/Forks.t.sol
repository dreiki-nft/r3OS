// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {R3OSForks} from "../src/labs/R3OSForks.sol";
import {Source64} from "../src/lib/Source64.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract ForksTest is Test {
    R3OSPaint paint;
    R3OSForks forks;
    R3OSLabs labs;
    MockR3tards r3tards;

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob;
    address carol;
    address royalty;
    uint256 frameId;

    function setUp() public {
        vm.roll(1_000_700);
        alice = vm.addr(alicePk);
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        royalty = makeAddr("royalty");
        r3tards = new MockR3tards();
        paint = new R3OSPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, royalty, 512, 0, 512, 16, 256
        );
        labs = new R3OSLabs(address(paint), royalty);
        forks = new R3OSForks(address(paint), address(labs), uint64(vm.getBlockTimestamp()));
        vm.prank(alice);
        uint256 experimentId = paint.addExperiment(address(forks), "forks", "");
        forks.bindExperimentId(experimentId);
        frameId = _makeFrame(alice);
    }

    function testForkFrameSeedsFromSource64WithGuestAndWhiteFace() public {
        bytes memory guestRuns = hex"3c202f3d202f3e202f3f202f";
        vm.prank(alice);
        paint.setSeasonOutline(1, guestRuns, "guest");
        vm.warp(paint.seasonStartTime(1));
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        paint.setFace(7, new uint256[](0));
        vm.roll(vm.getBlockNumber() + 200);
        vm.prank(alice);
        paint.paint(hex"c8c8d704", new uint256[](0));
        vm.prank(alice);
        uint256 guestFrame = paint.mintFrame();

        uint256 expectedBlock = vm.getBlockNumber();
        vm.prank(alice);
        uint256 forkId = forks.forkFrame(guestFrame);
        uint256[64] memory expectedRows = Source64.rows(
            paint.frameData(guestFrame), paint.genesisFrameData(1), 7
        );
        uint256[64] memory actualRows = forks.forkRows(forkId);
        for (uint256 y; y < 64; ++y) assertEq(actualRows[y], expectedRows[y]);

        R3OSForks.ForkInfo memory info = forks.forkInfo(forkId);
        assertEq(info.sourceFrameId, guestFrame);
        assertEq(info.parentForkId, 0);
        assertEq(info.depth, 0);
        assertEq(info.season, 1);
        assertEq(info.background, 0);
        assertEq(info.face, 7);
        assertEq(info.createdBlock, expectedBlock);
        assertTrue(info.isOpen);
        assertFalse(info.isSealed);
    }

    function testCreationReverts() public {
        vm.expectRevert();
        vm.prank(alice);
        forks.forkFrame(0);
        vm.expectRevert();
        vm.prank(alice);
        forks.forkFrame(type(uint128).max);

        vm.expectRevert(R3OSForks.NotPainter.selector);
        vm.prank(bob);
        forks.forkFrame(frameId);

        address key = makeAddr("session-key");
        _startSession(key, 100, 512);
        vm.expectRevert(R3OSForks.SessionKeyCannotFork.selector);
        vm.prank(key);
        forks.forkFrame(frameId);

        R3OSForks futureForks = new R3OSForks(address(paint), address(labs), uint64(vm.getBlockTimestamp() + 100));
        vm.expectRevert(R3OSForks.NotOpenYet.selector);
        vm.prank(alice);
        futureForks.forkFrame(frameId);
    }

    function testForkCooldownBoundary() public {
        vm.prank(alice);
        forks.forkFrame(frameId);
        uint256 first = vm.getBlockNumber();
        vm.roll(first + 599);
        vm.expectRevert(abi.encodeWithSelector(R3OSForks.ForkCooldown.selector, first + 600));
        vm.prank(alice);
        forks.forkFrame(frameId);
        vm.roll(first + 600);
        vm.prank(alice);
        uint256 second = forks.forkFrame(frameId);
        assertEq(second, 2);
    }

    function testForkForkCopiesCurrentRowsAndWorksWhenParentClosedOrSealed() public {
        vm.prank(alice);
        uint256 parent = forks.forkFrame(frameId);
        vm.prank(bob);
        forks.paint(parent, hex"00003f04");
        uint256[64] memory paintedRows = forks.forkRows(parent);

        vm.prank(alice);
        forks.setOpen(parent, false);
        vm.roll(vm.getBlockNumber() + 600);
        vm.prank(alice);
        uint256 childClosed = forks.forkFork(parent);
        _assertRowsEqual(forks.forkRows(childClosed), paintedRows);
        R3OSForks.ForkInfo memory closedInfo = forks.forkInfo(childClosed);
        assertEq(closedInfo.parentForkId, parent);
        assertEq(closedInfo.sourceFrameId, frameId);
        assertEq(closedInfo.depth, 1);

        vm.prank(alice);
        forks.seal(parent);
        vm.roll(vm.getBlockNumber() + 600);
        vm.prank(alice);
        uint256 childSealed = forks.forkFork(parent);
        _assertRowsEqual(forks.forkRows(childSealed), paintedRows);

        vm.expectRevert(abi.encodeWithSelector(R3OSForks.NoFork.selector, 999));
        vm.prank(alice);
        forks.forkFork(999);
    }

    function testPaintValidationAndNoChange() public {
        uint256 forkId = _forkAsAlice();
        bytes[] memory bad = new bytes[](7);
        bad[0] = hex"";
        bad[1] = hex"00";
        bad[2] = hex"40000001";
        bad[3] = hex"00050401";
        bad[4] = hex"00004001";
        bad[5] = hex"00000010";
        bad[6] = hex"0100010100000102"; // decreasing row: y=1 then y=0
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(R3OSForks.InvalidRuns.selector);
            vm.prank(bob);
            forks.paint(forkId, bad[i]);
        }

        bytes memory tooMany = abi.encodePacked(hex"00003f01", hex"01000001");
        vm.expectRevert(abi.encodeWithSelector(R3OSForks.TooManyPixels.selector, 65));
        vm.prank(bob);
        forks.paint(forkId, tooMany);

        uint256[64] memory rows = forks.forkRows(forkId);
        uint8 existing = uint8(rows[0] >> 252);
        bytes memory same = abi.encodePacked(bytes1(0), bytes1(0), bytes1(0), bytes1(existing));
        vm.expectRevert(R3OSForks.NoChange.selector);
        vm.prank(bob);
        forks.paint(forkId, same);
    }

    function testTwoRunsThatRestoreOriginalRevertWithoutAccounting() public {
        uint256 forkId = _forkAsAlice();
        R3OSForks.ForkInfo memory beforeInfo = forks.forkInfo(forkId);
        (uint32 beforeForksPainted,) = forks.painterInfo(bob);
        uint256[64] memory rows = forks.forkRows(forkId);
        uint8 original = uint8(rows[0] >> 252);
        uint8 temporary = original == 15 ? 14 : original + 1;
        bytes memory runs = abi.encodePacked(
            bytes1(uint8(0)), bytes1(uint8(0)), bytes1(uint8(0)), bytes1(temporary),
            bytes1(uint8(0)), bytes1(uint8(0)), bytes1(uint8(0)), bytes1(original)
        );
        vm.expectRevert(R3OSForks.NoChange.selector);
        vm.prank(bob);
        forks.paint(forkId, runs);
        R3OSForks.ForkInfo memory afterInfo = forks.forkInfo(forkId);
        (uint32 afterForksPainted,) = forks.painterInfo(bob);
        assertEq(afterInfo.paints, beforeInfo.paints);
        assertEq(afterInfo.painters, beforeInfo.painters);
        assertEq(afterForksPainted, beforeForksPainted);
    }

    function testSameRowOverlapsApplyInOrder() public {
        uint256 forkId = _forkAsAlice();
        bytes memory runs = abi.encodePacked(
            bytes1(uint8(10)), bytes1(uint8(0)), bytes1(uint8(3)), bytes1(uint8(2)),
            bytes1(uint8(10)), bytes1(uint8(2)), bytes1(uint8(5)), bytes1(uint8(3))
        );
        vm.prank(bob);
        forks.paint(forkId, runs);
        uint256 row = forks.forkRows(forkId)[10];
        assertEq(uint8(row >> 252), 2);
        assertEq(uint8((row >> 248) & 0xF), 2);
        assertEq(uint8((row >> 244) & 0xF), 3);
        assertEq(uint8((row >> 240) & 0xF), 3);
        assertEq(uint8((row >> 236) & 0xF), 3);
        assertEq(uint8((row >> 232) & 0xF), 3);
    }

    function testPaintLimitsAndBlockBudget() public {
        uint256 forkId = _forkAsAlice();
        vm.prank(bob);
        forks.paint(forkId, hex"00003f02");
        vm.expectRevert(abi.encodeWithSelector(R3OSForks.AlreadyPaintedThisBlock.selector, forkId));
        vm.prank(bob);
        forks.paint(forkId, hex"01013f03");

        vm.roll(vm.getBlockNumber() + 1);
        address[5] memory painters = [makeAddr("p0"), makeAddr("p1"), makeAddr("p2"), makeAddr("p3"), makeAddr("p4")];
        for (uint256 i; i < 4; ++i) {
            vm.prank(painters[i]);
            forks.paint(forkId, abi.encodePacked(bytes1(uint8(i + 1)), bytes1(0), bytes1(uint8(63)), bytes1(uint8(i + 3))));
        }
        vm.expectRevert(abi.encodeWithSelector(R3OSForks.ForkBlockFull.selector, 256));
        vm.prank(painters[4]);
        forks.paint(forkId, hex"05053f09");

        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(painters[4]);
        forks.paint(forkId, hex"05053f09");
    }

    function testSameOwnerMayPaintTwoForksInOneBlock() public {
        uint256 first = _forkAsAlice();
        vm.roll(vm.getBlockNumber() + 600);
        vm.prank(alice);
        uint256 second = forks.forkFrame(frameId);
        vm.prank(bob);
        forks.paint(first, hex"00000304");
        vm.prank(bob);
        forks.paint(second, hex"00000304");
    }

    function testClosedForkOwnerAndSessionCanPaintOthersCannot() public {
        uint256 forkId = _forkAsAlice();
        vm.prank(alice);
        forks.setOpen(forkId, false);
        vm.expectRevert(abi.encodeWithSelector(R3OSForks.ForkClosed.selector, forkId));
        vm.prank(bob);
        forks.paint(forkId, hex"00000304");

        vm.prank(alice);
        forks.paint(forkId, hex"00000304");
        vm.roll(vm.getBlockNumber() + 1);
        address key = makeAddr("closed-session");
        _startSession(key, 100, 512);
        vm.prank(key);
        forks.paint(forkId, hex"01010305");
    }

    function testSealingTransferAndDirectOwnerControls() public {
        uint256 forkId = _forkAsAlice();
        vm.prank(alice);
        labs.transferFrom(alice, bob, forkId);

        vm.expectRevert(abi.encodeWithSelector(R3OSForks.NotForkOwner.selector, forkId));
        vm.prank(alice);
        forks.setOpen(forkId, false);
        vm.prank(bob);
        forks.setOpen(forkId, false);
        vm.prank(bob);
        forks.seal(forkId);

        bytes memory sealedRevert = abi.encodeWithSelector(R3OSForks.SealedFork.selector, forkId);
        vm.expectRevert(sealedRevert);
        vm.prank(bob);
        forks.setOpen(forkId, true);
        vm.expectRevert(sealedRevert);
        vm.prank(bob);
        forks.seal(forkId);
        vm.expectRevert(sealedRevert);
        vm.prank(bob);
        forks.paint(forkId, hex"00000304");
    }

    function testFirstPaintAccountingAndStamp() public {
        uint256[3] memory ids;
        for (uint256 i; i < 3; ++i) {
            if (i != 0) vm.roll(vm.getBlockNumber() + 600);
            vm.prank(alice);
            ids[i] = forks.forkFrame(frameId);
        }
        for (uint256 i; i < 3; ++i) {
            vm.prank(bob);
            forks.paint(ids[i], abi.encodePacked(bytes1(uint8(i)), bytes1(0), bytes1(uint8(3)), bytes1(uint8(i + 2))));
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(bob);
            forks.paint(ids[i], abi.encodePacked(bytes1(uint8(i + 10)), bytes1(0), bytes1(uint8(3)), bytes1(uint8(i + 5))));
        }
        (uint32 forksPainted,) = forks.painterInfo(bob);
        assertEq(forksPainted, 3);
        for (uint256 i; i < 3; ++i) assertEq(forks.forkInfo(ids[i]).painters, 1);
        (string memory name, bool earned) = forks.stamp(bob);
        assertEq(name, "FORKER");
        assertTrue(earned);
    }

    function testRawStorageAndDifferentForkWrites() public {
        uint256 first = _forkAsAlice();
        uint256 base = forks.forkBase(first);
        bytes32 rawWhite = vm.load(address(forks), bytes32(base));
        assertEq(rawWhite, bytes32(uint256(0x5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A)));
        assertTrue(vm.load(address(forks), bytes32(base + 65)) != bytes32(0));

        vm.roll(vm.getBlockNumber() + 600);
        vm.prank(alice);
        uint256 second = forks.forkFrame(frameId);
        vm.record();
        vm.prank(bob);
        forks.paint(first, hex"00000304");
        (, bytes32[] memory writesA) = vm.accesses(address(forks));
        vm.record();
        vm.prank(carol);
        forks.paint(second, hex"01010305");
        (, bytes32[] memory writesB) = vm.accesses(address(forks));
        for (uint256 i; i < writesA.length; ++i) {
            for (uint256 j; j < writesB.length; ++j) assertTrue(writesA[i] != writesB[j]);
        }
        _assertPageWrites(writesA, first);
        _assertPageWrites(writesB, second);
    }

    function testLiveForkTraitsUpdateAfterForkAndSeal() public {
        uint256 parent = _forkAsAlice();
        bytes memory beforeJson = _decodeBase64DataUri(labs.tokenURI(parent));
        assertEq(vm.parseJsonUint(string(beforeJson), ".attributes[21].value"), 0);
        assertEq(vm.parseJsonString(string(beforeJson), ".attributes[22].value"), "no");

        vm.roll(vm.getBlockNumber() + 600);
        vm.prank(alice);
        uint256 child = forks.forkFork(parent);
        bytes memory childJson = _decodeBase64DataUri(labs.tokenURI(child));
        assertEq(vm.parseJsonString(string(childJson), ".attributes[12].value"), "Remix");
        bytes memory forkedJson = _decodeBase64DataUri(labs.tokenURI(parent));
        assertEq(vm.parseJsonUint(string(forkedJson), ".attributes[21].value"), 1);
        assertEq(vm.parseJsonString(string(forkedJson), ".attributes[22].value"), "yes");

        vm.prank(alice);
        forks.seal(parent);
        bytes memory sealedJson = _decodeBase64DataUri(labs.tokenURI(parent));
        vm.parseJson(string(sealedJson));
        assertEq(vm.parseJsonString(string(sealedJson), ".attributes[10].value"), "Sealed");
        assertEq(vm.parseJsonUint(string(sealedJson), ".attributes[24].value"), vm.getBlockNumber());
    }

    function testBmpTokenUriRoyaltyInterfacesAndGas() public {
        uint256 gasBefore = gasleft();
        vm.prank(alice);
        uint256 forkId = forks.forkFrame(frameId);
        uint256 forkFrameGas = gasBefore - gasleft();
        console.log("GAS Forks forkFrame", forkFrameGas);
        assertLt(forkFrameGas, 2_300_000);

        bytes memory bmp = forks.forkBMP(forkId);
        assertEq(bmp.length, 2_166);
        assertEq(uint8(bmp[0]), 0x42);
        assertEq(uint8(bmp[1]), 0x4d);
        R3OSForks.ForkInfo memory info = forks.forkInfo(forkId);
        uint24[16] memory pal = paint.palette();
        uint24 bg = pal[info.background];
        assertEq(uint8(bmp[54]), uint8(bg));
        assertEq(uint8(bmp[55]), uint8(bg >> 8));
        assertEq(uint8(bmp[56]), uint8(bg >> 16));
        uint256[64] memory rows = forks.forkRows(forkId);
        assertEq(_wordAt(bmp, 118), rows[63]);
        assertEq(_wordAt(bmp, 118 + 63 * 32), rows[0]);

        gasBefore = gasleft();
        string memory uri = labs.tokenURI(forkId);
        uint256 uriGas = gasBefore - gasleft();
        console.log("GAS Labs tokenURI fork", uriGas);
        assertLt(uriGas, 1_500_000);
        bytes memory json = _decodeBase64DataUri(uri);
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".attributes[0].value"), "Fork");
        assertEq(vm.parseJsonUint(string(json), ".attributes[2].value"), 1);
        assertGt(bytes(vm.parseJsonString(string(json), ".attributes[9].value")).length, 0);
        assertEq(vm.parseJsonString(string(json), ".attributes[10].value"), "Open");
        assertEq(vm.parseJsonString(string(json), ".attributes[12].value"), "Original");

        (address receiver, uint256 royaltyAmount) = labs.royaltyInfo(forkId, 10_000);
        assertEq(receiver, royalty);
        assertEq(royaltyAmount, 500);
        assertTrue(labs.supportsInterface(0x80ac58cd));
        assertTrue(labs.supportsInterface(0x2a55205a));
        assertTrue(labs.supportsInterface(0x49064906));

        vm.roll(vm.getBlockNumber() + 600);
        gasBefore = gasleft();
        vm.prank(alice);
        uint256 child = forks.forkFork(forkId);
        uint256 forkForkGas = gasBefore - gasleft();
        console.log("GAS Forks forkFork", forkForkGas);
        assertLt(forkForkGas, 1_600_000);
        assertEq(labs.ownerOf(child), alice);

        vm.roll(vm.getBlockNumber() + 1);
        gasBefore = gasleft();
        vm.prank(bob);
        forks.paint(forkId, hex"00003f04");
        uint256 rowPaintGas = gasBefore - gasleft();
        console.log("GAS Forks paint 64 px one row", rowPaintGas);
        assertLt(rowPaintGas, 250_000);

        vm.roll(vm.getBlockNumber() + 1);
        bytes memory spread = new bytes(32 * 4);
        for (uint256 i; i < 32; ++i) {
            spread[i * 4] = bytes1(uint8(i));
            spread[i * 4 + 1] = 0;
            spread[i * 4 + 2] = bytes1(uint8(1));
            spread[i * 4 + 3] = bytes1(uint8((i % 14) + 1));
        }
        gasBefore = gasleft();
        vm.prank(carol);
        forks.paint(forkId, spread);
        uint256 spreadGas = gasBefore - gasleft();
        console.log("GAS Forks paint 64 px 32 rows", spreadGas);
        assertLt(spreadGas, 250_000);

        // Worst real path: first Forks paint by a resolved owner through an active session key, across 32 rows.
        vm.roll(vm.getBlockNumber() + 1);
        address gasKey = makeAddr("fork-gas-session");
        _startSession(gasKey, 100, 512);
        bytes memory sessionSpread = new bytes(32 * 4);
        for (uint256 i; i < 32; ++i) {
            sessionSpread[i * 4] = bytes1(uint8(i + 32));
            sessionSpread[i * 4 + 1] = bytes1(uint8(0));
            sessionSpread[i * 4 + 2] = bytes1(uint8(1));
            sessionSpread[i * 4 + 3] = bytes1(uint8(15));
        }
        gasBefore = gasleft();
        vm.prank(gasKey);
        forks.paint(forkId, sessionSpread);
        uint256 sessionSpreadGas = gasBefore - gasleft();
        console.log("GAS Forks paint session first-paint 64 px 32 rows", sessionSpreadGas);
        assertLt(sessionSpreadGas, 250_000);

        gasBefore = gasleft();
        forks.stamp(bob);
        uint256 stampGas = gasBefore - gasleft();
        console.log("GAS Forks stamp", stampGas);
        assertLt(stampGas, 25_000);
    }

    function _makeFrame(address painter) internal returns (uint256 id) {
        vm.prank(painter);
        paint.paint(hex"c8c8d704", new uint256[](0));
        vm.prank(painter);
        id = paint.mintFrame();
    }

    function _forkAsAlice() internal returns (uint256 forkId) {
        vm.prank(alice);
        forkId = forks.forkFrame(frameId);
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
                keccak256(bytes("r3OS paint")),
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

    function _assertRowsEqual(uint256[64] memory a, uint256[64] memory b) private pure {
        for (uint256 i; i < 64; ++i) assertEq(a[i], b[i]);
    }

    function _assertPageWrites(bytes32[] memory writes, uint256 forkId) private view {
        uint256 base = forks.forkBase(forkId);
        uint256 outside;
        for (uint256 i; i < writes.length; ++i) {
            uint256 slot = uint256(writes[i]);
            if (slot >= base && slot < base + 128) assertLe(slot, base + 65);
            else ++outside;
        }
        assertLe(outside, 2);
    }

    function _wordAt(bytes memory data, uint256 offset) private pure returns (uint256 value) {
        assembly ("memory-safe") { value := mload(add(add(data, 0x20), offset)) }
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

    function _contains(bytes memory haystack, bytes memory needle) private pure returns (bool) {
        for (uint256 i; needle.length != 0 && i + needle.length <= haystack.length; ++i) {
            bool found = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) { found = false; break; }
            }
            if (found) return true;
        }
        return false;
    }
}
