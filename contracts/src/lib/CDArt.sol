// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "solady/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {BmpN} from "./BmpN.sol";

/// @notice Byte-exact Solidity port of scripts/cd-art-reference.mjs.
library CDArt {
    using Strings for uint256;

    uint16 internal constant DISC_MASK = 0x7f70;

    uint256 private constant R4 = 2798;
    uint256 private constant RIM4 = 2591;
    uint256 private constant HOLE4 = 41;
    uint256 private constant HOLERING4 = 67;
    uint256 private constant HUB4 = 231;
    uint256 private constant HUBRING4 = 282;
    uint256 private constant CLEAR4 = 339;
    uint256 private constant SPAN4 = R4 - CLEAR4;

    uint24 private constant C_HOLERING = 0x5a5a60;
    uint24 private constant C_HUB = 0xf6f6f8;
    uint24 private constant C_HUBRING = 0x96989e;
    uint24 private constant C_CLEAR = 0xd0d8de;
    uint24 private constant C_RIM = 0x4c4c52;
    uint24 private constant GLARE = 0xf2f3f6;
    uint24 private constant WHITE = 0xffffff;

    /// @notice 64*64*3 bytes, top-down RGB. Identical to reference raster(seed, tracks, mask).
    function raster(uint256 seed, uint256 tracks, uint16 mask) internal pure returns (bytes memory rgb) {
        uint24[10] memory stopRgb;
        uint32[10] memory stopHsv;
        uint256 stopCount;
        uint8[10] memory order = [uint8(4), 12, 5, 8, 11, 14, 10, 6, 13, 9];
        uint16 filtered = mask & DISC_MASK;
        unchecked {
            for (uint256 i; i < 10; ++i) {
                uint8 colour = order[i];
                if ((filtered & (uint16(1) << colour)) != 0) {
                    stopRgb[stopCount] = _palette(colour);
                    stopHsv[stopCount] = _hsvPacked(colour);
                    ++stopCount;
                }
            }
        }

        uint256 twistRaw = (seed & 0xffff) % 2869;
        uint256 phase = (seed >> 16) & 4095;
        uint256 sphase = (seed >> 28) & 4095;
        uint256 glintCount = 1 + tracks / 6;
        uint16[3] memory glints;
        unchecked {
            for (uint256 j; j < glintCount; ++j) glints[j] = uint16((seed >> (40 + 12 * j)) & 4095);
        }
        uint256 fanW = 1638 + 49 * tracks;
        uint24 bg = _background(tracks);
        rgb = new bytes(64 * 64 * 3);

        unchecked {
            uint256 dst;
            for (uint256 y; y < 64; ++y) {
                for (uint256 x; x < 64; ++x) {
                    // The disc is point-symmetric around (32, 29.5): pixel (x, y) and (63 - x, 58 - y) share d4 and
                    // their angles differ by exactly half a turn, so the second half is copied, not recomputed.
                    if ((y > 29 && y <= 58) || (y == 29 && x >= 32)) {
                        assembly ("memory-safe") {
                            let base := add(rgb, 0x20)
                            let src := add(base, mul(add(mul(sub(58, y), 64), sub(63, x)), 3))
                            let p := add(base, dst)
                            mstore8(p, byte(0, mload(src)))
                            mstore8(add(p, 1), byte(1, mload(src)))
                            mstore8(add(p, 2), byte(2, mload(src)))
                        }
                        dst += 3;
                        continue;
                    }
                    int256 px = int256(2 * x + 1) - 64;
                    int256 py = int256(2 * y) - 58;
                    uint256 d4 = uint256(px * px + py * py);
                    uint24 c;

                    if (d4 > R4 || d4 < HOLE4) c = bg;
                    else if (d4 < HOLERING4) c = C_HOLERING;
                    else if (d4 < HUB4) c = C_HUB;
                    else if (d4 < HUBRING4) c = C_HUBRING;
                    else if (d4 < CLEAR4) c = C_CLEAR;
                    else if (d4 >= RIM4) c = C_RIM;
                    else {
                        uint256 u0 = _angle(px, py) % 4096;
                        uint256 dd = _min(d4 - CLEAR4, SPAN4);
                        uint256 u;
                        if (twistRaw >= 1434) {
                            u = (u0 + ((twistRaw - 1434) * dd) / SPAN4 + phase) % 4096;
                        } else {
                            u = (u0 + 4096 - ((1434 - twistRaw) * dd) / SPAN4 + phase) % 4096;
                        }

                        uint256 w = (2 * u + sphase) % 4096;
                        uint256 distance = w >= 2048 ? w - 2048 : 2048 - w;
                        uint256 s12 = _smooth(2 * distance);
                        uint256 k = s12 * 3;
                        uint256 silverIndex = _min(k / 4096, 2);
                        c = _lerp(_silver(silverIndex), _silver(silverIndex + 1), k - silverIndex * 4096);

                        if (stopCount != 0) {
                            uint256 f = (u + 4096 - 737) % 4096;
                            if (f < fanW) {
                                uint24 col;
                                if (stopCount == 1) {
                                    col = stopRgb[0];
                                } else {
                                    uint256 kk = f * (stopCount - 1);
                                    uint256 si = kk / fanW;
                                    uint256 t = ((kk - si * fanW) * 4096) / fanW;
                                    col = _hsvLerp(stopHsv[si], stopHsv[si + 1], _smooth(t));
                                }
                                uint256 e = _min(f, fanW - f);
                                uint256 te = _min(4096, (e * 4096 * 25) / (fanW * 3));
                                c = _lerp(_lerp(c, GLARE, 2867), col, _smooth(te));
                            }
                        }

                        for (uint256 j; j < glintCount; ++j) {
                            uint256 g = glints[j];
                            uint256 a = u >= g ? u - g : g - u;
                            uint256 dist = _min(a, 4096 - a);
                            if (dist < 123) c = _lerp(c, WHITE, _smooth(((123 - dist) * 4096) / 123));
                        }
                    }

                    assembly ("memory-safe") {
                        let p := add(add(rgb, 0x20), dst)
                        mstore8(p, shr(16, c))
                        mstore8(add(p, 1), shr(8, c))
                        mstore8(add(p, 2), c)
                    }
                    dst += 3;
                }
            }
        }
    }

    /// @notice Identical to reference svg({ tokenId, frameIds, label, mask }).
    function svg(uint256 tokenId, uint256[] memory frameIds, bytes memory label, uint16 mask)
        internal
        pure
        returns (bytes memory)
    {
        uint256 tracks = frameIds.length;
        uint256 seed = uint256(keccak256(abi.encode(tokenId, frameIds)));
        bytes memory image = bytes(Base64.encode(BmpN.encode(raster(seed, tracks, mask & DISC_MASK), 64)));
        string memory ink;
        string memory dim;
        if (tracks <= 4) {
            ink = "#111111";
            dim = "#8a877f";
        } else if (tracks <= 8) {
            ink = "#111111";
            dim = "#5b5b5b";
        } else {
            ink = "#f2efe9";
            dim = "#bfe3e3";
        }
        bytes memory escaped = _escapeAmp(label);
        string memory trackWord = tracks == 1 ? "track" : "tracks";

        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" shape-rendering="crispEdges">',
            '<image width="512" height="512" style="image-rendering:pixelated" href="data:image/bmp;base64,',
            image,
            '"/>',
            '<rect x="12.5" y="12.5" width="487" height="487" fill="none" stroke="',
            dim,
            '"/>',
            '<text x="24" y="470" font-family="monospace" font-size="14" fill="',
            ink,
            '">',
            escaped,
            '</text>',
            unicode"<text x=\"24\" y=\"492\" font-family=\"monospace\" font-size=\"12\" fill=\"",
            dim,
            unicode"\">cd-r · ",
            tracks.toString(),
            " ",
            trackWord,
            unicode" · ",
            _formatName(tracks),
            '</text>',
            '<text x="488" y="492" font-family="monospace" font-size="12" fill="',
            dim,
            '" text-anchor="end">#',
            _pad4(tokenId),
            '</text></svg>'
        );
    }

    function _background(uint256 tracks) private pure returns (uint24) {
        if (tracks <= 4) return 0xf2efe9;
        if (tracks <= 8) return 0xc0c0c0;
        return 0x008080;
    }

    function _silver(uint256 index) private pure returns (uint24) {
        if (index == 0) return 0x7e7e84;
        if (index == 1) return 0xacaeb4;
        if (index == 2) return 0xd8dae0;
        return 0xf0f1f4;
    }

    function _palette(uint8 index) private pure returns (uint24) {
        if (index == 4) return 0xc52020;
        if (index == 5) return 0xfec343;
        if (index == 6) return 0xee93e3;
        if (index == 8) return 0x07992f;
        if (index == 9) return 0xa0055d;
        if (index == 10) return 0x694b87;
        if (index == 11) return 0x5feddf;
        if (index == 12) return 0xf7931a;
        if (index == 13) return 0xc864aa;
        if (index == 14) return 0x9f70da;
        return 0;
    }

    function _hsvPacked(uint8 index) private pure returns (uint32) {
        if (index == 4) return uint32((0 << 16) | (213 << 8) | 197);
        if (index == 5) return uint32((175 << 16) | (187 << 8) | 254);
        if (index == 6) return uint32((1311 << 16) | (97 << 8) | 238);
        if (index == 8) return uint32((582 << 16) | (243 << 8) | 153);
        if (index == 9) return uint32((1391 << 16) | (247 << 8) | 160);
        if (index == 10) return uint32((1152 << 16) | (113 << 8) | 135);
        if (index == 11) return uint32((742 << 16) | (152 << 8) | 237);
        if (index == 12) return uint32((140 << 16) | (228 << 8) | 247);
        if (index == 13) return uint32((1357 << 16) | (127 << 8) | 200);
        if (index == 14) return uint32((1137 << 16) | (123 << 8) | 218);
        return 0;
    }

    function _lerp1(uint256 a, uint256 b, uint256 t) private pure returns (uint256) {
        unchecked {
            return (a * (4096 - t) + b * t + 2048) / 4096;
        }
    }

    function _lerp(uint24 a, uint24 b, uint256 t) private pure returns (uint24) {
        unchecked {
            uint256 r = _lerp1(uint8(a >> 16), uint8(b >> 16), t);
            uint256 g = _lerp1(uint8(a >> 8), uint8(b >> 8), t);
            uint256 bl = _lerp1(uint8(a), uint8(b), t);
            return uint24((r << 16) | (g << 8) | bl);
        }
    }

    function _smooth(uint256 t) private pure returns (uint256) {
        unchecked {
            return (t * t * (12288 - 2 * t)) / 16_777_216;
        }
    }

    function _oct(uint256 t) private pure returns (uint256) {
        unchecked {
            return t / 4 + (356 * t * (4096 - t)) / 16_777_216;
        }
    }

    function _angle(int256 px, int256 py) private pure returns (uint256) {
        unchecked {
            uint256 ax = uint256(px < 0 ? -px : px);
            uint256 ay = uint256(py < 0 ? -py : py);
            uint256 a = ax >= ay ? _oct((ay * 4096) / ax) : 2048 - _oct((ax * 4096) / ay);
            if (px < 0) a = 4096 - a;
            if (py < 0) a = 8192 - a;
            return a;
        }
    }

    function _fromHsv(uint256 h, uint256 s, uint256 v) private pure returns (uint24) {
        unchecked {
            uint256 sector = h / 256;
            uint256 f = h % 256;
            uint256 p = (v * (255 - s)) / 255;
            uint256 q = (v * (65_280 - s * f)) / 65_280;
            uint256 t = (v * (65_280 - s * (256 - f))) / 65_280;
            if (sector == 0) return _rgb(v, t, p);
            if (sector == 1) return _rgb(q, v, p);
            if (sector == 2) return _rgb(p, v, t);
            if (sector == 3) return _rgb(p, q, v);
            if (sector == 4) return _rgb(t, p, v);
            return _rgb(v, p, q);
        }
    }

    function _hsvLerp(uint32 a, uint32 b, uint256 t) private pure returns (uint24) {
        unchecked {
            uint256 ha = a >> 16;
            uint256 sa = (a >> 8) & 0xff;
            uint256 va = a & 0xff;
            uint256 hb = b >> 16;
            uint256 sb = (b >> 8) & 0xff;
            uint256 vb = b & 0xff;
            uint256 h;
            if (hb >= ha) {
                uint256 d = hb - ha;
                h = d <= 768 ? ha + (d * t) / 4096 : ha + 1536 - ((1536 - d) * t) / 4096;
            } else {
                uint256 d = ha - hb;
                h = d <= 768 ? ha + 1536 - (d * t) / 4096 : ha + ((1536 - d) * t) / 4096;
            }
            return _fromHsv(h % 1536, _lerp1(sa, sb, t), _lerp1(va, vb, t));
        }
    }

    function _rgb(uint256 r, uint256 g, uint256 b) private pure returns (uint24) {
        return uint24((r << 16) | (g << 8) | b);
    }

    function _formatName(uint256 tracks) private pure returns (string memory) {
        if (tracks == 1) return "single";
        if (tracks <= 4) return "ep";
        if (tracks <= 8) return "album";
        return "full length";
    }

    function _escapeAmp(bytes memory label) private pure returns (bytes memory out) {
        uint256 ampersands;
        for (uint256 i; i < label.length; ++i) {
            if (label[i] == 0x26) ++ampersands;
        }
        if (ampersands == 0) return label;
        out = new bytes(label.length + ampersands * 4);
        uint256 j;
        for (uint256 i; i < label.length; ++i) {
            if (label[i] == 0x26) {
                out[j++] = 0x26;
                out[j++] = 0x61;
                out[j++] = 0x6d;
                out[j++] = 0x70;
                out[j++] = 0x3b;
            } else {
                out[j++] = label[i];
            }
        }
    }

    function _pad4(uint256 value) private pure returns (string memory) {
        string memory raw = value.toString();
        uint256 length = bytes(raw).length;
        if (length >= 4) return raw;
        if (length == 3) return string.concat("0", raw);
        if (length == 2) return string.concat("00", raw);
        return string.concat("000", raw);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        unchecked {
            return a < b ? a : b;
        }
    }
}
