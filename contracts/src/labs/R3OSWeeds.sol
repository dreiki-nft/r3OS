// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IR3OSPaintData} from "../interfaces/IR3OSPaintData.sol";
import {IStampSource} from "../interfaces/IStampSource.sol";

/// @notice Sixteen independent 64x64 toroidal Conway worlds living only on blank canvas soil.
/// @dev No owner or admin. Each region world occupies its own 128-slot-aligned storage page.
contract R3OSWeeds is IStampSource {
    error ZeroAddress();
    error NotOpenYet();
    error InvalidRegion(uint8 region);
    error InvalidPlant(uint8 x, uint8 y, uint8 pattern);
    error AlreadyTicked(uint8 region);
    error PlantCooldown(uint256 untilBlock);
    error NothingPlanted();

    event Ticked(
        uint8 indexed region,
        uint64 generation,
        uint16 population,
        address indexed owner,
        address sender
    );
    event Planted(
        uint8 indexed region,
        uint8 x,
        uint8 y,
        uint8 pattern,
        address indexed owner,
        address sender
    );

    uint256 public constant WEEDS_BASE = uint256(keccak256("r3tards.weeds.worlds")) & ~uint256(127);
    uint256 public constant PLANT_COOLDOWN_BLOCKS = 100;
    uint256 internal constant M64 = 0xFFFFFFFFFFFFFFFF;

    IR3OSPaintData public immutable PAINT;
    uint64 public immutable OPEN_TIME;

    struct GardenerData {
        uint48 lastPlantBlock;
        uint32 plants;
        uint32 ticks;
    }

    mapping(address => GardenerData) private _gardeners;

    constructor(address paintCore, uint64 openTime) {
        if (paintCore == address(0)) revert ZeroAddress();
        PAINT = IR3OSPaintData(paintCore);
        OPEN_TIME = openTime;
    }

    function tick(uint8 region) external {
        _requireOpen();
        _requireRegion(region);
        uint256 base = regionPageSlot(region);
        (uint64 generation, uint48 lastTickBlock,) = _unpackMeta(_sload(base + 16));
        if (lastTickBlock == block.number) revert AlreadyTicked(region);

        uint64[64] memory current = _loadWorld(region);
        uint64[64] memory soil = PAINT.regionBlankMask(PAINT.currentSeason(), region);
        uint64[64] memory next = _step(current, soil);
        uint16 population = _population(next);
        _storeWorld(region, next);

        unchecked { ++generation; }
        _sstore(base + 16, _packMeta(generation, uint48(block.number), population));
        address owner = _resolveOwner(msg.sender);
        unchecked { ++_gardeners[owner].ticks; }
        emit Ticked(region, generation, population, owner, msg.sender);
    }

    function plant(uint8 region, uint8 x, uint8 y, uint8 pattern) external {
        _requireOpen();
        _requireRegion(region);
        if (x >= 64 || y >= 64 || pattern >= 8) revert InvalidPlant(x, y, pattern);

        address owner = _resolveOwner(msg.sender);
        GardenerData storage gardener = _gardeners[owner];
        if (
            gardener.lastPlantBlock != 0
                && block.number < uint256(gardener.lastPlantBlock) + PLANT_COOLDOWN_BLOCKS
        ) {
            revert PlantCooldown(uint256(gardener.lastPlantBlock) + PLANT_COOLDOWN_BLOCKS);
        }

        uint64[64] memory current = _loadWorld(region);
        uint64[64] memory soil = PAINT.regionBlankMask(PAINT.currentSeason(), region);
        uint64 bits = _pattern(pattern);
        uint16 changedSlots;
        uint16 added;

        for (uint256 py; py < 8; ++py) {
            uint8 rowBits = uint8(bits >> ((7 - py) * 8));
            if (rowBits == 0) continue;
            uint256 wy = (uint256(y) + py) & 63;
            uint64 row = current[wy];
            uint64 allowed = soil[wy];
            for (uint256 px; px < 8; ++px) {
                if ((rowBits & (uint8(1) << uint8(7 - px))) == 0) continue;
                uint256 wx = (uint256(x) + px) & 63;
                uint64 bit = uint64(1) << uint64(63 - wx);
                if ((allowed & bit) == 0 || (row & bit) != 0) continue;
                row |= bit;
                unchecked { ++added; }
            }
            if (row != current[wy]) {
                current[wy] = row;
                changedSlots |= uint16(1) << uint16(wy >> 2);
            }
        }
        if (added == 0) revert NothingPlanted();

        _storeChangedWorldSlots(region, current, changedSlots);
        uint256 base = regionPageSlot(region);
        (uint64 generation, uint48 lastTickBlock, uint16 population) = _unpackMeta(_sload(base + 16));
        population += added;
        _sstore(base + 16, _packMeta(generation, lastTickBlock, population));

        gardener.lastPlantBlock = uint48(block.number);
        unchecked { ++gardener.plants; }
        emit Planted(region, x, y, pattern, owner, msg.sender);
    }

    function world(uint8 region) external view returns (uint64[64] memory) {
        _requireRegion(region);
        return _loadWorld(region);
    }

    function regionInfo(uint8 region)
        external
        view
        returns (uint64 generation, uint48 lastTickBlock, uint16 population)
    {
        _requireRegion(region);
        return _unpackMeta(_sload(regionPageSlot(region) + 16));
    }

    function gardenerInfo(address painter)
        external
        view
        returns (uint48 lastPlantBlock, uint32 plants, uint32 ticks)
    {
        GardenerData storage g = _gardeners[painter];
        return (g.lastPlantBlock, g.plants, g.ticks);
    }

    /// @notice Full 256x256 1-bit world map, top-down row-major, MSB is the left pixel.
    function worldBitmap() external view returns (bytes memory out) {
        out = new bytes(8_192);
        for (uint256 regionY; regionY < 4; ++regionY) {
            for (uint256 slotIndex; slotIndex < 16; ++slotIndex) {
                uint256 s0 = _sload(regionPageSlot(uint8(regionY * 4)) + slotIndex);
                uint256 s1 = _sload(regionPageSlot(uint8(regionY * 4 + 1)) + slotIndex);
                uint256 s2 = _sload(regionPageSlot(uint8(regionY * 4 + 2)) + slotIndex);
                uint256 s3 = _sload(regionPageSlot(uint8(regionY * 4 + 3)) + slotIndex);
                for (uint256 lane; lane < 4; ++lane) {
                    uint256 shift = (3 - lane) * 64;
                    uint256 rowWord = (uint256(uint64(s0 >> shift)) << 192)
                        | (uint256(uint64(s1 >> shift)) << 128)
                        | (uint256(uint64(s2 >> shift)) << 64)
                        | uint256(uint64(s3 >> shift));
                    uint256 globalY = regionY * 64 + slotIndex * 4 + lane;
                    assembly ("memory-safe") {
                        mstore(add(add(out, 0x20), mul(globalY, 32)), rowWord)
                    }
                }
            }
        }
    }

    function stamp(address painter) external view returns (string memory name, bool earned) {
        GardenerData storage g = _gardeners[painter];
        return ("GARDENER", g.plants >= 5 || g.ticks >= 25);
    }

    function regionPageSlot(uint8 region) public pure returns (uint256) {
        if (region >= 16) revert InvalidRegion(region);
        return WEEDS_BASE + uint256(region) * 128;
    }

    /// @dev One B3/S23 generation on a 64x64 torus. Row y is w[y]; column x is bit (63 - x).
    /// Cells not on soil die, and nothing is born off soil.
    function _step(uint64[64] memory w, uint64[64] memory soil) internal pure returns (uint64[64] memory n) {
        for (uint256 y; y < 64; ++y) {
            uint256 up = w[(y + 63) & 63];
            uint256 mid = w[y];
            uint256 dn = w[(y + 1) & 63];
            uint256 k2is1;
            uint256 ones;
            assembly ("memory-safe") {
                function rl(v) -> r { r := and(or(shl(1, v), shr(63, v)), 0xFFFFFFFFFFFFFFFF) }
                function rr(v) -> r { r := and(or(shr(1, v), shl(63, v)), 0xFFFFFFFFFFFFFFFF) }
                let a := rl(up) let b := up let c := rr(up)
                let d := rl(mid) let e := rr(mid)
                let f := rl(dn) let g := dn let h := rr(dn)
                let s1 := xor(xor(a, b), c) let c1 := or(and(a, b), and(c, xor(a, b)))
                let s2 := xor(xor(d, e), f) let c2 := or(and(d, e), and(f, xor(d, e)))
                let s3 := xor(g, h) let c3 := and(g, h)
                ones := xor(xor(s1, s2), s3)
                let c4 := or(and(s1, s2), and(s3, xor(s1, s2)))
                let t := xor(xor(c1, c2), c3)
                let c5 := or(and(c1, c2), and(c3, xor(c1, c2)))
                k2is1 := and(xor(t, c4), not(c5))
            }
            n[y] = uint64(k2is1 & (ones | mid) & uint256(soil[y]) & M64);
        }
    }

    function _loadWorld(uint8 region) internal view returns (uint64[64] memory w) {
        uint256 base = regionPageSlot(region);
        for (uint256 slotIndex; slotIndex < 16; ++slotIndex) {
            uint256 packed = _sload(base + slotIndex);
            uint256 y = slotIndex * 4;
            w[y] = uint64(packed >> 192);
            w[y + 1] = uint64(packed >> 128);
            w[y + 2] = uint64(packed >> 64);
            w[y + 3] = uint64(packed);
        }
    }

    function _storeWorld(uint8 region, uint64[64] memory w) internal {
        uint256 base = regionPageSlot(region);
        for (uint256 slotIndex; slotIndex < 16; ++slotIndex) {
            _sstore(base + slotIndex, _packRows(w, slotIndex));
        }
    }

    function _storeChangedWorldSlots(uint8 region, uint64[64] memory w, uint16 changedSlots) internal {
        uint256 base = regionPageSlot(region);
        for (uint256 slotIndex; slotIndex < 16; ++slotIndex) {
            if ((changedSlots & (uint16(1) << uint16(slotIndex))) == 0) continue;
            _sstore(base + slotIndex, _packRows(w, slotIndex));
        }
    }

    function _packRows(uint64[64] memory w, uint256 slotIndex) private pure returns (uint256 packed) {
        uint256 y = slotIndex * 4;
        packed = (uint256(w[y]) << 192) | (uint256(w[y + 1]) << 128) | (uint256(w[y + 2]) << 64)
            | uint256(w[y + 3]);
    }

    function _population(uint64[64] memory w) private pure returns (uint16 total) {
        uint256 n;
        for (uint256 y; y < 64; ++y) n += _popcount64(w[y]);
        total = uint16(n);
    }

    function _popcount64(uint64 x) private pure returns (uint64) {
        unchecked {
            x -= (x >> 1) & 0x5555555555555555;
            x = (x & 0x3333333333333333) + ((x >> 2) & 0x3333333333333333);
            x = (x + (x >> 4)) & 0x0F0F0F0F0F0F0F0F;
            return (x * 0x0101010101010101) >> 56;
        }
    }

    function _packMeta(uint64 generation, uint48 lastTickBlock, uint16 population) private pure returns (uint256) {
        return uint256(generation) | (uint256(lastTickBlock) << 64) | (uint256(population) << 112);
    }

    function _unpackMeta(uint256 packed)
        private
        pure
        returns (uint64 generation, uint48 lastTickBlock, uint16 population)
    {
        generation = uint64(packed);
        lastTickBlock = uint48(packed >> 64);
        population = uint16(packed >> 112);
    }

    function _pattern(uint8 index) private pure returns (uint64) {
        if (index == 0) return 0x4020e00000000000;
        if (index == 1) return 0x488088f000000000;
        if (index == 2) return 0x60c0400000000000;
        if (index == 3) return 0xe000000000000000;
        if (index == 4) return 0x4010ce0000000000;
        if (index == 5) return 0xc0c0000000000000;
        if (index == 6) return 0x6090600000000000;
        return 0x02c0470000000000;
    }

    function _resolveOwner(address sender) private view returns (address owner) {
        (address sessionOwner,,,,, bool active) = PAINT.sessionInfo(sender);
        owner = active ? sessionOwner : sender;
    }

    function _requireOpen() private view {
        if (block.timestamp < OPEN_TIME) revert NotOpenYet();
    }

    function _requireRegion(uint8 region) private pure {
        if (region >= 16) revert InvalidRegion(region);
    }

    function _sload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") { sstore(slot, value) }
    }
}
