// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsPainterPass} from "../src/R3tardsPainterPass.sol";
import {IStampSource} from "../src/interfaces/IStampSource.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract EarnedStamp is IStampSource {
    function stamp(address) external pure returns (string memory name, bool earned) {
        return ("GARDENER", true);
    }
}

contract RevertingStamp is IStampSource {
    function stamp(address) external pure returns (string memory, bool) {
        revert("no stamp");
    }
}

contract PainterPassTest is Test {
    R3tardsPaint paint;
    R3tardsPainterPass pass;
    MockR3tards r;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        paint = new R3tardsPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 512, 0, 512, 16, 256
        );
        pass = new R3tardsPainterPass(address(paint));
    }

    function testPainterPassCoreBindingIsImmutable() public view {
        assertEq(address(pass.PAINT()), address(paint));
    }

    function testClaimRequiresPaintSoulboundAndOwnerMayBurn() public {
        vm.prank(bob);
        vm.expectRevert(R3tardsPainterPass.NoPaintYet.selector);
        pass.claim();

        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.prank(alice);
        uint256 id = pass.claim();
        assertTrue(pass.locked(id));
        assertTrue(pass.supportsInterface(0xb45a3c0e));

        string memory uri = pass.tokenURI(id);
        bytes memory json = _decodeDataUri(uri, bytes("data:application/json;base64,"));
        vm.parseJson(string(json));
        assertEq(_count(json, bytes("\"name\":\"r3 pass #1\"")), 1);
        assertEq(_count(json, bytes("\"trait_type\":\"DF1 seed\"")), 1);
        assertEq(_count(json, bytes("\"trait_type\":\"DF1 amount\"")), 1);
        bytes memory svg = _svgFromJson(json);
        assertEq(_count(svg, bytes(">r3 pass</text>")), 1);
        assertEq(_count(svg, bytes("data:image/bmp;base64,")), 1);

        vm.prank(alice);
        vm.expectRevert(R3tardsPainterPass.Soulbound.selector);
        pass.transferFrom(alice, bob, id);
        vm.prank(alice);
        pass.burn(id);
        assertEq(pass.passOf(alice), 0);
        vm.prank(alice);
        vm.expectRevert(R3tardsPainterPass.AlreadyClaimed.selector);
        pass.claim();
    }

    function testContractUriIsValidJsonAndOnlyOwnerSetsExternalLink() public {
        vm.prank(bob);
        vm.expectRevert();
        pass.setExternalLink("https://wrong.example");

        pass.setExternalLink("https://r3tards.example/pass");
        bytes memory json = _decodeDataUri(pass.contractURI(), bytes("data:application/json;base64,"));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".name"), "r3tards painter pass");
        assertEq(vm.parseJsonUint(string(json), ".seller_fee_basis_points"), 0);
        assertEq(vm.parseJsonString(string(json), ".external_link"), "https://r3tards.example/pass");
    }

    function testStampSourcesAreDisplayOnlyAndAppendOnly() public {
        EarnedStamp source = new EarnedStamp();
        pass.addStampSource(address(source));
        assertEq(pass.stampSourceCount(), 1);
        assertEq(pass.stampSource(0), address(source));

        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.prank(alice);
        uint256 id = pass.claim();
        assertGt(bytes(pass.tokenURI(id)).length, 0);
    }

    function testTwentyTwoEarnedLabStampsDrawSixteenPinsButKeepAllAttributes() public {
        for (uint256 i; i < 22; ++i) pass.addStampSource(address(new EarnedStamp()));
        assertEq(pass.stampSourceCount(), 22);

        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.prank(alice);
        uint256 id = pass.claim();

        string memory uri = pass.tokenURI(id);
        bytes memory json = _decodeDataUri(uri, bytes("data:application/json;base64,"));
        assertEq(_count(json, bytes("\"trait_type\":\"Stamp: GARDENER\"")), 22);

        bytes memory svg = _svgFromJson(json);
        uint256 filledPins = _count(svg, bytes("y=\"450\" width=\"14\" height=\"14\""));
        uint256 emptyPins = _count(svg, bytes("y=\"450.5\" width=\"13\" height=\"13\""));
        assertEq(filledPins + emptyPins, 16);
    }

    function testRevertingStampSourceLeavesItsPinUnearnedAndTokenUriValid() public {
        pass.addStampSource(address(new RevertingStamp()));
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.prank(alice);
        uint256 id = pass.claim();

        bytes memory svg = _svgFromUri(pass.tokenURI(id));
        assertEq(_count(svg, bytes("data:image/bmp;base64,")), 1);
        assertEq(
            _count(
                svg,
                bytes(
                    '<rect x="196.5" y="450.5" width="13" height="13" fill="none" stroke="#3d3d44"/>'
                )
            ),
            1
        );
    }

    function _svgFromUri(string memory uri) private pure returns (bytes memory) {
        bytes memory json = _decodeDataUri(uri, bytes("data:application/json;base64,"));
        return _svgFromJson(json);
    }

    function _svgFromJson(bytes memory json) private pure returns (bytes memory) {
        bytes memory imagePrefix = bytes("\"image\":\"data:image/svg+xml;base64,");
        uint256 imageStart = _indexOf(json, imagePrefix) + imagePrefix.length;
        uint256 imageEnd = imageStart;
        while (imageEnd < json.length && json[imageEnd] != bytes1(uint8(0x22))) ++imageEnd;
        return _decodeBase64(_slice(json, imageStart, imageEnd));
    }

    function _decodeDataUri(string memory uri, bytes memory prefix) private pure returns (bytes memory) {
        bytes memory raw = bytes(uri);
        bytes memory encoded = _slice(raw, prefix.length, raw.length);
        return _decodeBase64(encoded);
    }

    function _decodeBase64(bytes memory src) private pure returns (bytes memory out) {
        if (src.length == 0) return new bytes(0);
        uint256 padding = src[src.length - 1] == bytes1("=") ? 1 : 0;
        if (src.length > 1 && src[src.length - 2] == bytes1("=")) ++padding;
        out = new bytes((src.length / 4) * 3 - padding);
        uint256 j;
        for (uint256 i; i < src.length; i += 4) {
            uint256 n =
                (_b64(src[i]) << 18) | (_b64(src[i + 1]) << 12) | (_b64(src[i + 2]) << 6) | _b64(src[i + 3]);
            if (j < out.length) out[j++] = bytes1(uint8(n >> 16));
            if (j < out.length) out[j++] = bytes1(uint8(n >> 8));
            if (j < out.length) out[j++] = bytes1(uint8(n));
        }
    }

    function _b64(bytes1 c) private pure returns (uint256) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65;
        if (x >= 97 && x <= 122) return x - 71;
        if (x >= 48 && x <= 57) return x + 4;
        if (x == 43) return 62;
        if (x == 47) return 63;
        return 0;
    }

    function _indexOf(bytes memory haystack, bytes memory needle) private pure returns (uint256) {
        if (needle.length == 0 || needle.length > haystack.length) revert("needle");
        for (uint256 i; i + needle.length <= haystack.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return i;
        }
        revert("not found");
    }

    function _count(bytes memory haystack, bytes memory needle) private pure returns (uint256 count) {
        if (needle.length == 0) return 0;
        for (uint256 i; i + needle.length <= haystack.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) {
                ++count;
                i += needle.length - 1;
            }
        }
    }

    function _slice(bytes memory src, uint256 start, uint256 end) private pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i; i < out.length; ++i) out[i] = src[start + i];
    }
}
