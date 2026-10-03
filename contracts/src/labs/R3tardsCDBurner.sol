// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {R3tardsLabs} from "../R3tardsLabs.sol";
import {IR3tardsPaintData} from "../interfaces/IR3tardsPaintData.sol";
import {ILabTokenSource} from "../interfaces/ILabTokenSource.sol";
import {ILabTokenNameSource} from "../interfaces/ILabTokenNameSource.sol";
import {CDArt} from "../lib/CDArt.sol";
import {FrameStore} from "../lib/FrameStore.sol";
import {LabTraits} from "../lib/LabTraits.sol";

interface IR3tardsCDBurnerCore is IR3tardsPaintData {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IR3tardsBlockCameraCD {
    function cdTrackData(uint256 tokenId) external view returns (uint32 season, uint48 blockNumber, uint256 colourCounts);
}

/// @notice Snapshots 1-12 owned Paint frames and/or Block Camera photos into one immutable onchain mix CD-R.
/// @dev Burning a CD means minting the mix; source NFTs are never transferred or burned by this contract.
contract R3tardsCDBurner is ILabTokenSource, ILabTokenNameSource {
    using Strings for uint256;

    uint256 public constant MAX_TRACKS = 12;
    uint256 public constant MAX_LABEL_LENGTH = 24;

    uint256 private constant FRAMESTORE_DATA_OFFSET = 15;
    uint256 private constant HEADER_SIZE = 80;
    uint256 private constant TRACK_SIZE = 38;
    uint256 private constant TRACKS_OFFSET = HEADER_SIZE;
    uint256 private constant DISC_MASK_OFFSET = 48;
    uint256 private constant LABEL_OFFSET = 50;
    uint256 private constant FRAME_COUNT_OFFSET = 74;
    uint256 private constant PHOTO_COUNT_OFFSET = 75;
    uint8 private constant LEGACY_SNAPSHOT_VERSION = 2;
    uint8 private constant MIXED_SNAPSHOT_VERSION = 3;
    uint8 private constant TRACK_KIND_FRAME = 0;
    uint8 private constant TRACK_KIND_BLOCK_PHOTO = 1;
    uint8 private constant FLAG_STORM = 1;
    uint8 private constant FLAG_FINALE = 2;
    uint8 private constant FLAG_BLOCK_PHOTO = 4;
    uint16 private constant DISC_COLOUR_MASK = 0x7f70;
    bytes32 private constant BLOCK_CAMERA_NAME_HASH = keccak256("block-camera");

    IR3tardsCDBurnerCore public immutable PAINT;
    R3tardsLabs public immutable LABS;
    uint256 public experimentId = type(uint256).max;
    mapping(uint256 => address) public snapshotPointer;

    struct BuildStats {
        uint256 oldestTrack;
        uint256 colourCounts;
        uint32 minSeason;
        uint32 maxSeason;
        uint8 seasonCount;
        uint8 stormTracks;
        bool hasFinale;
        uint16 discMask;
        uint32[12] seasons;
    }

    error ZeroAddress();
    error ExperimentAlreadyBound();
    error InvalidExperiment(uint256 id);
    error ExperimentNotBound();
    error SessionKeyCannotBurnCD();
    error InvalidTrackCount(uint256 count);
    error DuplicateTrack(uint256 tokenId);
    error TokenZeroNotAllowed();
    error NotFrameOwner(uint256 frameId, address owner);
    error InvalidTrackKindsLength(uint256 tracks, uint256 kinds);
    error InvalidTrackKind(uint8 kind);
    error NotLabsOwner(uint256 tokenId, address owner);
    error NotBlockCameraToken(uint256 tokenId);
    error BlockCameraTrackReadFailed(uint256 tokenId);
    error InvalidLabelLength(uint256 length);
    error InvalidLabelCharacter(uint256 index, bytes1 character);
    error CDDoesNotExist(uint256 tokenId);

    event CDBurned(address indexed owner, uint256 indexed tokenId, uint8 tracks, string label);

    constructor(address paintCore, address labs) {
        if (paintCore == address(0) || labs == address(0)) revert ZeroAddress();
        PAINT = IR3tardsCDBurnerCore(paintCore);
        LABS = R3tardsLabs(labs);
    }

    function bindExperimentId(uint256 id) external {
        if (experimentId != type(uint256).max) revert ExperimentAlreadyBound();
        IR3tardsPaintData.ExperimentData memory info_ = PAINT.experimentInfo(id);
        if (info_.experiment != address(this) || info_.retired) revert InvalidExperiment(id);
        experimentId = id;
    }

    function burnCD(uint256[] calldata frameIds, string calldata label) external returns (uint256 tokenId) {
        if (PAINT.isActiveSessionKey(msg.sender)) revert SessionKeyCannotBurnCD();
        uint256 count = frameIds.length;
        if (count == 0 || count > MAX_TRACKS) revert InvalidTrackCount(count);
        uint256 boundExperimentId = experimentId;
        if (boundExperimentId == type(uint256).max) revert ExperimentNotBound();

        bytes memory normalized = _normalizeLabel(label);
        bytes memory init = FrameStore.allocateInit(HEADER_SIZE + count * TRACK_SIZE);
        BuildStats memory stats;
        stats.oldestTrack = type(uint256).max;
        stats.minSeason = type(uint32).max;

        init[FRAMESTORE_DATA_OFFSET] = bytes1(LEGACY_SNAPSHOT_VERSION);
        init[FRAMESTORE_DATA_OFFSET + 1] = bytes1(uint8(count));
        init[FRAMESTORE_DATA_OFFSET + 2] = bytes1(uint8(normalized.length));
        for (uint256 i; i < normalized.length; ++i) init[FRAMESTORE_DATA_OFFSET + LABEL_OFFSET + i] = normalized[i];

        for (uint256 i; i < count; ++i) {
            uint256 frameId = frameIds[i];
            if (frameId == 0) revert TokenZeroNotAllowed();
            for (uint256 j; j < i; ++j) {
                if (frameIds[j] == frameId) revert DuplicateTrack(frameId);
            }
            address owner = PAINT.ownerOf(frameId);
            if (owner != msg.sender) revert NotFrameOwner(frameId, owner);
            _snapshotTrack(init, i, frameId, stats);
        }

        (uint8 dominant, uint8 coloursUsed) = _finishColours(stats.colourCounts);
        init[FRAMESTORE_DATA_OFFSET + 3] = bytes1(dominant);
        init[FRAMESTORE_DATA_OFFSET + 4] = bytes1(coloursUsed);
        init[FRAMESTORE_DATA_OFFSET + 5] = bytes1(stats.seasonCount);
        init[FRAMESTORE_DATA_OFFSET + 6] = bytes1(stats.stormTracks);
        init[FRAMESTORE_DATA_OFFSET + 7] = stats.hasFinale ? bytes1(uint8(1)) : bytes1(uint8(0));
        _writeUint256(init, FRAMESTORE_DATA_OFFSET + 8, stats.oldestTrack);
        _writeUint32(init, FRAMESTORE_DATA_OFFSET + 40, stats.minSeason);
        _writeUint32(init, FRAMESTORE_DATA_OFFSET + 44, stats.maxSeason);
        _writeUint16(init, FRAMESTORE_DATA_OFFSET + DISC_MASK_OFFSET, stats.discMask);

        address pointer = FrameStore.writePrepared(init);
        tokenId = LABS.mint(msg.sender, boundExperimentId);
        snapshotPointer[tokenId] = pointer;
        emit CDBurned(msg.sender, tokenId, uint8(count), string(normalized));
    }

    /// @notice Burn an ordered mix of Paint frames (kind 0) and Block Camera Labs tokens (kind 1).
    /// @dev Version 3 keeps the same 38-byte track records as v2. Flag bit 2 identifies a Block Camera track.
    function burnMixedCD(uint256[] calldata trackIds, uint8[] calldata trackKinds, string calldata label)
        external
        returns (uint256 tokenId)
    {
        if (PAINT.isActiveSessionKey(msg.sender)) revert SessionKeyCannotBurnCD();
        uint256 count = trackIds.length;
        if (count == 0 || count > MAX_TRACKS) revert InvalidTrackCount(count);
        if (trackKinds.length != count) revert InvalidTrackKindsLength(count, trackKinds.length);
        uint256 boundExperimentId = experimentId;
        if (boundExperimentId == type(uint256).max) revert ExperimentNotBound();

        bytes memory normalized = _normalizeLabel(label);
        bytes memory init = FrameStore.allocateInit(HEADER_SIZE + count * TRACK_SIZE);
        BuildStats memory stats;
        stats.oldestTrack = type(uint256).max;
        stats.minSeason = type(uint32).max;
        uint8 frameTracks;
        uint8 photoTracks;

        init[FRAMESTORE_DATA_OFFSET] = bytes1(MIXED_SNAPSHOT_VERSION);
        init[FRAMESTORE_DATA_OFFSET + 1] = bytes1(uint8(count));
        init[FRAMESTORE_DATA_OFFSET + 2] = bytes1(uint8(normalized.length));
        for (uint256 i; i < normalized.length; ++i) init[FRAMESTORE_DATA_OFFSET + LABEL_OFFSET + i] = normalized[i];

        for (uint256 i; i < count; ++i) {
            uint256 tokenId_ = trackIds[i];
            uint8 kind = trackKinds[i];
            for (uint256 j; j < i; ++j) {
                if (trackKinds[j] == kind && trackIds[j] == tokenId_) revert DuplicateTrack(tokenId_);
            }
            if (kind == TRACK_KIND_FRAME) {
                if (tokenId_ == 0) revert TokenZeroNotAllowed();
                address owner = PAINT.ownerOf(tokenId_);
                if (owner != msg.sender) revert NotFrameOwner(tokenId_, owner);
                _snapshotTrack(init, i, tokenId_, stats);
                ++frameTracks;
            } else if (kind == TRACK_KIND_BLOCK_PHOTO) {
                _snapshotBlockPhoto(init, i, tokenId_, stats);
                ++photoTracks;
            } else {
                revert InvalidTrackKind(kind);
            }
        }

        (uint8 dominant, uint8 coloursUsed) = _finishColours(stats.colourCounts);
        init[FRAMESTORE_DATA_OFFSET + 3] = bytes1(dominant);
        init[FRAMESTORE_DATA_OFFSET + 4] = bytes1(coloursUsed);
        init[FRAMESTORE_DATA_OFFSET + 5] = bytes1(stats.seasonCount);
        init[FRAMESTORE_DATA_OFFSET + 6] = bytes1(stats.stormTracks);
        init[FRAMESTORE_DATA_OFFSET + 7] = stats.hasFinale ? bytes1(uint8(1)) : bytes1(uint8(0));
        _writeUint256(init, FRAMESTORE_DATA_OFFSET + 8, frameTracks == 0 ? 0 : stats.oldestTrack);
        _writeUint32(init, FRAMESTORE_DATA_OFFSET + 40, stats.minSeason);
        _writeUint32(init, FRAMESTORE_DATA_OFFSET + 44, stats.maxSeason);
        _writeUint16(init, FRAMESTORE_DATA_OFFSET + DISC_MASK_OFFSET, stats.discMask);
        init[FRAMESTORE_DATA_OFFSET + FRAME_COUNT_OFFSET] = bytes1(frameTracks);
        init[FRAMESTORE_DATA_OFFSET + PHOTO_COUNT_OFFSET] = bytes1(photoTracks);

        address pointer = FrameStore.writePrepared(init);
        tokenId = LABS.mint(msg.sender, boundExperimentId);
        snapshotPointer[tokenId] = pointer;
        emit CDBurned(msg.sender, tokenId, uint8(count), string(normalized));
    }

    function labTokenName(uint256 tokenId) external view returns (string memory) {
        bytes memory snapshot = _snapshot(tokenId);
        return string.concat("r3tards labs cd #", tokenId.toString(), ": ", _label(snapshot));
    }

    function labToken(uint256 tokenId) external view returns (
        string memory kind,
        string memory description,
        bytes memory imageSvg,
        string memory attributes,
        uint8 dominantColour,
        uint8 coloursUsed
    ) {
        bytes memory snapshot = _snapshot(tokenId);
        uint256 tracks = uint8(snapshot[1]);
        uint8 version = uint8(snapshot[0]);
        uint256 frameTracks = version >= MIXED_SNAPSHOT_VERSION ? uint8(snapshot[FRAME_COUNT_OFFSET]) : tracks;
        uint256 photoTracks = version >= MIXED_SNAPSHOT_VERSION ? uint8(snapshot[PHOTO_COUNT_OFFSET]) : 0;
        uint256 seasons = uint8(snapshot[5]);
        uint256 stormTracks = uint8(snapshot[6]);
        bool hasFinale = uint8(snapshot[7]) != 0;
        uint256 oldestTrack = _readUint256(snapshot, 8);
        uint16 discMask = _readUint16(snapshot, DISC_MASK_OFFSET);
        uint256 discColours = _popcount(discMask);

        kind = "CD";
        description = photoTracks == 0
            ? "a mix CD-R burned from r3tards paint frames. the frames themselves were not harmed."
            : frameTracks == 0
                ? "a mix CD-R burned from Block Camera photos. the source NFTs were not harmed."
                : "a mix CD-R burned from r3tards paint frames and Block Camera photos. the source NFTs were not harmed.";
        imageSvg = CDArt.svg(tokenId, _artIds(snapshot), bytes(_label(snapshot)), discMask);
        attributes = string(
            abi.encodePacked(
                ',{"trait_type":"Tracks","display_type":"number","value":',
                tracks.toString(),
                '}',
                ',{"trait_type":"Format","value":"',
                LabTraits.cdFormat(tracks),
                '"}',
                ',{"trait_type":"Seasons","display_type":"number","value":',
                seasons.toString(),
                '}',
                ',{"trait_type":"Mix","value":"',
                seasons <= 1 ? "Single season" : "Multi season",
                '"}',
                ',{"trait_type":"Storm tracks","display_type":"number","value":',
                stormTracks.toString(),
                '}',
                ',{"trait_type":"Has finale","value":"',
                hasFinale ? "yes" : "no",
                '"}',
                version < MIXED_SNAPSHOT_VERSION
                    ? string.concat(',{"trait_type":"Oldest track","display_type":"number","value":', oldestTrack.toString(), '}')
                    : frameTracks == 0
                        ? ""
                        : string.concat(',{"trait_type":"Oldest frame","display_type":"number","value":', oldestTrack.toString(), '}'),
                version < MIXED_SNAPSHOT_VERSION
                    ? ""
                    : string.concat(
                        ',{"trait_type":"Paint frames","display_type":"number","value":',
                        frameTracks.toString(),
                        '}',
                        ',{"trait_type":"Block photos","display_type":"number","value":',
                        photoTracks.toString(),
                        '}'
                    ),
                ',{"trait_type":"Disc colours","display_type":"number","value":',
                discColours.toString(),
                '}',
                ',{"trait_type":"Disc","value":"',
                _discBucket(discColours),
                '"}'
            )
        );
        dominantColour = uint8(snapshot[3]);
        coloursUsed = uint8(snapshot[4]);
    }

    function canBurn(uint256 tokenId) external view returns (bool) {
        if (snapshotPointer[tokenId] == address(0)) revert CDDoesNotExist(tokenId);
        return false;
    }

    function _snapshotTrack(bytes memory init, uint256 trackIndex, uint256 frameId, BuildStats memory stats)
        private
        view
    {
        IR3tardsPaintData.FrameInfoData memory info = PAINT.frameInfo(frameId);
        uint256 record = FRAMESTORE_DATA_OFFSET + TRACKS_OFFSET + trackIndex * TRACK_SIZE;
        _writeUint256(init, record, frameId);
        _writeUint32(init, record + 32, info.season);
        bool storm = PAINT.isStorm(info.blockNumber);
        init[record + 36] = bytes1(uint8((storm ? FLAG_STORM : 0) | (info.finale ? FLAG_FINALE : 0)));

        uint256 freeMemory;
        assembly {
            freeMemory := mload(0x40)
        }
        bytes memory source = PAINT.frameData(frameId);
        uint256 counts = _sampleCounts(source, info.backgroundColor);
        assembly {
            mstore(0x40, freeMemory)
        }

        (uint8 pair, uint16 trackMask) = _trackColours(counts);
        init[record + 37] = bytes1(pair);
        unchecked {
            stats.colourCounts += counts;
        }
        stats.discMask |= trackMask;
        _addSeason(stats, info.season);
        if (storm) ++stats.stormTracks;
        if (info.finale) stats.hasFinale = true;
        if (frameId < stats.oldestTrack) stats.oldestTrack = frameId;
    }

    function _snapshotBlockPhoto(bytes memory init, uint256 trackIndex, uint256 tokenId, BuildStats memory stats)
        private
        view
    {
        address owner = LABS.ownerOf(tokenId);
        if (owner != msg.sender) revert NotLabsOwner(tokenId, owner);
        address source = LABS.sourceOf(tokenId);
        uint256 sourceExperiment = LABS.experimentOf(tokenId);
        IR3tardsPaintData.ExperimentData memory info_ = PAINT.experimentInfo(sourceExperiment);
        if (info_.experiment != source || keccak256(bytes(info_.name)) != BLOCK_CAMERA_NAME_HASH) {
            revert NotBlockCameraToken(tokenId);
        }

        uint32 season;
        uint48 blockNumber;
        uint256 counts;
        try IR3tardsBlockCameraCD(source).cdTrackData(tokenId) returns (
            uint32 season_, uint48 blockNumber_, uint256 colourCounts_
        ) {
            season = season_;
            blockNumber = blockNumber_;
            counts = colourCounts_;
        } catch {
            revert BlockCameraTrackReadFailed(tokenId);
        }

        uint256 record = FRAMESTORE_DATA_OFFSET + TRACKS_OFFSET + trackIndex * TRACK_SIZE;
        _writeUint256(init, record, tokenId);
        _writeUint32(init, record + 32, season);
        bool storm = PAINT.isStorm(blockNumber);
        init[record + 36] = bytes1(uint8((storm ? FLAG_STORM : 0) | FLAG_BLOCK_PHOTO));
        (uint8 pair, uint16 trackMask) = _trackColours(counts);
        init[record + 37] = bytes1(pair);
        unchecked {
            stats.colourCounts += counts;
        }
        stats.discMask |= trackMask;
        _addSeason(stats, season);
        if (storm) ++stats.stormTracks;
    }

    /// @dev 16 packed uint16 lanes. Samples top-left pixel of every 8x8 source block.
    function _sampleCounts(bytes memory source, uint8 background) internal pure returns (uint256 counts) {
        assembly ("memory-safe") {
            let src := add(source, 0x20)
            for { let y := 0 } lt(y, 32) { y := add(y, 1) } {
                let row := add(src, mul(sub(255, mul(y, 8)), 128))
                for { let wordIndex := 0 } lt(wordIndex, 4) { wordIndex := add(wordIndex, 1) } {
                    let word := mload(add(row, mul(wordIndex, 32)))
                    for { let sample := 0 } lt(sample, 8) { sample := add(sample, 1) } {
                        let colour := and(shr(sub(252, mul(sample, 32)), word), 0x0f)
                        if iszero(colour) { colour := background }
                        counts := add(counts, shl(mul(colour, 16), 1))
                    }
                }
            }
        }
    }

    /// @dev Reference trackColours: highest two eligible DISC colours, ties to lower index.
    function _trackColours(uint256 counts) internal pure returns (uint8 pair, uint16 mask) {
        uint8 first;
        uint256 firstCount;
        for (uint8 colour = 4; colour <= 14; ++colour) {
            if (colour == 7) continue;
            uint256 count = (counts >> (uint256(colour) * 16)) & 0xffff;
            if (count > firstCount) {
                first = colour;
                firstCount = count;
            }
        }
        if (firstCount == 0) return (0, 0);
        mask = uint16(1) << first;

        uint8 second;
        uint256 secondCount;
        for (uint8 colour = 4; colour <= 14; ++colour) {
            if (colour == 7 || colour == first) continue;
            uint256 count = (counts >> (uint256(colour) * 16)) & 0xffff;
            if (count > secondCount) {
                second = colour;
                secondCount = count;
            }
        }
        pair = uint8(first << 4);
        if (secondCount != 0) {
            pair |= second;
            mask |= uint16(1) << second;
        }
    }

    function _addSeason(BuildStats memory stats, uint32 season) private pure {
        for (uint256 i; i < stats.seasonCount; ++i) {
            if (stats.seasons[i] == season) return;
        }
        stats.seasons[stats.seasonCount] = season;
        ++stats.seasonCount;
        if (season < stats.minSeason) stats.minSeason = season;
        if (season > stats.maxSeason) stats.maxSeason = season;
    }

    function _finishColours(uint256 counts) private pure returns (uint8 dominant, uint8 coloursUsed) {
        uint256 best;
        for (uint8 colour; colour < 16; ++colour) {
            uint256 count = (counts >> (uint256(colour) * 16)) & 0xffff;
            if (count != 0) ++coloursUsed;
            if (count > best) {
                best = count;
                dominant = colour;
            }
        }
    }

    function _snapshot(uint256 tokenId) private view returns (bytes memory snapshot) {
        address pointer = snapshotPointer[tokenId];
        if (pointer == address(0)) revert CDDoesNotExist(tokenId);
        snapshot = FrameStore.read(pointer);
        if (snapshot.length < HEADER_SIZE) revert CDDoesNotExist(tokenId);
        uint8 version = uint8(snapshot[0]);
        if (version != LEGACY_SNAPSHOT_VERSION && version != MIXED_SNAPSHOT_VERSION) revert CDDoesNotExist(tokenId);
        uint256 tracks = uint8(snapshot[1]);
        if (tracks == 0 || tracks > MAX_TRACKS || snapshot.length != HEADER_SIZE + tracks * TRACK_SIZE) {
            revert CDDoesNotExist(tokenId);
        }
    }

    function _label(bytes memory snapshot) private pure returns (string memory) {
        uint256 length = uint8(snapshot[2]);
        bytes memory out = new bytes(length);
        for (uint256 i; i < length; ++i) out[i] = snapshot[LABEL_OFFSET + i];
        return string(out);
    }

    function _artIds(bytes memory snapshot) private pure returns (uint256[] memory ids) {
        uint256 tracks = uint8(snapshot[1]);
        bool mixed = uint8(snapshot[0]) >= MIXED_SNAPSHOT_VERSION;
        ids = new uint256[](tracks);
        for (uint256 i; i < tracks; ++i) {
            uint256 record = TRACKS_OFFSET + i * TRACK_SIZE;
            uint256 id = _readUint256(snapshot, record);
            if (mixed && (uint8(snapshot[record + 36]) & FLAG_BLOCK_PHOTO) != 0) id |= uint256(1) << 255;
            ids[i] = id;
        }
    }

    function _normalizeLabel(string calldata label) private pure returns (bytes memory out) {
        bytes memory src = bytes(label);
        uint256 length = src.length;
        if (length == 0 || length > MAX_LABEL_LENGTH) revert InvalidLabelLength(length);
        out = new bytes(length);
        for (uint256 i; i < length; ++i) {
            uint8 c = uint8(src[i]);
            if (c >= 0x41 && c <= 0x5a) c += 32;
            bool valid = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x20 || c == 0x21
                || c == 0x3f || c == 0x2e || c == 0x2c || c == 0x27 || c == 0x26 || c == 0x2d || c == 0x23;
            if (!valid) revert InvalidLabelCharacter(i, bytes1(c));
            out[i] = bytes1(c);
        }
    }

    function _popcount(uint16 value) private pure returns (uint256 count) {
        value &= DISC_COLOUR_MASK;
        while (value != 0) {
            value &= value - 1;
            ++count;
        }
    }

    function _discBucket(uint256 colours) private pure returns (string memory) {
        if (colours == 0) return "Silver";
        if (colours == 1) return "Mono";
        if (colours == 2) return "Duo";
        if (colours <= 6) return "Prism";
        return "Rainbow";
    }

    function _writeUint256(bytes memory data, uint256 offset, uint256 value) private pure {
        assembly ("memory-safe") {
            mstore(add(add(data, 0x20), offset), value)
        }
    }

    function _readUint256(bytes memory data, uint256 offset) private pure returns (uint256 value) {
        assembly ("memory-safe") {
            value := mload(add(add(data, 0x20), offset))
        }
    }

    function _writeUint32(bytes memory data, uint256 offset, uint32 value) private pure {
        data[offset] = bytes1(uint8(value >> 24));
        data[offset + 1] = bytes1(uint8(value >> 16));
        data[offset + 2] = bytes1(uint8(value >> 8));
        data[offset + 3] = bytes1(uint8(value));
    }

    function _writeUint16(bytes memory data, uint256 offset, uint16 value) private pure {
        data[offset] = bytes1(uint8(value >> 8));
        data[offset + 1] = bytes1(uint8(value));
    }

    function _readUint16(bytes memory data, uint256 offset) private pure returns (uint16 value) {
        value = (uint16(uint8(data[offset])) << 8) | uint16(uint8(data[offset + 1]));
    }
}
