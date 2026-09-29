// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {IR3tardsPaintData} from "../src/interfaces/IR3tardsPaintData.sol";
import {DF1Renderer} from "../src/renderers/DF1Renderer.sol";
import {DF1} from "../src/lib/DF1.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract DF1Harness {
    function applyDf1(bytes memory rgb, uint32 seed, uint256 amount) external pure returns (bytes memory) {
        return DF1.applyDf1(rgb, seed, amount);
    }
}

contract DF1RendererTest is Test {
    R3tardsPaint paint;
    DF1Renderer renderer;
    DF1Harness harness;
    MockR3tards r3tards;
    address alice;
    address royalty;
    uint256 rendererId;

    function setUp() public {
        vm.roll(1_000);
        alice = makeAddr("alice");
        royalty = makeAddr("royalty");
        r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, royalty, 512, 0, 512, 16, 256
        );
        renderer = new DF1Renderer();
        harness = new DF1Harness();
        vm.prank(alice);
        rendererId = paint.addRenderer(address(renderer), "df1");
    }

    function testGoldenInputAndVectors() public view {
        bytes memory input = df1GoldenInput();
        assertEq(keccak256(input), 0xd6ed268866a694810cc23ce886dd6f22265f99943464d56793a80a278dcd8129);
        assertEq(
            keccak256(harness.applyDf1(input, 333, 100)),
            0xd366009a040672f5b54682810d5f8e42e71c3f8a2064a250f68a34a7ebc3e514
        );
        assertEq(
            keccak256(harness.applyDf1(input, 0, 200)),
            0xbb5f205cde59b1f31c02e84445f65aa31346866714d62048d9b19897eda6afbb
        );
        assertEq(
            keccak256(harness.applyDf1(input, 0xDEADBEEF, 37)),
            0x0f1a82c4fac0c0adfaf06569458438d59b582c3d22f11064649bd276248903d0
        );
        assertEq(harness.applyDf1(input, 123, 0), input);
    }

    function testFrameFinaleAndTokenZeroRender() public {
        string memory live = renderer.tokenURI(address(paint), 0);
        assertTrue(bytes(live).length > 0);

        uint256 frameId = _paintAndMint();
        string memory frameUri = renderer.tokenURI(address(paint), frameId);
        assertTrue(bytes(frameUri).length > 0);

        vm.warp(paint.seasonEndTime(0) + 1);
        vm.prank(alice);
        uint256 finaleId = paint.mintSeasonFinale(0);
        string memory finaleUri = renderer.tokenURI(address(paint), finaleId);
        assertTrue(bytes(finaleUri).length > 0);
    }

    function testRoutedTokenURIEqualsDirectUnderThirtyMillionGas() public {
        uint256 frameId = _paintAndMint();
        vm.prank(alice);
        paint.setTokenRenderer(frameId, rendererId);
        string memory direct = renderer.tokenURI(address(paint), frameId);

        (bool ok, bytes memory raw) = address(paint).staticcall{gas: 30_000_000}(
            abi.encodeCall(paint.tokenURI, (frameId))
        );
        assertTrue(ok);
        string memory routed = abi.decode(raw, (string));
        assertEq(routed, direct);
    }

    function testStormFrameAmountIsTwoHundred() public {
        vm.roll(200_000);
        uint256 id = _paintAndMint();
        (, , uint256 amount) = renderer.source64(address(paint), id);
        assertEq(amount, 200);
    }

    function testSourceMaskMatchesNaiveDefaultAndCustomGuest() public {
        (bytes memory actualDefault,,) = renderer.source64(address(paint), 0);
        assertEq(actualDefault, _naiveSource(0));

        bytes memory full = _fullOutlineRuns();
        vm.prank(alice);
        paint.setSeasonOutline(1, full, "max guest");
        vm.warp(paint.seasonStartTime(1));
        (bytes memory actualGuest,,) = renderer.source64(address(paint), 0);
        assertEq(actualGuest, _naiveSource(0));
    }

    function testGasDefaultAndWorstCaseCustomOutline() public {
        uint256 id = _paintAndMint();
        uint256 gasBefore = gasleft();
        renderer.tokenURI(address(paint), id);
        uint256 defaultGas = gasBefore - gasleft();
        console.log("GAS DF1 tokenURI default outline", defaultGas);
        assertLt(defaultGas, 10_000_000);

        vm.prank(alice);
        paint.setSeasonOutline(1, _fullOutlineRuns(), "max guest");
        vm.warp(paint.seasonStartTime(1));
        gasBefore = gasleft();
        renderer.tokenURI(address(paint), 0);
        uint256 customGas = gasBefore - gasleft();
        console.log("GAS DF1 tokenURI max custom outline", customGas);
        assertLt(customGas, 10_000_000);
    }

    function testGasConstantWithManyShortRuns() public {
        for (uint256 chunk; chunk < 1; ++chunk) {
            bytes memory runs = _shortRunsChunk(chunk);
            vm.startPrank(alice);
            if (chunk == 0) paint.setSeasonOutline(1, runs, "many runs");
            else paint.appendSeasonOutline(1, runs);
            vm.stopPrank();
        }
        vm.warp(paint.seasonStartTime(1));

        uint256 gasBefore = gasleft();
        string memory direct = renderer.tokenURI(address(paint), 0);
        uint256 directGas = gasBefore - gasleft();
        console.log("GAS DF1 tokenURI 4000 short runs (outline cap)", directGas);
        assertLt(directGas, 10_000_000);

        vm.prank(alice);
        paint.setTokenRenderer(0, rendererId);
        (bool ok, bytes memory raw) = address(paint).staticcall{gas: 30_000_000}(abi.encodeCall(paint.tokenURI, (0)));
        assertTrue(ok);
        string memory routed = abi.decode(raw, (string));
        assertEq(routed, direct);
        bytes memory decodedJson = _decodeBase64DataUri(routed);
        assertTrue(_contains(decodedJson, bytes('"trait_type":"View","value":"df1"')));
    }

    function testOverlappingRunsCountOnce() public {
        bytes memory runs = hex"0a00030a0003";
        vm.prank(alice);
        paint.setSeasonOutline(1, runs, "overlap");
        vm.warp(paint.seasonStartTime(1));
        (bytes memory rgb,,) = renderer.source64(address(paint), 0);
        uint256 d = (2 * 64) * 3;
        assertEq(uint8(rgb[d]), 255);
        assertEq(uint8(rgb[d + 1]), 255);
        assertEq(uint8(rgb[d + 2]), 255);
    }

    function df1GoldenInput() public pure returns (bytes memory b) {
        b = new bytes(4096 * 3);
        for (uint256 i; i < b.length; i += 32) {
            bytes32 r = keccak256(abi.encode(i));
            assembly ("memory-safe") { mstore(add(add(b, 0x20), i), r) }
        }
        for (uint256 i; i < 4096; i += 7) {
            b[i * 3] = 0;
            b[i * 3 + 1] = 0;
            b[i * 3 + 2] = 0;
        }
        for (uint256 i = 3; i < 4096; i += 11) {
            b[i * 3] = 0xff;
            b[i * 3 + 1] = 0xff;
            b[i * 3 + 2] = 0xff;
        }
    }

    function _paintAndMint() internal returns (uint256 id) {
        vm.prank(alice);
        paint.paint(hex"00001304", new uint256[](0));
        vm.prank(alice);
        id = paint.mintFrame();
    }

    function _fullOutlineRuns() internal pure returns (bytes memory runs) {
        runs = new bytes(64 * 3);
        for (uint256 y; y < 64; ++y) {
            runs[y * 3] = bytes1(uint8(y));
            runs[y * 3 + 1] = 0x00;
            runs[y * 3 + 2] = 0xff;
        }
    }

    function _shortRunsChunk(uint256 chunk) internal pure returns (bytes memory runs) {
        runs = new bytes(4_000 * 3);
        for (uint256 i; i < 4_000; ++i) {
            uint256 n = uint256(keccak256(abi.encode(chunk, i)));
            uint8 y = uint8(n);
            uint8 x0 = uint8((n >> 8) % 253);
            uint256 o = i * 3;
            runs[o] = bytes1(y);
            runs[o + 1] = bytes1(x0);
            runs[o + 2] = bytes1(x0 + 3);
        }
    }

    function _naiveSource(uint256 tokenId) internal view returns (bytes memory rgb) {
        uint256 season;
        uint8 face;
        uint8 background;
        if (tokenId == 0) {
            season = paint.currentSeason();
            face = paint.faceColor(season);
            background = paint.backgroundColor(season);
        } else {
            IR3tardsPaintData.FrameInfoData memory info = IR3tardsPaintData(address(paint)).frameInfo(tokenId);
            season = info.season;
            face = info.faceColor;
            background = info.backgroundColor;
        }
        bytes memory bg = paint.frameData(tokenId);
        bytes memory outline = paint.genesisFrameData(season);
        uint24[16] memory pal = paint.palette();
        pal[0] = pal[background];
        rgb = new bytes(64 * 64 * 3);
        for (uint256 y; y < 64; ++y) {
            for (uint256 x; x < 64; ++x) {
                uint256 count;
                for (uint256 dy; dy < 4; ++dy) {
                    uint256 sourceY = y * 4 + dy;
                    uint256 row = (255 - sourceY) * 128;
                    for (uint256 dx; dx < 4; ++dx) {
                        uint256 sourceX = x * 4 + dx;
                        uint8 packed = uint8(outline[row + (sourceX >> 1)]);
                        uint8 nibble = (sourceX & 1) == 0 ? packed >> 4 : packed & 0x0f;
                        if (nibble != 0) ++count;
                    }
                }
                uint256 srcRow = 255 - y * 4;
                uint8 index = uint8(bg[srcRow * 128 + x * 2]) >> 4;
                if (count >= 6) index = face;
                uint24 color = pal[index];
                uint256 d = (y * 64 + x) * 3;
                rgb[d] = bytes1(uint8(color >> 16));
                rgb[d + 1] = bytes1(uint8(color >> 8));
                rgb[d + 2] = bytes1(uint8(color));
            }
        }
    }

    function _decodeBase64DataUri(string memory uri) internal pure returns (bytes memory out) {
        bytes memory src = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        require(src.length >= prefix.length, "short uri");
        uint256 len = src.length - prefix.length;
        require(len % 4 == 0, "bad b64");
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
        if (needle.length == 0 || needle.length > haystack.length) return false;
        for (uint256 i; i + needle.length <= haystack.length; ++i) {
            bool ok = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }
}
