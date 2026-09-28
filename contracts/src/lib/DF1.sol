// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice DF1 v1 (mulberry32), byte-identical to df1.r3tards.club for opaque RGB input.
/// @dev THRESHOLDS[a] = ceil(min(1, 0.009919410150891633 * a / 100) * 2^32) and
///      RADII[a] = Math.round(25 * a / 100), both computed with DF1's own JS for a = 0..200.
library DF1 {
    bytes internal constant THRESHOLDS = hex"0000000000068034000d00670013809b001a00ce0020810200270135002d81680034019c003a81cf0041020300478236004e026a0054829d005b02d00061830400680337006e836b0075039e007b83d20082040500888438008f046c0095849f009c04d300a2850600a9053900af856d00b605a000bc85d400c3060700c9863b00d0066e00d686a100dd06d500e3870800ea073c00f0876f00f707a300fd87d601040809010a883d01110870011788a4011e08d70124890a012b093e01318971013809a5013e89d801450a0c014b8a3f01520a7201588aa6015f0ad901658b0d016c0b4001728b7401790ba7017f8bda01860c0e018c8c4101930c7501998ca801a00cdc01a68d0f01ad0d4201b38d7601ba0da901c08ddd01c70e1001cd8e4301d40e7701da8eaa01e10ede01e78f1101ee0f4501f48f7801fb0fab02018fdf02081012020e904602151079021b90ad022210e002289113022f11470235917a023c11ae024291e102491214024f92480256127b025c92af026312e202699316027013490276937c027d13b0028393e3028a14170290944a0297147e029d94b102a414e402aa951802b1154b02b7957f02be15b202c495e502cb161902d1964c02d8168002de96b302e516e702eb971a02f2174d02f8978102ff17b4030597e8030c181b0312984f03191882031f98b5032618e9032c991c0333195003399983034019b7034699ea034d1a1d03539a51035a1a8403609ab803671aeb036d9b1e03741b52037a9b8503811bb903879bec038e1c2003949c53039b1c8603a19cba03a81ced03ae9d2103b51d5403bb9d8803c21dbb03c89dee03cf1e2203d59e5503dc1e8903e29ebc03e91eef03ef9f2303f61f5603fc9f8a04031fbd04099ff1041020240416a057041d208b0423a0be042a20f20430a12504372159043da18c044421bf044aa1f3045122260457a25a045e228d0464a2c0046b22f40471a3270478235b047ea38e048523c2048ba3f5049224280498a45c049f248f04a5a4c304ac24f604b2a52a04b9255d04bfa59004c625c404cca5f704d3262b04d9a65e04e0269204e6a6c504ed26f804f3a72c04fa275f0500a793050727c6050da7f90514282d";
    bytes internal constant RADII = hex"00000101010102020202030303030404040405050505060606060707070708080808090909090a0a0a0a0b0b0b0b0c0c0c0c0d0d0d0d0e0e0e0e0e0f0f0f101010101111111112121212131313131414141415151515161616161717171718181818191919191a1a1a1a1b1b1b1b1c1c1c1c1c1d1d1d1e1e1e1e1f1f1f1f202020202121212122222222232323232424242425252525262626262727272728282828292929292a2a2a2a2b2b2b2b2c2c2c2c2d2d2d2d2e2e2e2e2f2f2f2f3030303031313131323232";

    function applyDf1(bytes memory rgb, uint32 seed, uint256 amount) internal pure returns (bytes memory out) {
        if (amount > 200) amount = 200;
        out = new bytes(rgb.length);
        bytes memory th = THRESHOLDS; bytes memory ra = RADII;
        uint256 T; uint256 R;
        assembly ("memory-safe") {
            T := shr(224, mload(add(add(th, 0x20), mul(amount, 4))))
            R := byte(0, mload(add(add(ra, 0x20), amount)))
        }
        uint256 span = 2 * R + 1;
        assembly ("memory-safe") {
            let state := seed
            if iszero(state) { state := 1 }
            let src := add(rgb, 0x20)
            let dst := add(out, 0x20)
            let end := add(src, mload(rgb))
            let M := 0xffffffff
            let C := 0x6d2b79f5
            for { } lt(src, end) { src := add(src, 3) dst := add(dst, 3) } {
                state := and(add(state, C), M)
                let t := and(mul(xor(state, shr(15, state)), or(state, 1)), M)
                t := xor(t, and(add(t, mul(xor(t, shr(7, t)), or(t, 61))), M))
                let u := xor(t, shr(14, t))
                let w := mload(src)
                let r0 := 0 let r1 := 0 let r2 := 0
                state := and(add(state, C), M)
                t := and(mul(xor(state, shr(15, state)), or(state, 1)), M)
                t := xor(t, and(add(t, mul(xor(t, shr(7, t)), or(t, 61))), M))
                r0 := xor(t, shr(14, t))
                state := and(add(state, C), M)
                t := and(mul(xor(state, shr(15, state)), or(state, 1)), M)
                t := xor(t, and(add(t, mul(xor(t, shr(7, t)), or(t, 61))), M))
                r1 := xor(t, shr(14, t))
                state := and(add(state, C), M)
                t := and(mul(xor(state, shr(15, state)), or(state, 1)), M)
                t := xor(t, and(add(t, mul(xor(t, shr(7, t)), or(t, 61))), M))
                r2 := xor(t, shr(14, t))
                switch lt(u, T)
                case 1 {
                    mstore8(dst, shr(24, r0))
                    mstore8(add(dst, 1), shr(24, r1))
                    mstore8(add(dst, 2), shr(24, r2))
                }
                default {
                    // value + R in [0, 255 + 2R]; clamp against [R, 255 + R] then subtract R
                    let v := add(byte(0, w), shr(32, mul(r0, span)))
                    if lt(v, R) { v := R } if gt(v, add(255, R)) { v := add(255, R) }
                    mstore8(dst, sub(v, R))
                    v := add(byte(1, w), shr(32, mul(r1, span)))
                    if lt(v, R) { v := R } if gt(v, add(255, R)) { v := add(255, R) }
                    mstore8(add(dst, 1), sub(v, R))
                    v := add(byte(2, w), shr(32, mul(r2, span)))
                    if lt(v, R) { v := R } if gt(v, add(255, R)) { v := add(255, R) }
                    mstore8(add(dst, 2), sub(v, R))
                }
            }
        }
    }
}
