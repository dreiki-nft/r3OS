// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "solady/utils/Base64.sol";
import {DynamicBufferLib} from "solady/utils/DynamicBufferLib.sol";
import {LibString} from "solady/utils/LibString.sol";
import {Bmp64} from "./Bmp64.sol";
import {DF1} from "./DF1.sol";

/// @notice Fully onchain generative art for the soulbound r3 painter pass.
/// @dev Ported byte-for-byte from scripts/pass-art-reference.mjs.
library PassArt {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;

    struct Params {
        address owner;
        uint256 tokenId;
        uint256 pixels;
        uint256 frames;
        uint256 days_;
        uint256 stormPaints;
        uint256 firstPaintBlock;
        bool holder;
        uint256 pinCount;
        uint256 pinMask;
    }

    uint256 internal constant MAX_PINS = 16;
    uint256 private constant W = 64;
    uint256 private constant N = 16;
    uint256 private constant H = 8;
    uint256 private constant CELL = 3;
    uint256 private constant X0 = 8;
    uint256 private constant Y0 = 5;
    uint256 private constant BOX = N * CELL;

    function df1Params(Params memory p) internal pure returns (uint32 seed, uint256 amount) {
        seed = uint32(p.firstPaintBlock);
        amount = 20 + 15 * _log2(p.stormPaints + 1);
        if (amount > 200) amount = 200;
    }

    function svg(Params memory p) internal pure returns (bytes memory) {
        uint256 seed = uint256(keccak256(abi.encode(p.owner, p.tokenId)));
        uint8[3] memory tones = _tones(seed);
        uint8[128] memory grid = _grid(seed, p.pixels, tones);
        uint8[16] memory shiftOf = _stormShifts(seed, p.stormPaints);
        bytes memory grey = _raster(seed, p.frames, grid, shiftOf);
        bytes memory rgb = _rgb(grey, p.holder);
        (uint32 df1Seed, uint256 amount) = df1Params(p);
        string memory image = Base64.encode(Bmp64.encode(DF1.applyDf1(rgb, df1Seed, amount)));

        bytes memory ink = p.holder ? bytes("#0b0b0c") : bytes("#f2efe9");
        bytes memory dim = p.holder ? bytes("#a3a09a") : bytes("#3d3d44");
        bytes memory border = p.holder ? bytes("#0b0b0c") : bytes("#3d3d44");
        DynamicBufferLib.DynamicBuffer memory out = DynamicBufferLib.p();
        out = out.reserve(20_000);
        out = out.p(
            bytes(
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" shape-rendering="crispEdges">'
            )
        );
        out = out.p(
            bytes('<image width="512" height="512" style="image-rendering:pixelated" href="data:image/bmp;base64,'),
            bytes(image),
            bytes('"/>')
        );
        out = out.p(bytes('<rect x="12.5" y="12.5" width="487" height="487" fill="none" stroke="'));
        out = out.p(border, bytes('"/>'));

        uint256 paintedDays = p.days_ < 30 ? p.days_ : 30;
        for (uint256 d; d < 30; ++d) {
            out = out.p(
                bytes('<rect x="'),
                bytes(LibString.toString(64 + (d * 64) / 5)),
                bytes('" y="436" width="8" height="4" fill="')
            );
            out = out.p(d < paintedDays ? ink : dim, bytes('"/>'));
        }

        uint256 pinCount = p.pinCount < MAX_PINS ? p.pinCount : MAX_PINS;
        for (uint256 i; i < pinCount; ++i) {
            uint256 x = 64 + i * 22;
            if (((p.pinMask >> i) & 1) != 0) {
                out = out.p(
                    bytes('<rect x="'),
                    bytes(LibString.toString(x)),
                    bytes('" y="450" width="14" height="14" fill="')
                );
                out = out.p(ink, bytes('"/>'));
            } else {
                out = out.p(
                    bytes('<rect x="'),
                    bytes(LibString.toString(x)),
                    bytes('.5" y="450.5" width="13" height="13" fill="none" stroke="')
                );
                out = out.p(dim, bytes('"/>'));
            }
        }

        out = out.p(bytes('<text x="24" y="490" font-family="monospace" font-size="14" fill="'));
        out = out.p(ink, bytes('">r3 pass</text>'));
        out = out.p(
            bytes('<text x="488" y="490" font-family="monospace" font-size="12" fill="#6b6b73" text-anchor="end">#'),
            _tokenNumber(p.tokenId),
            bytes('</text></svg>')
        );
        return out.data;
    }

    function _tones(uint256 seed) private pure returns (uint8[3] memory tone) {
        uint8[4] memory pool = [uint8(224), uint8(192), uint8(160), uint8(128)];
        uint256 poolLength = 4;
        tone[0] = 255;
        for (uint256 k; k < 2; ++k) {
            uint256 j = _h(seed, "cw", k) % poolLength;
            tone[k + 1] = pool[j];
            for (uint256 n = j; n + 1 < poolLength; ++n) pool[n] = pool[n + 1];
            --poolLength;
        }
    }

    function _grid(uint256 seed, uint256 pixels, uint8[3] memory tone)
        private
        pure
        returns (uint8[128] memory grid)
    {
        uint256 density = 14 + 3 * _log2(pixels + 1);
        if (density > 60) density = 60;
        for (uint256 y; y < N; ++y) {
            for (uint256 x; x < H; ++x) {
                uint256 v = _h(seed, "c", y * H + x);
                if (v % 100 < density) {
                    uint256 t = (v >> 8) % 4;
                    grid[y * H + x] = tone[t < 2 ? 0 : t - 1];
                }
            }
        }
    }

    function _stormShifts(uint256 seed, uint256 stormPaints)
        private
        pure
        returns (uint8[16] memory shiftOf)
    {
        uint256 rows = _log2(stormPaints + 1) + (stormPaints > 0 ? 1 : 0);
        if (rows > 4) rows = 4;
        for (uint256 k; k < rows; ++k) {
            uint256 row = _h(seed, "g", k) % N;
            shiftOf[row] = uint8(2 + _h(seed, "gs", k) % 4);
        }
    }

    function _raster(uint256 seed, uint256 frames, uint8[128] memory grid, uint8[16] memory shiftOf)
        private
        pure
        returns (bytes memory g)
    {
        g = new bytes(W * W);
        for (uint256 y; y < N; ++y) {
            uint256 shift = shiftOf[y];
            for (uint256 py = Y0 + y * CELL; py < Y0 + y * CELL + CELL; ++py) {
                if (shift != 0) {
                    uint256 rowStart = py * W;
                    for (uint256 x; x < W; ++x) g[rowStart + x] = bytes1(uint8(56));
                }
                for (uint256 bx; bx < BOX; ++bx) {
                    uint256 x = bx / CELL;
                    uint8 c = x < H ? grid[y * H + x] : grid[y * H + (N - 1 - x)];
                    if (c != 0) g[py * W + X0 + ((bx + shift) % BOX)] = bytes1(c);
                }
            }
        }

        uint256 sparks = frames < 8 ? frames : 8;
        for (uint256 k; k < sparks; ++k) {
            uint256 i = _h(seed, "s", k) % 128;
            uint256 y = i / H;
            uint256 x = i % H;
            if (grid[y * H + x] != 0) continue;
            uint256 row = (Y0 + y * CELL + 1) * W + X0 + 1;
            g[row + x * CELL] = 0xff;
            g[row + (N - 1 - x) * CELL] = 0xff;
        }
    }

    function _rgb(bytes memory grey, bool holder) private pure returns (bytes memory rgb) {
        rgb = new bytes(W * W * 3);
        assembly ("memory-safe") {
            let gp := add(grey, 0x20)
            let rp := add(rgb, 0x20)
            for { let i := 0 } lt(i, 4096) { i := add(i, 1) } {
                let v := byte(0, mload(add(gp, i)))
                if holder { v := sub(255, v) }
                let d := add(rp, mul(i, 3))
                mstore8(d, v)
                mstore8(add(d, 1), v)
                mstore8(add(d, 2), v)
            }
        }
    }

    function _tokenNumber(uint256 tokenId) private pure returns (bytes memory) {
        bytes memory n = bytes(LibString.toString(tokenId));
        if (n.length >= 4) return n;
        if (n.length == 3) return abi.encodePacked("0", n);
        if (n.length == 2) return abi.encodePacked("00", n);
        return abi.encodePacked("000", n);
    }

    function _h(uint256 seed, string memory tag, uint256 i) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(seed, tag, i)));
    }

    function _log2(uint256 x) private pure returns (uint256 n) {
        while (x > 1) {
            x >>= 1;
            ++n;
        }
    }
}
