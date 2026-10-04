// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSWeeds} from "../src/labs/R3OSWeeds.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract R3OSWeedsHarness is R3OSWeeds {
    constructor(address paintCore, uint64 openTime) R3OSWeeds(paintCore, openTime) {}

    function step(uint64[64] memory w, uint64[64] memory soil) external pure returns (uint64[64] memory) {
        return _step(w, soil);
    }
}

contract WeedsTest is Test {
    R3OSPaint paint;
    R3OSWeedsHarness weeds;
    MockR3tards r3tards;
    uint256 alicePk = 0xA11CE;
    address alice;
    address bob;

    function setUp() public {
        vm.roll(1_000);
        alice = vm.addr(alicePk);
        bob = makeAddr("bob");
        r3tards = new MockR3tards();
        paint = new R3OSPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, alice, 512, 0, 512, 16, 256
        );
        weeds = new R3OSWeedsHarness(address(paint), uint64(vm.getBlockTimestamp()));
    }

    function testNotOpenYetAndValidation() public {
        R3OSWeeds future = new R3OSWeeds(address(paint), uint64(vm.getBlockTimestamp() + 100));
        vm.expectRevert(R3OSWeeds.NotOpenYet.selector);
        future.tick(0);
        vm.expectRevert(abi.encodeWithSelector(R3OSWeeds.InvalidRegion.selector, 16));
        weeds.tick(16);
        vm.expectRevert(abi.encodeWithSelector(R3OSWeeds.InvalidPlant.selector, 64, 0, 0));
        weeds.plant(0, 64, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(R3OSWeeds.InvalidPlant.selector, 0, 64, 0));
        weeds.plant(0, 0, 64, 0);
        vm.expectRevert(abi.encodeWithSelector(R3OSWeeds.InvalidPlant.selector, 0, 0, 8));
        weeds.plant(0, 0, 0, 8);
    }

    function testStepMatchesNaiveFifteenGenerationsWithSoil() public view {
        uint64[64] memory world_;
        uint64[64] memory soil;
        for (uint256 y; y < 64; ++y) {
            uint64 a = uint64(uint256(keccak256(abi.encode("world", y))));
            uint64 b = uint64(uint256(keccak256(abi.encode("soil-a", y))));
            uint64 c = uint64(uint256(keccak256(abi.encode("soil-b", y))));
            world_[y] = a;
            soil[y] = b | c; // roughly 75% soil
        }
        for (uint256 generation; generation < 15; ++generation) {
            uint64[64] memory fast = weeds.step(world_, soil);
            uint64[64] memory slow = _naiveStep(world_, soil);
            for (uint256 y; y < 64; ++y) assertEq(fast[y], slow[y]);
            world_ = fast;
        }
    }

    function testGliderReturnsHomeAfter256GenerationsOnTorus() public view {
        uint64[64] memory initial = _patternWorld(0, 0, 0);
        uint64[64] memory soil;
        for (uint256 y; y < 64; ++y) soil[y] = type(uint64).max;
        uint64[64] memory w = initial;
        for (uint256 i; i < 256; ++i) w = weeds.step(w, soil);
        for (uint256 y; y < 64; ++y) assertEq(w[y], initial[y]);
    }

    function testPaintingOverLiveCellKillsItOnNextTick() public {
        vm.prank(alice);
        weeds.plant(0, 10, 10, 5); // 2x2 block, includes (10,10)
        assertTrue((_worldRow(0, 10) & _bit(10)) != 0);

        vm.prank(alice);
        paint.paint(abi.encodePacked(uint8(10), uint8(10), uint8(10), uint8(4)), new uint256[](0));
        vm.prank(alice);
        weeds.tick(0);
        assertEq(_worldRow(0, 10) & _bit(10), 0);
    }

    function testOncePerBlockPerRegionAndDifferentRegionsCanTickTogether() public {
        vm.prank(alice);
        weeds.tick(0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3OSWeeds.AlreadyTicked.selector, 0));
        weeds.tick(0);
        vm.prank(bob);
        weeds.tick(5);
        (uint64 g0,,) = weeds.regionInfo(0);
        (uint64 g5,,) = weeds.regionInfo(5);
        assertEq(g0, 1);
        assertEq(g5, 1);
    }

    function testPlantWrapSoilCooldownAndNothingPlanted() public {
        vm.prank(alice);
        weeds.plant(0, 63, 63, 5); // 2x2 block wraps both axes
        assertTrue((_worldRow(0, 63) & _bit(63)) != 0);
        assertTrue((_worldRow(0, 63) & _bit(0)) != 0);
        assertTrue((_worldRow(0, 0) & _bit(63)) != 0);
        assertTrue((_worldRow(0, 0) & _bit(0)) != 0);

        uint256 until = vm.getBlockNumber() + weeds.PLANT_COOLDOWN_BLOCKS();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3OSWeeds.PlantCooldown.selector, until));
        weeds.plant(0, 20, 20, 5);

        vm.roll(until);
        vm.prank(alice);
        weeds.plant(0, 20, 20, 5);
        vm.roll(vm.getBlockNumber() + weeds.PLANT_COOLDOWN_BLOCKS());
        vm.prank(alice);
        vm.expectRevert(R3OSWeeds.NothingPlanted.selector);
        weeds.plant(0, 20, 20, 5);

        // Default outline does not cover region 0, while a painted canvas pixel removes soil immediately.
        vm.prank(bob);
        paint.paint(abi.encodePacked(uint8(30), uint8(30), uint8(30), uint8(4)), new uint256[](0));
        vm.prank(bob);
        weeds.plant(0, 30, 30, 5);
        assertEq(_worldRow(0, 30) & _bit(30), 0);
    }

    function testSessionKeyPlantCreditedToOwner() public {
        address key = vm.addr(0xBEEF);
        _startSession(key, 200, 1_000);
        vm.prank(key);
        weeds.plant(0, 5, 5, 0);
        (, uint32 alicePlants,) = weeds.gardenerInfo(alice);
        (, uint32 keyPlants,) = weeds.gardenerInfo(key);
        assertEq(alicePlants, 1);
        assertEq(keyPlants, 0);
    }

    function testGardenerStamp() public {
        (string memory name, bool earned) = weeds.stamp(alice);
        assertEq(name, "GARDENER");
        assertFalse(earned);
        for (uint256 i; i < 25; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(alice);
            weeds.tick(0);
        }
        (, earned) = weeds.stamp(alice);
        assertTrue(earned);
    }

    function testTicksInDifferentRegionsWriteDisjointStorage() public {
        vm.record();
        vm.prank(alice);
        weeds.tick(0);
        (, bytes32[] memory writes0) = vm.accesses(address(weeds));

        vm.record();
        vm.prank(bob);
        weeds.tick(5);
        (, bytes32[] memory writes5) = vm.accesses(address(weeds));

        for (uint256 i; i < writes0.length; ++i) {
            for (uint256 j; j < writes5.length; ++j) assertTrue(writes0[i] != writes5[j]);
        }
        _assertRegionWrites(writes0, 0);
        _assertRegionWrites(writes5, 5);
    }

    function testWorldBitmapAndGasTargets() public {
        vm.prank(alice);
        uint256 g = gasleft();
        weeds.plant(0, 10, 10, 0);
        uint256 plantGas = g - gasleft();
        console.log("GAS Weeds plant", plantGas);
        assertLt(plantGas, 500_000);

        vm.roll(vm.getBlockNumber() + 1);
        g = gasleft();
        vm.prank(alice);
        weeds.tick(0);
        uint256 tickGas = g - gasleft();
        console.log("GAS Weeds tick", tickGas);
        assertLt(tickGas, 600_000);

        g = gasleft();
        bytes memory bitmap = weeds.worldBitmap();
        uint256 bitmapGas = g - gasleft();
        console.log("GAS Weeds worldBitmap", bitmapGas);
        assertLt(bitmapGas, 1_000_000);
        assertEq(bitmap.length, 8_192);
    }

    function _assertRegionWrites(bytes32[] memory writes, uint8 region) internal view {
        uint256 base = weeds.regionPageSlot(region);
        uint256 outside;
        for (uint256 i; i < writes.length; ++i) {
            uint256 slot = uint256(writes[i]);
            if (slot >= base && slot < base + 128) {
                assertLe(slot, base + 16);
            } else {
                ++outside; // one per-owner gardener-stat slot
            }
        }
        assertLe(outside, 1);
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

    function _worldRow(uint8 region, uint256 y) internal view returns (uint64) {
        uint64[64] memory w = weeds.world(region);
        return w[y];
    }

    function _bit(uint256 x) internal pure returns (uint64) {
        return uint64(1) << uint64(63 - x);
    }

    function _patternWorld(uint8 pattern, uint8 x, uint8 y) internal pure returns (uint64[64] memory w) {
        uint64 bits = _pattern(pattern);
        for (uint256 py; py < 8; ++py) {
            uint8 row = uint8(bits >> ((7 - py) * 8));
            for (uint256 px; px < 8; ++px) {
                if ((row & (uint8(1) << uint8(7 - px))) == 0) continue;
                uint256 wx = (uint256(x) + px) & 63;
                uint256 wy = (uint256(y) + py) & 63;
                w[wy] |= _bit(wx);
            }
        }
    }

    function _naiveStep(uint64[64] memory w, uint64[64] memory soil) internal pure returns (uint64[64] memory n) {
        for (uint256 y; y < 64; ++y) {
            for (uint256 x; x < 64; ++x) {
                uint256 neighbors;
                for (int256 dy = -1; dy <= 1; ++dy) {
                    for (int256 dx = -1; dx <= 1; ++dx) {
                        if (dx == 0 && dy == 0) continue;
                        uint256 yy = uint256(int256(y) + dy + 64) & 63;
                        uint256 xx = uint256(int256(x) + dx + 64) & 63;
                        if ((w[yy] & _bit(xx)) != 0) ++neighbors;
                    }
                }
                bool alive = (w[y] & _bit(x)) != 0;
                bool nextAlive = neighbors == 3 || (alive && neighbors == 2);
                if (nextAlive && (soil[y] & _bit(x)) != 0) n[y] |= _bit(x);
            }
        }
    }

    function _pattern(uint8 index) internal pure returns (uint64) {
        if (index == 0) return 0x4020e00000000000;
        if (index == 1) return 0x488088f000000000;
        if (index == 2) return 0x60c0400000000000;
        if (index == 3) return 0xe000000000000000;
        if (index == 4) return 0x4010ce0000000000;
        if (index == 5) return 0xc0c0000000000000;
        if (index == 6) return 0x6090600000000000;
        return 0x02c0470000000000;
    }
}
