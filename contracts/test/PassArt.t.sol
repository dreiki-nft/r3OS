// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsPainterPass} from "../src/R3tardsPainterPass.sol";
import {IR3tardsPaintData} from "../src/interfaces/IR3tardsPaintData.sol";
import {IStampSource} from "../src/interfaces/IStampSource.sol";
import {PassArt} from "../src/lib/PassArt.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract PassArtHarness {
    function svg(PassArt.Params memory p) external pure returns (bytes memory) {
        return PassArt.svg(p);
    }

    function df1Params(PassArt.Params memory p) external pure returns (uint32 seed, uint256 amount) {
        return PassArt.df1Params(p);
    }

    function maxPins() external pure returns (uint256) {
        return PassArt.MAX_PINS;
    }
}

contract PassArtEarnedStamp is IStampSource {
    function stamp(address) external pure returns (string memory name, bool earned) {
        return ("GARDENER", true);
    }
}

contract PassArtTest is Test {
    PassArtHarness harness;
    R3tardsPaint paint;
    R3tardsPainterPass pass;
    MockR3tards r3tards;
    address alice = address(0xA11CE);
    uint256 passId;

    function setUp() public {
        harness = new PassArtHarness();
        vm.roll(1_000);
        r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, alice, 512, 0, 512, 16, 256
        );
        pass = new R3tardsPainterPass(address(paint));
        vm.prank(alice);
        paint.setPainterPass(address(pass));

        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.prank(alice);
        passId = pass.claim();
    }

    function testGoldenFirstPaint() public view {
        _assertGolden(
            PassArt.Params({
                owner: address(bytes20(hex"1111111111111111111111111111111111111111")),
                tokenId: 912,
                pixels: 40,
                frames: 0,
                days_: 1,
                stormPaints: 0,
                firstPaintBlock: 48_213_377,
                holder: false,
                pinCount: 11,
                pinMask: 0x1
            }),
            0x713210a19a51715a814ec35ae67d10e0a2a7855b4a2d8cffc9b1cdb1b46d70b7,
            19_565,
            48_213_377,
            20
        );
    }

    function testGoldenRegularHolder() public view {
        _assertGolden(
            PassArt.Params({
                owner: address(bytes20(hex"7fa9385be102ac3eac297483dd6233d62b3e1496")),
                tokenId: 42,
                pixels: 12_480,
                frames: 10,
                days_: 23,
                stormPaints: 0,
                firstPaintBlock: 48_200_004,
                holder: true,
                pinCount: 11,
                pinMask: 0x4b7
            }),
            0x78a34ce225ea8eabe9528c973976886f36c1e291b47be13526b6fc14f16593d2,
            19_457,
            48_200_004,
            20
        );
    }

    function testGoldenStormChaser() public view {
        _assertGolden(
            PassArt.Params({
                owner: address(bytes20(hex"9b3f00000000000000000000000000000000e3a1")),
                tokenId: 7,
                pixels: 4_200,
                frames: 3,
                days_: 9,
                stormPaints: 55,
                firstPaintBlock: 48_199_311,
                holder: false,
                pinCount: 11,
                pinMask: 0x41b
            }),
            0xb9ce0f0c293c77088fc16c6b7a449b3a9faf5c6aadc2fca06ca449f86949fa3c,
            19_493,
            48_199_311,
            95
        );
    }

    function testGoldenWhale() public view {
        _assertGolden(
            _whale(),
            0x49b13d718dd408aca1e7c2227716241067f0cc569f17719e89033234184a1118,
            19_386,
            48_190_001,
            140
        );
    }

    function testPassArtWhaleGas() public {
        uint256 gasBefore = gasleft();
        bytes memory rendered = harness.svg(_whale());
        uint256 used = gasBefore - gasleft();
        console.log("GAS PassArt.svg whale", used);
        assertEq(rendered.length, 19_386);
    }

    function testPainterPassWhaleGasWithFiveStampSources() public {
        for (uint256 i; i < 5; ++i) pass.addStampSource(address(new PassArtEarnedStamp()));
        r3tards.mint(alice, 1);

        vm.mockCall(
            address(paint),
            abi.encodeWithSelector(IR3tardsPaintData.painterStats.selector, alice),
            abi.encode(
                uint32(34),
                uint32(0),
                uint96(180_000),
                uint48(40),
                uint48(48_190_001),
                uint48(48_190_500),
                uint64(2_000),
                uint64(2_000),
                uint64(214),
                uint64(300)
            )
        );
        vm.mockCall(
            address(paint),
            abi.encodeWithSelector(IR3tardsPaintData.daysPainted.selector, alice),
            abi.encode(uint32(34))
        );

        uint256 gasBefore = gasleft();
        string memory uri = pass.tokenURI(passId);
        uint256 used = gasBefore - gasleft();
        console.log("GAS PainterPass tokenURI", used);
        assertLt(used, 12_000_000);
        assertGt(bytes(uri).length, 0);
    }

    function testMaxPinsIsSixteen() public view {
        assertEq(harness.maxPins(), 16);
    }

    function _assertGolden(
        PassArt.Params memory p,
        bytes32 expectedHash,
        uint256 expectedLength,
        uint32 expectedSeed,
        uint256 expectedAmount
    ) internal view {
        bytes memory rendered = harness.svg(p);
        assertEq(keccak256(rendered), expectedHash);
        assertEq(rendered.length, expectedLength);
        (uint32 seed, uint256 amount) = harness.df1Params(p);
        assertEq(seed, expectedSeed);
        assertEq(amount, expectedAmount);
    }

    function _whale() internal pure returns (PassArt.Params memory) {
        return PassArt.Params({
            owner: address(bytes20(hex"d07a00000000000000000000000000000005c19f")),
            tokenId: 12_345,
            pixels: 180_000,
            frames: 40,
            days_: 34,
            stormPaints: 300,
            firstPaintBlock: 48_190_001,
            holder: true,
            pinCount: 11,
            pinMask: 0x7ff
        });
    }
}
