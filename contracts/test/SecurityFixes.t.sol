// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSPainterPass} from "../src/R3OSPainterPass.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {IFrameRenderer} from "../src/interfaces/IFrameRenderer.sol";
import {IStampSource} from "../src/interfaces/IStampSource.sol";
import {ILabTokenSource} from "../src/interfaces/ILabTokenSource.sol";
import {ILabTokenNameSource} from "../src/interfaces/ILabTokenNameSource.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract GarbageRenderer is IFrameRenderer {
    function tokenURI(address, uint256) external pure returns (string memory) {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(0, 1)
        }
    }
}

contract GoodStamp is IStampSource {
    function stamp(address) external pure returns (string memory, bool) {
        return ("GOOD", true);
    }
}

contract GarbageStamp is IStampSource {
    function stamp(address) external pure returns (string memory, bool) {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(0, 1)
        }
    }
}

contract GarbageLab is ILabTokenSource, ILabTokenNameSource {
    function mintInto(R3OSLabs labs, address to, uint256 experimentId) external returns (uint256) {
        return labs.mint(to, experimentId);
    }

    function canBurn(uint256) external pure returns (bool) {
        return false;
    }

    function labToken(uint256)
        external
        pure
        returns (string memory, string memory, bytes memory, string memory, uint8, uint8)
    {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(0, 1)
        }
    }

    function labTokenName(uint256) external pure returns (string memory) {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(0, 1)
        }
    }
}

