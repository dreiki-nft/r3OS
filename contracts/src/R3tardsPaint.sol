// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title r3tards paint
/// @notice One infinite, shared, fully onchain 256x256 painting on Monad.
/// @dev
/// - editable background: 256x256, 16 colors, 4 bits per pixel
/// - immutable r3tard outline layer rendered on top in black
/// - mutable r3tard face-fill layer rendered under the outline, binary only:
///   white or black
/// - DF1 still corrupts the final saved output based on Monad base fee
/// - every mint saves a new state and mints the next ERC-721 receipt NFT
contract R3tardsPaint is ERC721 {
    using Strings for uint256;

    // ---------------------------------------------------------------------
    // Canvas constants
    // ---------------------------------------------------------------------

    uint256 public constant WIDTH = 256;
    uint256 public constant HEIGHT = 256;
    uint256 public constant PALETTE_SIZE = 16;

    uint256 public constant BITS_PER_PIXEL = 4;
    uint256 public constant PIXELS_PER_SLOT = 64;
    uint256 public constant SLOTS_PER_ROW = 4;
    uint256 public constant CANVAS_SLOT_COUNT = 1_024;
    uint256 public constant CANVAS_BYTE_LENGTH = 32_768;
    uint256 public constant MIP8_PAGE_SLOTS = 128;
    uint256 public constant MIP8_PAGE_COUNT = 8;

    uint256 public constant MASK_SLOT_COUNT = 256;
    uint256 public constant MASK_PAGE_COUNT = 2;

    /// @notice Background canvas aligned to an eight-page boundary.
    uint256 public constant CANVAS_BASE_SLOT =
        uint256(keccak256("r3tards.paint.canvas.v2")) & ~uint256(127);

    /// @notice Immutable outline mask: one 256-bit row per slot.
    uint256 public constant OUTLINE_BASE_SLOT =
        uint256(keccak256("r3tards.paint.outline.v2")) & ~uint256(127);

    /// @notice Mutable face-fill mask: one 256-bit row per slot.
    uint256 public constant FACE_MASK_BASE_SLOT =
        uint256(keccak256("r3tards.paint.face-mask.v2")) & ~uint256(127);

    /// @notice A mint can intentionally touch the whole 256x256 editable background once.
    uint256 public constant MAX_PIXEL_WRITES_PER_MINT = 65_536;

    /// @notice Monad's documented minimum base fee used as DF1's quiet-network floor.
    uint256 public constant DF1_BASE_FEE_FLOOR = 100 gwei;

    /// @notice Face is binary by design.
    uint8 public constant FACE_WHITE = 0;
    uint8 public constant FACE_BLACK = 1;

    bytes4 private constant _ERC4906_INTERFACE_ID = 0x49064906;

    // BMP: 14 file header + 40 info header + 16*4 palette + pixel bytes.
    uint256 private constant _BMP_FILE_HEADER_SIZE = 14;
    uint256 private constant _BMP_INFO_HEADER_SIZE = 40;
    uint256 private constant _BMP_PALETTE_SIZE = 64;
    uint256 private constant _BMP_PIXEL_OFFSET = 118;
    uint256 private constant _BMP_FILE_SIZE = _BMP_PIXEL_OFFSET + CANVAS_BYTE_LENGTH;

    /// @dev Packed [y, xStart, xEnd] triples describing the immutable linework.
    bytes private constant _OUTLINE_RUNS = hex"5a70735b6d775c69795d5c7a5e587b5f55705f747c60546d60777d61526961787e62505b62797f634f58637b80644e56647b81654d54657c82664d52667d8166929f674c51677e816790a3684c50685364688ea9694b6a698dba6a4b6d6a8cbd6b4a706b8b926b9fbf6c49726c8a906ca3c06d47536d64736d898f6d91946da9c26e464e6e6a756e899a6ebac36f45536f6d766f889e6fbdc47044597070777088a270bec471435e7171787187a571c0c3723e617273797287907294a9733c6473747a73868d739aae743b4a74546874757b74858b749eb4753a4b75596b75767c75858a75a2bb763a4c76596e76777c76848976a5c177393e77474c77587177787d77848877a9c578393d78484c78587478797d78838878aec779383d79484d79587779797e79838779b5c97a383c7a494d7a587e7a82877a90987abbca7b383c7b494d7b586c7b6e7e7b82867b89a17bc2cb7c373c7c494e7c586c7c717e7c82a87cbbcd7d373b7d4a4f7d586c7d747e7d82ce7e373b7e4a517e586b7e777e7e82cf7f373b7f4b6b7f797e7f82d080383c804c6a807a7e8082898090d081383d814d6a81797e818286818fa481a8bb81c6d1823840824e6982797d828286828fa582c5d2833942835159835c6883787d838286838fa583c3d2843943845e6984787d848287848fa584c2ca84ced3853a4485606f85777c858387858ea585c1c885cfd4863d4586617c868387868fa586bfc786d0d4873e4587637f878387878fa487bec587d0d5883d46886681888387888fa488bcc488d1d5893b46896987898da389bbc389d1d68a3a478a6fa38ab9c18ad2d68b39408b43488b7ca78bb7c08bd2d68c383f8c43498c7fab8cb4be8cc8c98cd2d68d373d8d444a8d81948d9abd8dc7cb8dd2d68e373c8e454b8e848d8ea0bb8ec7cb8ed2d68f363b8f464c8fa3b98fc6cb8fd1d690363a90474e90a7b790c4ca90d1d591353a91485391abb491c3c991d0d592353992496492c0c992cfd4933539934a6993bdc893cfd4943539944c6c94bbc694cfd3953539954f6e95b9c595ced296353996537096b7c396ced297353997657297b5c097ced298353998697598b4bd98ced2993539996c77998f9999b3bb99ced29a35399a6e7a9a8c9d9ab2b99aced29b353a9b70809b879f9bb0b79bced29c363b9c72a19cafb69ccdd29d363d9d75a39dadb59dcdd19e373f9e778f9e99a79eaab39ecdd19f38409f7b8c9f9db29fccd1a03941a08187a09fb1a0cbd1a13b41a1a1afa1cad0a23d42a2a3aea2c8cfa33e42a3a8a9a3c6cfa43e43a4c3cda53f43a5c1cca63f43a6bfcaa73f44a7bdc8a84044a8bcc6a94044a9a1a2a9bbc3aa4045aa666daa9da7aabac1ab4146ab626fab9bababb9bfac4146ac5f70ac9aacacb8bead4247ad5d71ad98aeadb7bdae4249ae5b72ae96a0aea3bcaf434daf5865af6d73af949dafa7bbb04462b06e74b0929cb0aabab1455fb16f74b18f9ab1acb9b2475db27075b28c98b2aeb7b34a5bb37176b38896b3b3b4b44e58b47178b48494b57292b6738fb7748cb87688b97783";

    /// @dev Packed [y, xStart, xEnd] triples describing the protected face fill.
    bytes private constant _FACE_RUNS = hex"";

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct MintInfo {
        address painter;
        uint64 blockNumber;
        uint96 baseFee;
        uint32 pixelWrites;
        uint8 df1Level;
        uint8 intendedFaceColor;
        uint8 finalFaceColor;
        bytes32 seed;
    }

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error UnsupportedChain(uint256 chainId);
    error EmptyPatch();
    error InvalidPatchLength();
    error InvalidRun(uint256 runIndex, uint256 y, uint256 xStart, uint256 xEnd);
    error InvalidColor(uint256 runIndex, uint256 colorIndex);
    error InvalidFaceColor(uint256 colorIndex);
    error TooManyPixelWrites(uint256 requested, uint256 maximum);
    error PixelOutOfBounds(uint256 x, uint256 y);
    error PaletteIndexOutOfBounds(uint256 index);

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Painted(
        uint256 indexed tokenId,
        address indexed painter,
        uint256 indexed blockNumber,
        uint256 baseFee,
        uint8 df1Level,
        uint8 intendedFaceColor,
        uint8 finalFaceColor,
        bytes32 seed,
        uint256 pixelWrites,
        bytes runs
    );

    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    uint256 public totalMints;
    uint8 public faceColorIndex;

    mapping(uint256 tokenId => MintInfo info) public mintInfo;

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() ERC721("r3tards paint", "R3PAINT") {
        if (block.chainid != 143 && block.chainid != 10_143 && block.chainid != 31_337) {
            revert UnsupportedChain(block.chainid);
        }

        faceColorIndex = FACE_BLACK;
        _seedMaskBitmap(OUTLINE_BASE_SLOT, _OUTLINE_RUNS);
    }

    // ---------------------------------------------------------------------
    // Mint + mutate
    // ---------------------------------------------------------------------

    /// @notice Commit intended Paint output and mint the next NFT.
    /// @param runs Packed 4-byte horizontal runs: [y, xStart, xEnd, color].
    /// xEnd is inclusive. Color must be 0..15.
    /// @param intendedFaceColor 0 = white, 1 = black.
    function paintAndMint(bytes calldata runs, uint8 intendedFaceColor) external returns (uint256 tokenId) {
        if (intendedFaceColor > FACE_BLACK) revert InvalidFaceColor(intendedFaceColor);

        uint256 pixelWrites = _validateRuns(runs);
        if (pixelWrites == 0 && intendedFaceColor == faceColorIndex) revert EmptyPatch();

        tokenId = totalMints + 1;
        MintInfo memory info = _buildMintInfo(tokenId, pixelWrites, runs, intendedFaceColor);
        uint8 finalFaceColor = _df1FaceColor(intendedFaceColor, info.df1Level, info.seed, pixelWrites);

        _applyRuns(runs, info.df1Level, info.seed);
        faceColorIndex = finalFaceColor;

        info.finalFaceColor = finalFaceColor;
        totalMints = tokenId;
        mintInfo[tokenId] = info;

        _mint(msg.sender, tokenId);
        _emitPainted(tokenId, info, runs);

        emit BatchMetadataUpdate(1, tokenId);
    }

    function _validateRuns(bytes calldata runs) internal pure returns (uint256 pixelWrites) {
        uint256 length = runs.length;
        if (length == 0) return 0;
        if (length % 4 != 0) revert InvalidPatchLength();

        uint256 runCount = length / 4;
        for (uint256 i; i < runCount; ++i) {
            uint256 offset = i * 4;
            uint256 y = uint8(runs[offset]);
            uint256 xStart = uint8(runs[offset + 1]);
            uint256 xEnd = uint8(runs[offset + 2]);
            uint256 color = uint8(runs[offset + 3]);

            if (xStart > xEnd || y >= HEIGHT || xEnd >= WIDTH) {
                revert InvalidRun(i, y, xStart, xEnd);
            }
            if (color >= PALETTE_SIZE) revert InvalidColor(i, color);

            pixelWrites += (xEnd - xStart) + 1;
            if (pixelWrites > MAX_PIXEL_WRITES_PER_MINT) {
                revert TooManyPixelWrites(pixelWrites, MAX_PIXEL_WRITES_PER_MINT);
            }
        }
    }

    function _buildMintInfo(
        uint256 tokenId,
        uint256 pixelWrites,
        bytes calldata runs,
        uint8 intendedFaceColor
    ) internal view returns (MintInfo memory info) {
        uint8 df1 = df1LevelForBaseFee(block.basefee);
        bytes32 seed = keccak256(
            abi.encodePacked(
                block.prevrandao,
                block.number,
                block.basefee,
                msg.sender,
                tokenId,
                intendedFaceColor,
                keccak256(runs)
            )
        );

        info = MintInfo({
            painter: msg.sender,
            blockNumber: uint64(block.number),
            baseFee: uint96(block.basefee),
            pixelWrites: uint32(pixelWrites),
            df1Level: df1,
            intendedFaceColor: intendedFaceColor,
            finalFaceColor: 0,
            seed: seed
        });
    }

    function _applyRuns(bytes calldata runs, uint8 df1, bytes32 seed) internal {
        uint256 runCount = runs.length / 4;
        uint256 nonce;

        for (uint256 i; i < runCount; ++i) {
            uint256 offset = i * 4;
            uint8 y = uint8(runs[offset]);
            uint8 xStart = uint8(runs[offset + 1]);
            uint8 xEnd = uint8(runs[offset + 2]);
            uint8 intendedColor = uint8(runs[offset + 3]);

            for (uint256 x = xStart; x <= xEnd; ++x) {
                if (_maskBitAt(OUTLINE_BASE_SLOT, x, y)) {
                    unchecked {
                        ++nonce;
                    }
                    continue;
                }

                uint8 finalColor = _df1Color(intendedColor, df1, seed, nonce);
                _writeBackgroundPixelRaw(uint8(x), y, finalColor);
                unchecked {
                    ++nonce;
                }
            }
        }
    }

    function _emitPainted(uint256 tokenId, MintInfo memory info, bytes calldata runs) internal {
        emit Painted(
            tokenId,
            info.painter,
            info.blockNumber,
            info.baseFee,
            info.df1Level,
            info.intendedFaceColor,
            info.finalFaceColor,
            info.seed,
            info.pixelWrites,
            runs
        );
    }

    // ---------------------------------------------------------------------
    // DF1: Monad network pressure -> deterministic palette corruption
    // ---------------------------------------------------------------------

    function df1LevelForBaseFee(uint256 baseFee) public pure returns (uint8) {
        uint256 floor = DF1_BASE_FEE_FLOOR;
        if (baseFee <= floor) return 0;

        uint256 lower = floor;
        uint256 upper = floor * 2;
        uint256 level;

        while (baseFee > upper && level < 80) {
            lower = upper;
            upper *= 2;
            level += 20;
        }

        if (baseFee >= floor * 32) return 100;

        uint256 interpolated = level + ((baseFee - lower) * 20) / (upper - lower);
        if (interpolated > 100) interpolated = 100;
        return uint8(interpolated);
    }

    function _df1Color(
        uint8 intendedColor,
        uint8 intensity,
        bytes32 seed,
        uint256 nonce
    ) internal pure returns (uint8) {
        if (intensity == 0) return intendedColor;

        uint24 rgb = _paletteColor(intendedColor);
        int256 r = int256(uint256(uint8(rgb >> 16)));
        int256 g = int256(uint256(uint8(rgb >> 8)));
        int256 b = int256(uint256(uint8(rgb)));

        uint256 random = uint256(keccak256(abi.encodePacked(seed, nonce)));
        uint256 replaceThreshold = (9_919 * uint256(intensity)) / 100;

        if ((random % 1_000_000) < replaceThreshold) {
            int256 rr = int256((random >> 32) & 0xff);
            int256 rg = int256((random >> 40) & 0xff);
            int256 rb = int256((random >> 48) & 0xff);

            r = r + ((rr - r) * int256(uint256(intensity))) / 100;
            g = g + ((rg - g) * int256(uint256(intensity))) / 100;
            b = b + ((rb - b) * int256(uint256(intensity))) / 100;
        } else {
            int256 dr = int256((random >> 64) % 51) - 25;
            int256 dg = int256((random >> 72) % 51) - 25;
            int256 db = int256((random >> 80) % 51) - 25;

            int256 scale = int256(uint256(intensity));
            r += (dr * scale) / 100;
            g += (dg * scale) / 100;
            b += (db * scale) / 100;
        }

        return _nearestPalette(_clamp8(r), _clamp8(g), _clamp8(b));
    }

    function _df1FaceColor(
        uint8 intendedFaceColor,
        uint8 intensity,
        bytes32 seed,
        uint256 nonce
    ) internal pure returns (uint8) {
        if (intensity == 0) return intendedFaceColor;

        uint24 rgb = _paletteColor(intendedFaceColor);
        int256 r = int256(uint256(uint8(rgb >> 16)));
        int256 g = int256(uint256(uint8(rgb >> 8)));
        int256 b = int256(uint256(uint8(rgb)));

        uint256 random = uint256(keccak256(abi.encodePacked(seed, nonce, uint256(0xface))));
        uint256 replaceThreshold = (9_919 * uint256(intensity)) / 100;

        if ((random % 1_000_000) < replaceThreshold) {
            int256 rr = int256((random >> 32) & 0xff);
            int256 rg = int256((random >> 40) & 0xff);
            int256 rb = int256((random >> 48) & 0xff);

            r = r + ((rr - r) * int256(uint256(intensity))) / 100;
            g = g + ((rg - g) * int256(uint256(intensity))) / 100;
            b = b + ((rb - b) * int256(uint256(intensity))) / 100;
        } else {
            int256 dr = int256((random >> 64) % 51) - 25;
            int256 dg = int256((random >> 72) % 51) - 25;
            int256 db = int256((random >> 80) % 51) - 25;

            int256 scale = int256(uint256(intensity));
            r += (dr * scale) / 100;
            g += (dg * scale) / 100;
            b += (db * scale) / 100;
        }

        return _nearestBinaryColor(_clamp8(r), _clamp8(g), _clamp8(b));
    }

    function _nearestBinaryColor(uint8 r, uint8 g, uint8 b) internal pure returns (uint8) {
        uint256 distanceToWhite = _rgbDistance(r, g, b, 255, 255, 255);
        uint256 distanceToBlack = _rgbDistance(r, g, b, 0, 0, 0);
        return distanceToBlack < distanceToWhite ? FACE_BLACK : FACE_WHITE;
    }

    function _rgbDistance(
        uint8 r,
        uint8 g,
        uint8 b,
        uint8 rr,
        uint8 rg,
        uint8 rb
    ) internal pure returns (uint256) {
        int256 dr = int256(uint256(r)) - int256(uint256(rr));
        int256 dg = int256(uint256(g)) - int256(uint256(rg));
        int256 db = int256(uint256(b)) - int256(uint256(rb));
        return uint256((dr * dr) + (dg * dg) + (db * db));
    }

    function _clamp8(int256 value) internal pure returns (uint8) {
        if (value <= 0) return 0;
        if (value >= 255) return 255;
        return uint8(uint256(value));
    }

    function _nearestPalette(uint8 r, uint8 g, uint8 b) internal pure returns (uint8 best) {
        uint256 bestDistance = type(uint256).max;

        for (uint8 i; i < PALETTE_SIZE; ++i) {
            uint24 candidate = _paletteColor(i);
            int256 cr = int256(uint256(uint8(candidate >> 16)));
            int256 cg = int256(uint256(uint8(candidate >> 8)));
            int256 cb = int256(uint256(uint8(candidate)));

            int256 dr = int256(uint256(r)) - cr;
            int256 dg = int256(uint256(g)) - cg;
            int256 db = int256(uint256(b)) - cb;

            uint256 distance = uint256((dr * dr) + (dg * dg) + (db * db));
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        }
    }

    // ---------------------------------------------------------------------
    // Palette
    // ---------------------------------------------------------------------

    function paletteColor(uint256 index) public pure returns (uint24) {
        if (index >= PALETTE_SIZE) revert PaletteIndexOutOfBounds(index);
        return _paletteColor(uint8(index));
    }

    function palette() external pure returns (uint24[16] memory colors) {
        for (uint8 i; i < PALETTE_SIZE; ++i) {
            colors[i] = _paletteColor(i);
        }
    }

    function _paletteColor(uint8 index) internal pure returns (uint24) {
        if (index == 0) return 0xFFFFFF;
        if (index == 1) return 0x000000;
        if (index == 2) return 0x965E4B;
        if (index == 3) return 0x877549;
        if (index == 4) return 0xC52020;
        if (index == 5) return 0xFEC343;
        if (index == 6) return 0xEE93E3;
        if (index == 7) return 0xE6A3C6;
        if (index == 8) return 0x07992F;
        if (index == 9) return 0xA0055D;
        if (index == 10) return 0x694B87;
        if (index == 11) return 0x5FEDDF;
        if (index == 12) return 0xF7931A;
        if (index == 13) return 0xC864AA;
        if (index == 14) return 0x9F70DA;
        return 0xD47827;
    }

    // ---------------------------------------------------------------------
    // Canvas views
    // ---------------------------------------------------------------------

    function pixelAt(uint256 x, uint256 y) public view returns (uint8 colorIndex) {
        if (x >= WIDTH || y >= HEIGHT) revert PixelOutOfBounds(x, y);
        colorIndex = _compositePixel(x, y);
    }

    function backgroundPixelAt(uint256 x, uint256 y) public view returns (uint8 colorIndex) {
        if (x >= WIDTH || y >= HEIGHT) revert PixelOutOfBounds(x, y);
        colorIndex = _backgroundPixelAt(x, y);
    }

    function getBackgroundCanvas() public view returns (bytes memory canvas) {
        canvas = new bytes(CANVAS_BYTE_LENGTH);
        uint256 base = CANVAS_BASE_SLOT;

        for (uint256 i; i < CANVAS_SLOT_COUNT; ++i) {
            uint256 word;
            assembly {
                word := sload(add(base, i))
            }

            uint256 offset = i * 32;
            assembly {
                mstore(add(add(canvas, 0x20), offset), word)
            }
        }
    }

    function getCanvas() public view returns (bytes memory canvas) {
        canvas = new bytes(CANVAS_BYTE_LENGTH);

        for (uint256 y; y < HEIGHT; ++y) {
            uint256[4] memory backgroundWords = _backgroundRowWords(y);
            uint256 outlineWord = _maskRowWord(OUTLINE_BASE_SLOT, y);
            uint256 rowOffset = y * 128;

            for (uint256 byteIndex; byteIndex < 128; ++byteIndex) {
                uint256 x = byteIndex * 2;
                uint8 left = _compositeColorFromWords(backgroundWords, outlineWord, x);
                uint8 right = _compositeColorFromWords(backgroundWords, outlineWord, x + 1);
                canvas[rowOffset + byteIndex] = bytes1((left << 4) | right);
            }
        }
    }

    function _compositePixel(uint256 x, uint256 y) internal view returns (uint8) {
        if (_maskBitAt(OUTLINE_BASE_SLOT, x, y)) return faceColorIndex;
        return _backgroundPixelAt(x, y);
    }

    function _compositeColorFromWords(
        uint256[4] memory backgroundWords,
        uint256 outlineWord,
        uint256 x
    ) internal pure returns (uint8) {
        uint256 bitShift = 255 - x;
        if (((outlineWord >> bitShift) & 1) == 1) return faceColorIndex;

        uint256 slotIndex = x / PIXELS_PER_SLOT;
        uint256 pixelInSlot = x % PIXELS_PER_SLOT;
        uint256 shift = 252 - (pixelInSlot * 4);
        return uint8((backgroundWords[slotIndex] >> shift) & 0x0f);
    }

    function _backgroundRowWords(uint256 y) internal view returns (uint256[4] memory words) {
        uint256 firstSlot = CANVAS_BASE_SLOT + (y * SLOTS_PER_ROW);
        assembly {
            mstore(words, sload(firstSlot))
            mstore(add(words, 0x20), sload(add(firstSlot, 1)))
            mstore(add(words, 0x40), sload(add(firstSlot, 2)))
            mstore(add(words, 0x60), sload(add(firstSlot, 3)))
        }
    }

    function _backgroundPixelAt(uint256 x, uint256 y) internal view returns (uint8 colorIndex) {
        uint256 slotIndex = (y * SLOTS_PER_ROW) + (x / PIXELS_PER_SLOT);
        uint256 pixelInSlot = x % PIXELS_PER_SLOT;
        uint256 shift = 252 - (pixelInSlot * 4);
        uint256 base = CANVAS_BASE_SLOT;
        uint256 word;

        assembly {
            word := sload(add(base, slotIndex))
        }

        colorIndex = uint8((word >> shift) & 0x0f);
    }

    function _writeBackgroundPixelRaw(uint8 x, uint8 y, uint8 colorIndex) internal {
        uint256 slotIndex = (uint256(y) * SLOTS_PER_ROW) + (uint256(x) / PIXELS_PER_SLOT);
        uint256 pixelInSlot = uint256(x) % PIXELS_PER_SLOT;
        uint256 shift = 252 - (pixelInSlot * 4);
        uint256 clearMask = ~(uint256(0x0f) << shift);
        uint256 colorBits = uint256(colorIndex) << shift;
        uint256 base = CANVAS_BASE_SLOT;

        assembly {
            let storageSlot := add(base, slotIndex)
            let word := sload(storageSlot)
            word := or(and(word, clearMask), colorBits)
            sstore(storageSlot, word)
        }
    }

    function _maskBitAt(uint256 base, uint256 x, uint256 y) internal view returns (bool bitSet) {
        uint256 word;
        assembly {
            word := sload(add(base, y))
        }
        bitSet = ((word >> (255 - x)) & 1) == 1;
    }

    function _maskRowWord(uint256 base, uint256 y) internal view returns (uint256 word) {
        assembly {
            word := sload(add(base, y))
        }
    }

    // ---------------------------------------------------------------------
    // Mask seeding
    // ---------------------------------------------------------------------

    function _seedMaskBitmap(uint256 base, bytes memory runs) internal {
        uint256 length = runs.length;
        if (length == 0) return;

        uint256 currentY = type(uint256).max;
        uint256 rowWord;

        for (uint256 offset; offset < length; offset += 3) {
            uint256 y = uint8(runs[offset]);
            uint256 xStart = uint8(runs[offset + 1]);
            uint256 xEnd = uint8(runs[offset + 2]);

            if (currentY == type(uint256).max) {
                currentY = y;
            } else if (y != currentY) {
                assembly {
                    sstore(add(base, currentY), rowWord)
                }
                currentY = y;
                rowWord = 0;
            }

            rowWord |= _rangeMask(xStart, xEnd);
        }

        assembly {
            sstore(add(base, currentY), rowWord)
        }
    }

    function _rangeMask(uint256 xStart, uint256 xEnd) internal pure returns (uint256) {
        uint256 length = (xEnd - xStart) + 1;
        uint256 ones = length == 256 ? type(uint256).max : (uint256(1) << length) - 1;
        return ones << (255 - xEnd);
    }

    // ---------------------------------------------------------------------
    // BMP / SVG rendering
    // ---------------------------------------------------------------------

    function renderBMP() public view returns (bytes memory bmp) {
        bmp = new bytes(_BMP_FILE_SIZE);

        bmp[0] = 0x42;
        bmp[1] = 0x4d;
        _writeLE32(bmp, 2, uint32(_BMP_FILE_SIZE));
        _writeLE32(bmp, 10, uint32(_BMP_PIXEL_OFFSET));

        _writeLE32(bmp, 14, 40);
        _writeLE32(bmp, 18, uint32(WIDTH));
        _writeLE32(bmp, 22, uint32(HEIGHT));
        _writeLE16(bmp, 26, 1);
        _writeLE16(bmp, 28, 4);
        _writeLE32(bmp, 30, 0);
        _writeLE32(bmp, 34, uint32(CANVAS_BYTE_LENGTH));
        _writeLE32(bmp, 38, 2_835);
        _writeLE32(bmp, 42, 2_835);
        _writeLE32(bmp, 46, uint32(PALETTE_SIZE));
        _writeLE32(bmp, 50, uint32(PALETTE_SIZE));

        uint256 paletteOffset = _BMP_FILE_HEADER_SIZE + _BMP_INFO_HEADER_SIZE;
        for (uint8 i; i < PALETTE_SIZE; ++i) {
            uint24 rgb = _paletteColor(i);
            uint256 offset = paletteOffset + (uint256(i) * 4);
            bmp[offset] = bytes1(uint8(rgb));
            bmp[offset + 1] = bytes1(uint8(rgb >> 8));
            bmp[offset + 2] = bytes1(uint8(rgb >> 16));
        }

        bytes memory canvas = getCanvas();
        for (uint256 bmpRow; bmpRow < HEIGHT; ++bmpRow) {
            uint256 sourceY = (HEIGHT - 1) - bmpRow;
            uint256 sourceOffset = sourceY * 128;
            uint256 destination = _BMP_PIXEL_OFFSET + (bmpRow * 128);
            for (uint256 i; i < 128; ++i) {
                bmp[destination + i] = canvas[sourceOffset + i];
            }
        }
    }

    function renderSVG() public view returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
            '<image x="0" y="0" width="1024" height="1024" preserveAspectRatio="none" ',
            'style="image-rendering:pixelated;image-rendering:crisp-edges" href="data:image/bmp;base64,',
            Base64.encode(renderBMP()),
            '"/></svg>'
        );
    }

    function _writeLE16(bytes memory data, uint256 offset, uint16 value) internal pure {
        data[offset] = bytes1(uint8(value));
        data[offset + 1] = bytes1(uint8(value >> 8));
    }

    function _writeLE32(bytes memory data, uint256 offset, uint32 value) internal pure {
        data[offset] = bytes1(uint8(value));
        data[offset + 1] = bytes1(uint8(value >> 8));
        data[offset + 2] = bytes1(uint8(value >> 16));
        data[offset + 3] = bytes1(uint8(value >> 24));
    }

    // ---------------------------------------------------------------------
    // NFT metadata
    // ---------------------------------------------------------------------

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        MintInfo memory info = mintInfo[tokenId];

        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(renderSVG()))
        );

        string memory attributes = string.concat(
            '[{"trait_type":"Mint","value":', tokenId.toString(), '},',
            '{"trait_type":"Monad block","value":', uint256(info.blockNumber).toString(), '},',
            '{"trait_type":"DF1","value":', uint256(info.df1Level).toString(), '},',
            '{"trait_type":"Pixel writes","value":', uint256(info.pixelWrites).toString(), '},',
            '{"trait_type":"Intended face","value":"', info.intendedFaceColor == FACE_BLACK ? 'black' : 'white', '"},',
            '{"trait_type":"Saved face","value":"', info.finalFaceColor == FACE_BLACK ? 'black' : 'white', '"},',
            '{"trait_type":"Base fee (wei)","value":"', uint256(info.baseFee).toString(), '"}]'
        );

        string memory json = string.concat(
            '{"name":"r3tards paint #', tokenId.toString(), '",',
            '"description":"one r3tard. one paint file. the linework stays sacred. the background does not. flip the sacred lines black or white. mint to save. it never ends. r3tards is not a r3al proj3ct.",',
            '"image":"', image, '",',
            '"attributes":', attributes,
            "}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == _ERC4906_INTERFACE_ID || super.supportsInterface(interfaceId);
    }
}
