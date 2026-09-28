// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console} from "forge-std/console.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract CollabSeasonsTest is Test {
    R3tardsPaint p;
    MockR3tards r;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint64 start;

    bytes32 constant PAINTED_SIG = keccak256("Painted(uint256,address,address,bytes,bytes,uint32,uint16)");

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        start = uint64(vm.getBlockTimestamp());
        p = new R3tardsPaint(address(r), start, alice, alice, 50_000, 0, 50_000, 16, 256);
    }

    function testDefaultOutlineUsedWhenUnset() public view {
        assertFalse(p.hasCustomOutline(0));
        assertGt(p.seasonOutlineRuns(0).length, 0);
        assertEq(p.pixelAt(0, 112, 90), 1);
        assertEq(p.outlineBaseSlot(0), p.OUTLINE_BASE_SLOT());
        assertEq(p.customOutlineBaseSlot(1) % 128, 0);
    }

    function testEmptyCustomOutlineMeansNoCharacter() public {
        vm.prank(alice);
        p.setSeasonOutline(1, bytes(""), "");
        assertTrue(p.hasCustomOutline(1));
        assertEq(p.seasonOutlineRuns(1).length, 0);
        assertTrue(p.outlineBaseSlot(1) != p.OUTLINE_BASE_SLOT());

        vm.warp(uint256(start) + p.SEASON_LENGTH());
        assertEq(p.pixelAt(1, 112, 90), 0);
    }

    function testChunkedAppendEqualsSingleSet() public {
        bytes memory first = hex"000003";
        bytes memory second = hex"000407";
        bytes memory combined = bytes.concat(first, second);

        vm.startPrank(alice);
        p.setSeasonOutline(1, first, "guest one");
        p.appendSeasonOutline(1, second);
        p.setSeasonOutline(2, combined, "guest two");
        vm.stopPrank();

        assertEq(keccak256(p.seasonOutlineRuns(1)), keccak256(combined));
        assertEq(keccak256(p.seasonOutlineRuns(2)), keccak256(combined));
        for (uint256 x; x < 8; ++x) {
            assertEq(p.pixelAt(1, x, 0), 1);
            assertEq(p.pixelAt(2, x, 0), 1);
        }
    }

    function testSetReplacesEarlierFutureOutlineInsteadOfOnlyOring() public {
        vm.startPrank(alice);
        p.setSeasonOutline(1, hex"000003", "first");
        p.setSeasonOutline(1, hex"000407", "second");
        vm.stopPrank();

        for (uint256 x; x < 4; ++x) assertEq(p.pixelAt(1, x, 0), 0);
        for (uint256 x = 4; x < 8; ++x) assertEq(p.pixelAt(1, x, 0), 1);
        assertEq(p.seasonGuest(1), "second");
    }

    function testClearFutureOutlineRevertsToDefault() public {
        vm.startPrank(alice);
        p.setSeasonOutline(1, hex"000003", "temporary");
        p.clearSeasonOutline(1);
        vm.stopPrank();

        assertFalse(p.hasCustomOutline(1));
        assertEq(keccak256(p.seasonOutlineRuns(1)), keccak256(p.seasonOutlineRuns(0)));
        assertEq(p.pixelAt(1, 112, 90), 1);
        assertEq(p.outlineBaseSlot(1), p.OUTLINE_BASE_SLOT());
    }

    function testCannotSetAppendOrClearCurrentPastOrStartedSeason() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.SeasonOutlineLocked.selector, 0));
        p.setSeasonOutline(0, hex"000003", "nope");

        vm.prank(alice);
        p.setSeasonOutline(1, hex"000003", "future");

        vm.warp(uint256(start) + p.SEASON_LENGTH());

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.SeasonOutlineLocked.selector, 1));
        p.setSeasonOutline(1, hex"000407", "late");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.SeasonOutlineLocked.selector, 1));
        p.appendSeasonOutline(1, hex"000407");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.SeasonOutlineLocked.selector, 1));
        p.clearSeasonOutline(1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.SeasonOutlineLocked.selector, 0));
        p.setSeasonOutline(0, hex"000003", "past");
    }

    function testNonOwnerCannotManageFutureOutlines() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bob));
        p.setSeasonOutline(1, hex"000003", "guest");

        vm.prank(alice);
        p.setSeasonOutline(1, hex"000003", "guest");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bob));
        p.appendSeasonOutline(1, hex"000407");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bob));
        p.clearSeasonOutline(1);
    }

    function testOutlineSkipAndFaceToggleFollowSeasonOutline() public {
        vm.prank(alice);
        p.setSeasonOutline(1, hex"000003", "tiny guest"); // y0 x0..3
        vm.warp(uint256(start) + p.SEASON_LENGTH());

        vm.prank(alice);
        p.paint(hex"00000704", new uint256[](0));
        for (uint256 x; x < 4; ++x) assertEq(p.backgroundPixelAt(1, x, 0), 0);
        for (uint256 x = 4; x < 8; ++x) assertEq(p.backgroundPixelAt(1, x, 0), 4);

        vm.prank(alice);
        p.setFace(7, new uint256[](0));
        for (uint256 x; x < 4; ++x) assertEq(p.pixelAt(1, x, 0), 7);
    }

    function testFramesFromDifferentSeasonsRenderTheirOwnOutlines() public {
        vm.prank(alice);
        p.setSeasonOutline(1, hex"000000", "pixel guest"); // y0 x0 only

        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        vm.prank(alice);
        uint256 season0Frame = p.mintFrame();

        vm.roll(vm.getBlockNumber() + p.FRAME_COOLDOWN_BLOCKS() + 1);
        vm.warp(uint256(start) + p.SEASON_LENGTH());
        vm.prank(alice);
        p.paint(hex"00010104", new uint256[](0));
        vm.prank(alice);
        uint256 season1Frame = p.mintFrame();

        bytes memory bmp0 = p.renderBMP(season0Frame);
        bytes memory bmp1 = p.renderBMP(season1Frame);
        assertEq(_bmpPixel(bmp0, 112, 90), 1); // default r3tard exists in season 0
        assertEq(_bmpPixel(bmp1, 112, 90), 0); // not part of season 1 guest
        assertEq(_bmpPixel(bmp1, 0, 0), 1);    // season 1 guest pixel

        bytes memory genesis1 = p.genesisFrameData(1);
        assertEq(_packedBottomUpPixel(genesis1, 0, 0), 1);
        assertEq(_packedBottomUpPixel(genesis1, 112, 90), 0);
    }

    function testReplayIsBitExactAcrossSeasonsWithDifferentOutlines() public {
        vm.prank(alice);
        p.setSeasonOutline(1, hex"000001", "two pixels"); // y0 x0..1

        vm.recordLogs();
        vm.prank(alice);
        p.paint(hex"00000304", new uint256[](0));

        vm.warp(uint256(start) + p.SEASON_LENGTH());
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        p.paint(hex"00000305", new uint256[](0));

        bytes memory model0 = new bytes(32_768);
        bytes memory model1 = new bytes(32_768);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.emitter != address(p) || log.topics.length == 0 || log.topics[0] != PAINTED_SIG) continue;
            uint256 season = uint256(log.topics[1]);
            (bytes memory runs, bytes memory corruptions,,) = abi.decode(log.data, (bytes, bytes, uint32, uint16));
            bytes memory outline = p.seasonOutlineRuns(season);
            bytes memory model = season == 0 ? model0 : model1;
            _applyRuns(model, runs, outline);
            _applyCorruptions(model, corruptions);
        }

        assertEq(model0, p.getBackgroundCanvas(0));
        assertEq(model1, p.getBackgroundCanvas(1));
    }

    function testMetadataHasGuestTraitAndEscapesJsonForLiveAndFrame() public {
        vm.prank(alice);
        p.setSeasonOutline(1, hex"000000", 'Guest "A"');
        vm.warp(uint256(start) + p.SEASON_LENGTH());

        bytes memory liveJson = _decodeDataUri(p.tokenURI(0));
        assertTrue(_contains(liveJson, bytes('"trait_type":"Guest"')));
        assertTrue(_contains(liveJson, bytes('"value":"Guest \\"A\\""')));

        vm.prank(alice);
        p.paint(hex"00010104", new uint256[](0));
        vm.prank(alice);
        uint256 id = p.mintFrame();
        bytes memory frameJson = _decodeDataUri(p.tokenURI(id));
        assertTrue(_contains(frameJson, bytes('"trait_type":"Guest"')));
        assertTrue(_contains(frameJson, bytes('"value":"Guest \\"A\\""')));
    }

    function testDefaultMetadataHasR3tardCharacterTrait() public view {
        bytes memory json = _decodeDataUri(p.tokenURI(0));
        assertTrue(_contains(json, bytes('"trait_type":"Character","value":"r3tard"')));
    }

    function testOutlineRunValidation() public {
        vm.prank(alice);
        vm.expectRevert(R3tardsPaint.InvalidOutlineRunsLength.selector);
        p.setSeasonOutline(1, hex"0000", "bad");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.InvalidOutlineRun.selector, 0, 0, 8, 7));
        p.setSeasonOutline(1, hex"000807", "bad");
    }

    function testGuestValidation() public {
        string memory longName = "123456789012345678901234567890123";
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.GuestNameTooLong.selector, 33));
        p.setSeasonOutline(1, hex"000000", longName);

        bytes memory bad = hex"676f6f640a626164"; // good\nbad
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.InvalidGuestCharacter.selector, 4, uint8(0x0a)));
        p.setSeasonOutline(1, hex"000000", string(bad));
    }

    function testGasSetTypicalAndWorstCaseOutline() public {
        bytes memory typical = p.seasonOutlineRuns(0);
        uint256 g = gasleft();
        vm.prank(alice);
        p.setSeasonOutline(1, typical, "typical guest");
        uint256 typicalGas = g - gasleft();
        console.log("GAS setSeasonOutline typical", typicalGas);
        assertLt(typicalGas, 30_000_000);

        bytes memory worst = new bytes(256 * 3);
        for (uint256 y; y < 256; ++y) {
            uint256 o = y * 3;
            worst[o] = bytes1(uint8(y));
            worst[o + 1] = 0x00;
            worst[o + 2] = 0xff;
        }
        g = gasleft();
        vm.prank(alice);
        p.setSeasonOutline(2, worst, "full mask");
        uint256 worstGas = g - gasleft();
        console.log("GAS setSeasonOutline worst-case full mask", worstGas);
        assertLt(worstGas, 30_000_000);
    }

    function _bmpPixel(bytes memory bmp, uint256 x, uint256 y) internal pure returns (uint8) {
        uint256 row = 255 - y;
        uint8 packed = uint8(bmp[118 + row * 128 + x / 2]);
        return x % 2 == 0 ? packed >> 4 : packed & 0x0f;
    }

    function _packedBottomUpPixel(bytes memory data, uint256 x, uint256 y) internal pure returns (uint8) {
        uint256 row = 255 - y;
        uint8 packed = uint8(data[row * 128 + x / 2]);
        return x % 2 == 0 ? packed >> 4 : packed & 0x0f;
    }

    function _applyRuns(bytes memory model, bytes memory runs, bytes memory outline) internal pure {
        for (uint256 o; o < runs.length; o += 4) {
            uint8 y = uint8(runs[o]);
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            for (uint256 x = x0; x <= x1; ++x) {
                if (!_isOutline(outline, uint8(x), y)) _set(model, uint8(x), y, color);
            }
        }
    }

    function _applyCorruptions(bytes memory model, bytes memory corruptions) internal pure {
        for (uint256 o; o < corruptions.length; o += 3) {
            _set(model, uint8(corruptions[o]), uint8(corruptions[o + 1]), uint8(corruptions[o + 2]));
        }
    }

    function _isOutline(bytes memory outline, uint8 x, uint8 y) internal pure returns (bool) {
        for (uint256 o; o < outline.length; o += 3) {
            if (uint8(outline[o]) != y) continue;
            uint8 x0 = uint8(outline[o + 1]);
            uint8 x1 = uint8(outline[o + 2]);
            if (x >= x0 && x <= x1) return true;
        }
        return false;
    }

    function _set(bytes memory model, uint8 x, uint8 y, uint8 color) internal pure {
        uint256 bi = uint256(y) * 128 + uint256(x) / 2;
        uint8 old = uint8(model[bi]);
        model[bi] = x % 2 == 0
            ? bytes1((color << 4) | (old & 0x0f))
            : bytes1((old & 0xf0) | color);
    }

    function _decodeDataUri(string memory uri) internal pure returns (bytes memory out) {
        bytes memory src = bytes(uri);
        uint256 comma;
        while (comma < src.length && src[comma] != 0x2c) ++comma;
        require(comma < src.length, "no comma");
        uint256 startAt = comma + 1;
        uint256 n = src.length - startAt;
        require(n % 4 == 0, "bad base64");

        uint256 outLen = (n / 4) * 3;
        if (n != 0 && src[src.length - 1] == 0x3d) --outLen;
        if (n > 1 && src[src.length - 2] == 0x3d) --outLen;
        out = new bytes(outLen);

        uint256 j;
        for (uint256 i; i < n; i += 4) {
            uint256 a = _b64(uint8(src[startAt + i]));
            uint256 b = _b64(uint8(src[startAt + i + 1]));
            uint256 c = src[startAt + i + 2] == 0x3d ? 0 : _b64(uint8(src[startAt + i + 2]));
            uint256 d = src[startAt + i + 3] == 0x3d ? 0 : _b64(uint8(src[startAt + i + 3]));
            uint256 v = (a << 18) | (b << 12) | (c << 6) | d;
            if (j < outLen) out[j++] = bytes1(uint8(v >> 16));
            if (j < outLen) out[j++] = bytes1(uint8(v >> 8));
            if (j < outLen) out[j++] = bytes1(uint8(v));
        }
    }

    function _b64(uint8 c) internal pure returns (uint8) {
        if (c >= 0x41 && c <= 0x5a) return c - 0x41;
        if (c >= 0x61 && c <= 0x7a) return c - 0x61 + 26;
        if (c >= 0x30 && c <= 0x39) return c - 0x30 + 52;
        if (c == 0x2b) return 62;
        if (c == 0x2f) return 63;
        revert("bad b64");
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) return false;
        for (uint256 i; i <= haystack.length - needle.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}
