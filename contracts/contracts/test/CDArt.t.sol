// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CDArt} from "../src/lib/CDArt.sol";

contract CDArtHarness {
    function raster(uint256 seed, uint256 tracks, uint16 mask) external pure returns (bytes memory) {
        return CDArt.raster(seed, tracks, mask);
    }

    function svg(uint256 tokenId, uint256[] memory frameIds, bytes memory label, uint16 mask)
        external
        pure
        returns (bytes memory)
    {
        return CDArt.svg(tokenId, frameIds, label, mask);
    }
}

contract CDArtTest is Test {
    CDArtHarness harness;

    function setUp() public {
        harness = new CDArtHarness();
    }

    function testGoldenSingle() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1204;
        _golden(
            "single",
            42,
            ids,
            "first paint",
            0x0060,
            0x818c3eb8155f40eac866389e048d85034106e898a1fa36b821593f723033a0f4,
            0xde504b68fe4b595250783f7d7380994271b4e1fda35c0c25c724078ff1198640
        );
    }

    function testGoldenEp() public {
        uint256[] memory ids = new uint256[](4);
        ids[0] = 88;
        ids[1] = 1204;
        ids[2] = 5;
        ids[3] = 77;
        _golden(
            "ep",
            7,
            ids,
            "gm tracks",
            0x2570,
            0xd75d0c753f43324ac3cf6330997befbae004bc6ea1f87d09a93263802079ba75,
            0x8e5b9420c58a79a62ebec1aff51a3258e9423d9d177b23748180fc6dc071968f
        );
    }

    function testGoldenAlbum() public {
        uint256[] memory ids = new uint256[](7);
        ids[0] = 3;
        ids[1] = 9;
        ids[2] = 27;
        ids[3] = 81;
        ids[4] = 243;
        ids[5] = 729;
        ids[6] = 2187;
        _golden(
            "album",
            213,
            ids,
            "summer mix & more",
            0x7920,
            0xe2e53dd35f3fc8cef836f7e2f5c2288385bcc6c15b37a4e0b12762c5c9db3ab7,
            0x9a8e74eddeae86efcdf1fbf209b5af3a04407a606f9b1d2cc160925ef0d7445d
        );
    }

    function testGoldenFullLength() public {
        uint256[] memory ids = new uint256[](12);
        for (uint256 i; i < 12; ++i) ids[i] = (i + 1) * 11;
        _golden(
            "full length",
            1205,
            ids,
            "storm chasers",
            0x7f70,
            0xdbef0896bf7c39547bc98acb85bbb92bcec89d36e5bc3e97dca6c169e5856b36,
            0xb74f87fdeebce60b6b8bad8f2f5875684a54c7ececc8b052ce12c0392aaee2fc
        );
    }

    function testGoldenPlainSilver() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 500;
        ids[1] = 501;
        _golden(
            "plain silver",
            12345,
            ids,
            "b&w only",
            0x0000,
            0x96b2de8b224bbadecc868a9b590d63be8e45aac8c5bc7cbd51e3f62aa3615838,
            0x4ef79ac6434646ddfcc8dbd347ec5781f7615c779dc13c6064cd89ec9ad0d95a
        );
    }

    function testGoldenOneColour() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 9;
        _golden(
            "one colour",
            3,
            ids,
            "all green",
            0x0100,
            0x796dfc178a1b46e14086e612a5c437f9ba966004e43fdfcddab0a65132ccde2d,
            0x268f8d4f2aa8c77029f0f005299f51da692776c19ecfdfc2d1f269fa78dc7dbc
        );
    }

    function _golden(
        string memory name,
        uint256 tokenId,
        uint256[] memory frameIds,
        string memory label,
        uint16 mask,
        bytes32 svgHash,
        bytes32 rasterHash
    ) private {
        uint256 seed = uint256(keccak256(abi.encode(tokenId, frameIds)));
        bytes memory raster = harness.raster(seed, frameIds.length, mask);
        bytes memory svg = harness.svg(tokenId, frameIds, bytes(label), mask);
        assertEq(keccak256(raster), rasterHash);
        assertEq(keccak256(svg), svgHash);
        vm.createDir("test-output", true);
        vm.writeFile(string.concat("test-output/cd-", name, ".svg"), string(svg));
    }
}