contract SecurityFixesTest is Test {
    R3OSPaint paint;
    MockR3tards r3tards;

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = address(0xB0B);
    uint64 seasonStart;

    function setUp() public {
        vm.roll(1_000);
        alice = vm.addr(alicePk);
        seasonStart = uint64(vm.getBlockTimestamp());
        r3tards = new MockR3tards();
        paint = new R3OSPaint(address(r3tards), seasonStart, alice, alice, 512, 0, 512, 16, 256);
    }

    function testSec_OutlineCapProtectsSetAndAppendAndGenesisFits() public {
        uint256 maxPx = paint.MAX_OUTLINE_PIXELS();
        assertLe(_uniqueOutlinePixels(paint.seasonOutlineRuns(0)), maxPx);

        bytes memory tooLarge = _fullRows(65);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                R3OSPaint.OutlinePixelLimitExceeded.selector,
                uint256(65 * 256),
                maxPx
            )
        );
        paint.setSeasonOutline(1, tooLarge, "too large");

        vm.prank(alice);
        paint.setSeasonOutline(1, _fullRows(64), "max guest");
        assertEq(_uniqueOutlinePixels(paint.seasonOutlineRuns(1)), maxPx);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                R3OSPaint.OutlinePixelLimitExceeded.selector,
                maxPx + 1,
                maxPx
            )
        );
        paint.appendSeasonOutline(1, hex"400000");
    }

    function testSec_RenounceOwnershipIsDisabled() public {
        vm.prank(alice);
        vm.expectRevert(R3OSPaint.OwnershipRenounceDisabled.selector);
        paint.renounceOwnership();
        assertEq(paint.owner(), alice);
    }

    function testSec_ExperimentsCanFreezeButStillRetire() public {
        vm.startPrank(alice);
        uint256 experimentId = paint.addExperiment(address(0x1234), "lab", "");
        paint.freezeExperiments();
        vm.expectRevert(R3OSPaint.ExperimentRegistryFrozen.selector);
        paint.addExperiment(address(0x5678), "late", "");
        paint.retireExperiment(experimentId);
        vm.stopPrank();

        assertTrue(paint.experimentsFrozen());
        assertTrue(paint.experimentInfo(experimentId).retired);
    }

    function testSec_SessionNonceIncrementCancelsUnsignedStart() public {
        address sessionKey = address(0x5151);
        uint256 expiry = vm.getBlockNumber() + 100;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig = _sessionSignature(sessionKey, expiry, 128, 0, deadline);

        vm.prank(alice);
        paint.incrementSessionNonce();
        assertEq(paint.sessionNonces(alice), 1);

        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.InvalidSessionNonce.selector, 1, 0));
        paint.startSession(alice, sessionKey, expiry, 128, 0, deadline, sig);
    }

    function testSec_FinaleGracePeriodRequiresTokenZeroAuthorityThenOpens() public {
        vm.prank(alice);
        paint.paint(hex"00000004", new uint256[](0));
        vm.warp(paint.seasonEndTime(0));

        vm.prank(bob);
        vm.expectRevert(R3OSPaint.NotAuthorized.selector);
        paint.mintSeasonFinale(0);

        vm.prank(alice);
        paint.approve(bob, 0);
        vm.prank(bob);
        uint256 approvedFinale = paint.mintSeasonFinale(0);
        assertEq(paint.ownerOf(approvedFinale), alice);

        R3OSPaint openPaint = new R3OSPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, alice, 512, 0, 512, 16, 256
        );
        vm.prank(alice);
        openPaint.paint(hex"01010104", new uint256[](0));
        vm.warp(openPaint.seasonEndTime(0) + 7 days);
        vm.prank(bob);
        uint256 publicFinale = openPaint.mintSeasonFinale(0);
        assertEq(openPaint.ownerOf(publicFinale), alice);
    }

    function testSec_RendererRejectsEOAAndGarbageFallsBack() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.RendererHasNoCode.selector, bob));
        paint.addRenderer(bob, "eoa");

        GarbageRenderer garbage = new GarbageRenderer();
        vm.prank(alice);
        uint256 rendererId = paint.addRenderer(address(garbage), "garbage");
        vm.prank(alice);
        paint.setTokenRenderer(0, rendererId);

        assertEq(keccak256(bytes(paint.tokenURI(0))), keccak256(bytes(paint.builtinTokenURI(0))));
    }

    function testSec_PassBadStampCannotBrickAndOwnerCanDisableSource() public {
        R3OSPainterPass pass = new R3OSPainterPass(address(paint));
        GoodStamp good = new GoodStamp();
        GarbageStamp garbage = new GarbageStamp();
        uint256 goodId = pass.addStampSource(address(good));
        pass.addStampSource(address(garbage));

        vm.prank(alice);
        paint.paint(hex"02020204", new uint256[](0));
        vm.prank(alice);
        uint256 tokenId = pass.claim();

        bytes memory beforeDisable = _decodeDataUri(pass.tokenURI(tokenId));
        assertTrue(_contains(beforeDisable, bytes('"trait_type":"Stamp: GOOD"')));

        pass.setStampSourceEnabled(goodId, false);
        assertFalse(pass.stampSourceEnabled(goodId));
        bytes memory afterDisable = _decodeDataUri(pass.tokenURI(tokenId));
        assertFalse(_contains(afterDisable, bytes('"trait_type":"Stamp: GOOD"')));
    }

    function testSec_LabsMalformedTokenMetadataFallsBackSafely() public {
        R3OSLabs labs = new R3OSLabs(address(paint), alice);
        GarbageLab garbage = new GarbageLab();
        vm.prank(alice);
        uint256 experimentId = paint.addExperiment(address(garbage), "malformed-lab", "");
        uint256 tokenId = garbage.mintInto(labs, alice, experimentId);

        bytes memory json = _decodeDataUri(labs.tokenURI(tokenId));
        assertTrue(_contains(json, bytes('"name":"r3OS labs artifact #1"')));
        assertTrue(_contains(json, bytes('"description":"an onchain r3OS labs artifact on monad."')));
    }

    function _sessionSignature(
        address sessionKey,
        uint256 expiry,
        uint256 maxUnits,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(paint.SESSION_TYPEHASH(), alice, sessionKey, expiry, maxUnits, nonce, deadline)
        );
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
        return abi.encodePacked(r, s, v);
    }

    function _fullRows(uint256 rows) private pure returns (bytes memory runs) {
        runs = new bytes(rows * 3);
        for (uint256 y; y < rows; ++y) {
            uint256 o = y * 3;
            runs[o] = bytes1(uint8(y));
            runs[o + 1] = 0x00;
            runs[o + 2] = 0xff;
        }
    }

    function _uniqueOutlinePixels(bytes memory runs) private pure returns (uint256 count) {
        uint256[256] memory rows;
        for (uint256 o; o < runs.length; o += 3) {
            uint256 y = uint8(runs[o]);
            uint256 x0 = uint8(runs[o + 1]);
            uint256 x1 = uint8(runs[o + 2]);
            uint256 width = x1 - x0 + 1;
            uint256 mask = width == 256 ? type(uint256).max : ((uint256(1) << width) - 1) << x0;
            rows[y] |= mask;
        }
        for (uint256 y; y < 256; ++y) {
            uint256 row = rows[y];
            while (row != 0) {
                row &= row - 1;
                ++count;
            }
        }
    }

    function _contains(bytes memory haystack, bytes memory needle) private pure returns (bool) {
        if (needle.length > haystack.length) return false;
        for (uint256 i; i + needle.length <= haystack.length; ++i) {
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

    function _decodeDataUri(string memory uri) private pure returns (bytes memory out) {
        bytes memory src = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        uint256 len = src.length - prefix.length;
        uint256 padding = src[src.length - 1] == bytes1("=") ? 1 : 0;
        if (src[src.length - 2] == bytes1("=")) ++padding;
        out = new bytes((len / 4) * 3 - padding);
        bytes memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 outIndex;
        for (uint256 i = prefix.length; i < src.length; i += 4) {
            uint256 n;
            for (uint256 j; j < 4; ++j) {
                n <<= 6;
                bytes1 c = src[i + j];
                if (c == bytes1("=")) continue;
                for (uint256 k; k < 64; ++k) {
                    if (table[k] == c) {
                        n |= k;
                        break;
                    }
                }
            }
            if (outIndex < out.length) out[outIndex++] = bytes1(uint8(n >> 16));
            if (outIndex < out.length) out[outIndex++] = bytes1(uint8(n >> 8));
            if (outIndex < out.length) out[outIndex++] = bytes1(uint8(n));
        }
    }
}
