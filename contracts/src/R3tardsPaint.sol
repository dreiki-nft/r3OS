// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title r3tards paint
/// @notice One infinite, shared, fully onchain 256x256 painting on Monad.
/// @dev
/// - 256x256 pixels
/// - 16 fixed r3tards colors
/// - 4 bits per pixel
/// - 65,536 pixels = 262,144 bits
/// - 1,024 storage slots
/// - 8 consecutive MIP-8 pages (128 slots/page)
///
/// The browser may preview normal Paint-style tools locally, but canonical state
/// changes only here. The frontend submits compact horizontal runs:
///
///   [y, xStart, xEnd, colorIndex]
///
/// Four bytes per run. xEnd is inclusive. The contract applies each intended
/// pixel, derives DF1 intensity from block.basefee, corrupts the intended color
/// deterministically, writes the canonical bitmap, records the mutation, and
/// mints the next ERC-721.
///
/// Every tokenURI renders the CURRENT shared painting. Old NFTs therefore keep
/// changing as new mints mutate the one living artwork.
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

    /// @notice Canvas is deliberately aligned to a 128-slot boundary.
    uint256 public constant CANVAS_BASE_SLOT =
        uint256(keccak256("r3tards.paint.canvas.v1")) & ~uint256(127);

    /// @notice A mint can intentionally touch the whole 256x256 canvas once.
    /// Duplicate/overlapping runs count toward this bound as writes.
    uint256 public constant MAX_PIXEL_WRITES_PER_MINT = 65_536;

    /// @notice Monad's documented minimum base fee used as DF1's quiet-network floor.
    uint256 public constant DF1_BASE_FEE_FLOOR = 100 gwei;

    bytes4 private constant _ERC4906_INTERFACE_ID = 0x49064906;

    // BMP: 14 file header + 40 info header + 16*4 palette + pixel bytes.
    uint256 private constant _BMP_FILE_HEADER_SIZE = 14;
    uint256 private constant _BMP_INFO_HEADER_SIZE = 40;
    uint256 private constant _BMP_PALETTE_SIZE = 64;
    uint256 private constant _BMP_PIXEL_OFFSET = 118;
    uint256 private constant _BMP_FILE_SIZE = _BMP_PIXEL_OFFSET + CANVAS_BYTE_LENGTH;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct MintInfo {
        address painter;
        uint64 blockNumber;
        uint96 baseFee;
        uint32 pixelWrites;
        uint8 df1Level;
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
    error TooManyPixelWrites(uint256 requested, uint256 maximum);
    error PixelOutOfBounds(uint256 x, uint256 y);
    error PaletteIndexOutOfBounds(uint256 index);

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice The complete replay input for a mint.
    /// @dev Replaying `runs` with the emitted seed + df1Level reproduces the
    /// final colors written by this transaction.
    event Painted(
        uint256 indexed tokenId,
        address indexed painter,
        uint256 indexed blockNumber,
        uint256 baseFee,
        uint8 df1Level,
        bytes32 seed,
        uint256 pixelWrites,
        bytes runs
    );

    /// @dev ERC-4906.
    event MetadataUpdate(uint256 _tokenId);

    /// @dev ERC-4906.
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    uint256 public totalMints;

    mapping(uint256 tokenId => MintInfo info) public mintInfo;

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() ERC721("r3tards paint", "R3PAINT") {
        // 31337 exists only so local Foundry/Anvil tests can deploy the exact
        // same source. Production/test deployments are Monad 143 / 10143.
        if (block.chainid != 143 && block.chainid != 10_143 && block.chainid != 31_337) {
            revert UnsupportedChain(block.chainid);
        }

        // Storage defaults to palette index 0 (#FFFFFF), so the canvas begins
        // white. These deterministic raw writes seed the black genesis r3tard.
        _drawGenesis();
    }

    // ---------------------------------------------------------------------
    // Mint + mutate
    // ---------------------------------------------------------------------

    /// @notice Commit intended Paint output and mint the next NFT.
    /// @param runs Packed 4-byte horizontal runs: [y, xStart, xEnd, color].
    /// xEnd is inclusive. Color must be 0..15.
    function paintAndMint(bytes calldata runs) external returns (uint256 tokenId) {
        uint256 pixelWrites = _validateRuns(runs);

        tokenId = totalMints + 1;
        MintInfo memory info = _buildMintInfo(tokenId, pixelWrites, runs);

        _applyRuns(runs, info.df1Level, info.seed);

        totalMints = tokenId;
        mintInfo[tokenId] = info;

        // Deliberately use _mint rather than _safeMint. A smart-account caller
        // should not be denied its NFT merely because it lacks IERC721Receiver.
        _mint(msg.sender, tokenId);

        _emitPainted(tokenId, info, runs);

        // Every NFT displays the same CURRENT shared image.
        emit BatchMetadataUpdate(1, tokenId);
    }

    /// @dev Validate the packed runs and return the number of pixel writes.
    /// Keeping this work out of paintAndMint avoids Solidity's stack-depth limit.
    function _validateRuns(bytes calldata runs) internal pure returns (uint256 pixelWrites) {
        uint256 length = runs.length;
        if (length == 0) revert EmptyPatch();
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

    /// @dev Capture the exact Monad state used by DF1 for this mint.
    function _buildMintInfo(
        uint256 tokenId,
        uint256 pixelWrites,
        bytes calldata runs
    ) internal view returns (MintInfo memory info) {
        uint8 df1 = df1LevelForBaseFee(block.basefee);
        bytes32 seed = keccak256(
            abi.encodePacked(
                block.prevrandao,
                block.number,
                block.basefee,
                msg.sender,
                tokenId,
                keccak256(runs)
            )
        );

        info = MintInfo({
            painter: msg.sender,
            blockNumber: uint64(block.number),
            baseFee: uint96(block.basefee),
            pixelWrites: uint32(pixelWrites),
            df1Level: df1,
            seed: seed
        });
    }

    /// @dev Apply all intended runs using the already-derived DF1 state.
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
                uint8 finalColor = _df1Color(intendedColor, df1, seed, nonce);
                _writePixelRaw(uint8(x), y, finalColor);
                unchecked {
                    ++nonce;
                }
            }
        }
    }

    /// @dev Isolating event construction keeps paintAndMint's live stack small.
    function _emitPainted(
        uint256 tokenId,
        MintInfo memory info,
        bytes calldata runs
    ) internal {
        emit Painted(
            tokenId,
            info.painter,
            info.blockNumber,
            info.baseFee,
            info.df1Level,
            info.seed,
            info.pixelWrites,
            runs
        );
    }

    // ---------------------------------------------------------------------
    // DF1: Monad network pressure -> deterministic palette corruption
    // ---------------------------------------------------------------------

    /// @notice Convert Monad base fee into a 0..100 DF1 intensity.
    /// @dev Piecewise logarithmic curve:
    /// 1x floor -> 0
    /// 2x       -> 20
    /// 4x       -> 40
    /// 8x       -> 60
    /// 16x      -> 80
    /// 32x+     -> 100
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

    /// @dev DF1 preserves the original enhancer's basic character:
    /// - at 100%, per-channel noise is in [-25, +25]
    /// - at 100%, ~0.9919% of pixels receive random RGB replacement
    /// - intensity scales both effects
    /// - the result is quantized back to the canonical 16-color palette
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

        // ~0.9919% at DF1 100, proportionally less below 100.
        uint256 replaceThreshold = (9_919 * uint256(intensity)) / 100;

        if ((random % 1_000_000) < replaceThreshold) {
            int256 rr = int256((random >> 32) & 0xff);
            int256 rg = int256((random >> 40) & 0xff);
            int256 rb = int256((random >> 48) & 0xff);

            // Blend toward the random replacement according to DF1 level.
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

    /// @notice Return one canonical r3tards RGB color as 0xRRGGBB.
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
        if (index == 0) return 0xFFFFFF; // white
        if (index == 1) return 0x000000; // black
        if (index == 2) return 0x965E4B; // trippie brown
        if (index == 3) return 0x877549; // old man olive
        if (index == 4) return 0xC52020; // juicy red
        if (index == 5) return 0xFEC343; // gold
        if (index == 6) return 0xEE93E3; // og pink
        if (index == 7) return 0xE6A3C6; // tongue pink
        if (index == 8) return 0x07992F; // green
        if (index == 9) return 0xA0055D; // nad magenta
        if (index == 10) return 0x694B87; // purple
        if (index == 11) return 0x5FEDDF; // DF1 cyan
        if (index == 12) return 0xF7931A; // BTC orange
        if (index == 13) return 0xC864AA; // waifu pink
        if (index == 14) return 0x9F70DA; // pill purple
        return 0xD47827; // emoji orange
    }

    // ---------------------------------------------------------------------
    // Canvas views
    // ---------------------------------------------------------------------

    /// @notice Read a palette index at x/y.
    function pixelAt(uint256 x, uint256 y) public view returns (uint8 colorIndex) {
        if (x >= WIDTH || y >= HEIGHT) revert PixelOutOfBounds(x, y);

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

    /// @notice Return all 32,768 packed canvas bytes, row 0 first.
    /// Two pixels per byte; left pixel is the high nibble.
    function getCanvas() public view returns (bytes memory canvas) {
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

    function _writePixelRaw(uint8 x, uint8 y, uint8 colorIndex) internal {
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

    // ---------------------------------------------------------------------
    // Genesis drawing
    // ---------------------------------------------------------------------

    /// @dev Deliberately primitive black line-art. Replace this routine before
    /// production if you want a different genesis r3tard; once deployed the
    /// initial state is permanent history.
    function _drawGenesis() internal {
        uint8 black = 1;

        // Head / ears / jaw.
        _rawRectFill(90, 28, 166, 33, black);
        _rawRectFill(82, 34, 89, 104, black);
        _rawRectFill(167, 34, 174, 104, black);
        _rawRectFill(90, 105, 166, 112, black);
        _rawRectFill(75, 52, 81, 76, black);
        _rawRectFill(175, 52, 181, 76, black);

        // Uneven hair so this is not mistaken for respectable software.
        _rawRectFill(96, 22, 104, 31, black);
        _rawRectFill(112, 18, 122, 31, black);
        _rawRectFill(132, 20, 142, 31, black);
        _rawRectFill(151, 23, 160, 31, black);

        // Eyes.
        _rawRectFill(103, 55, 112, 69, black);
        _rawRectFill(143, 55, 152, 69, black);

        // Nose / mouth.
        _rawRectFill(126, 68, 130, 83, black);
        _rawRectFill(108, 90, 148, 94, black);
        _rawRectFill(108, 86, 112, 90, black);
        _rawRectFill(144, 86, 148, 90, black);

        // Neck.
        _rawRectFill(111, 113, 119, 128, black);
        _rawRectFill(137, 113, 145, 128, black);

        // Torso outline.
        _rawRectFill(91, 128, 165, 135, black);
        _rawRectFill(91, 136, 98, 192, black);
        _rawRectFill(158, 136, 165, 192, black);
        _rawRectFill(98, 193, 158, 200, black);

        // Arms.
        _rawLine(91, 138, 62, 177, black, 5);
        _rawLine(165, 138, 194, 177, black, 5);
        _rawRectFill(53, 174, 67, 181, black);
        _rawRectFill(189, 174, 203, 181, black);

        // Shirt nonsense.
        _rawRectFill(119, 150, 137, 155, black);
        _rawRectFill(125, 144, 131, 162, black);

        // Legs / feet.
        _rawLine(112, 199, 103, 228, black, 7);
        _rawLine(144, 199, 153, 228, black, 7);
        _rawRectFill(88, 226, 108, 233, black);
        _rawRectFill(148, 226, 168, 233, black);
    }

    function _rawRectFill(
        uint256 x0,
        uint256 y0,
        uint256 x1,
        uint256 y1,
        uint8 color
    ) internal {
        for (uint256 y = y0; y <= y1; ++y) {
            for (uint256 x = x0; x <= x1; ++x) {
                _writePixelRaw(uint8(x), uint8(y), color);
            }
        }
    }

    function _rawLine(
        int256 x0,
        int256 y0,
        int256 x1,
        int256 y1,
        uint8 color,
        uint256 thickness
    ) internal {
        int256 dx = _abs(x1 - x0);
        int256 sx = x0 < x1 ? int256(1) : int256(-1);
        int256 dy = -_abs(y1 - y0);
        int256 sy = y0 < y1 ? int256(1) : int256(-1);
        int256 err = dx + dy;

        while (true) {
            _rawBrushPoint(uint256(x0), uint256(y0), color, thickness);

            if (x0 == x1 && y0 == y1) break;

            int256 e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x0 += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    /// @dev Draw one square brush dab for the genesis rasterizer. Kept in a
    /// separate helper so _rawLine stays below Solidity's stack-depth limit
    /// when compiled without viaIR (important for a straightforward Remix build).
    function _rawBrushPoint(
        uint256 x,
        uint256 y,
        uint8 color,
        uint256 thickness
    ) internal {
        uint256 half = thickness / 2;

        uint256 startX = x > half ? x - half : 0;
        uint256 startY = y > half ? y - half : 0;
        uint256 endX = x + half < WIDTH ? x + half : WIDTH - 1;
        uint256 endY = y + half < HEIGHT ? y + half : HEIGHT - 1;

        _rawRectFill(startX, startY, endX, endY, color);
    }

    function _abs(int256 value) internal pure returns (int256) {
        return value < 0 ? -value : value;
    }

    // ---------------------------------------------------------------------
    // BMP / SVG rendering
    // ---------------------------------------------------------------------

    function renderBMP() public view returns (bytes memory bmp) {
        bmp = new bytes(_BMP_FILE_SIZE);

        // BITMAPFILEHEADER
        bmp[0] = 0x42; // B
        bmp[1] = 0x4d; // M
        _writeLE32(bmp, 2, uint32(_BMP_FILE_SIZE));
        _writeLE32(bmp, 10, uint32(_BMP_PIXEL_OFFSET));

        // BITMAPINFOHEADER
        _writeLE32(bmp, 14, 40);
        _writeLE32(bmp, 18, uint32(WIDTH));
        _writeLE32(bmp, 22, uint32(HEIGHT)); // positive = bottom-up rows
        _writeLE16(bmp, 26, 1);
        _writeLE16(bmp, 28, 4);
        _writeLE32(bmp, 30, 0); // BI_RGB
        _writeLE32(bmp, 34, uint32(CANVAS_BYTE_LENGTH));
        _writeLE32(bmp, 38, 2_835);
        _writeLE32(bmp, 42, 2_835);
        _writeLE32(bmp, 46, uint32(PALETTE_SIZE));
        _writeLE32(bmp, 50, uint32(PALETTE_SIZE));

        // Palette uses BMP BGRA order.
        uint256 paletteOffset = _BMP_FILE_HEADER_SIZE + _BMP_INFO_HEADER_SIZE;
        for (uint8 i; i < PALETTE_SIZE; ++i) {
            uint24 rgb = _paletteColor(i);
            uint256 offset = paletteOffset + (uint256(i) * 4);
            bmp[offset] = bytes1(uint8(rgb));
            bmp[offset + 1] = bytes1(uint8(rgb >> 8));
            bmp[offset + 2] = bytes1(uint8(rgb >> 16));
        }

        // 256 pixels @ 4bpp = 128 bytes = four storage slots per row.
        // Our nibble ordering already matches indexed BMP. Only row order flips.
        uint256 base = CANVAS_BASE_SLOT;
        for (uint256 bmpRow; bmpRow < HEIGHT; ++bmpRow) {
            uint256 sourceY = (HEIGHT - 1) - bmpRow;
            uint256 firstSlot = sourceY * SLOTS_PER_ROW;
            uint256 destination = _BMP_PIXEL_OFFSET + (bmpRow * 128);

            for (uint256 j; j < SLOTS_PER_ROW; ++j) {
                uint256 word;
                assembly {
                    word := sload(add(add(base, firstSlot), j))
                }
                uint256 offset = destination + (j * 32);
                assembly {
                    mstore(add(add(bmp, 0x20), offset), word)
                }
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
            '[{"trait_type":"Mint","value":', tokenId.toString(), "},",
            '{"trait_type":"Monad block","value":', uint256(info.blockNumber).toString(), "},",
            '{"trait_type":"DF1","value":', uint256(info.df1Level).toString(), "},",
            '{"trait_type":"Pixel writes","value":', uint256(info.pixelWrites).toString(), "},",
            '{"trait_type":"Base fee (wei)","value":"', uint256(info.baseFee).toString(), '"}]'
        );

        string memory json = string.concat(
            '{"name":"r3tards paint #', tokenId.toString(), '",',
            '"description":"one r3tard. one paint file. anyone can edit it. mint to save. it never ends. r3tards is not a r3al proj3ct.",',
            '"image":"', image, '",',
            '"attributes":', attributes,
            "}"
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == _ERC4906_INTERFACE_ID || super.supportsInterface(interfaceId);
    }
}
