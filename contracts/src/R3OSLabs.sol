// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IR3OSPaintData} from "./interfaces/IR3OSPaintData.sol";
import {ILabTokenSource} from "./interfaces/ILabTokenSource.sol";
import {ILabTokenNameSource} from "./interfaces/ILabTokenNameSource.sol";
import {LabTraits} from "./lib/LabTraits.sol";
import {PaletteNames} from "./lib/PaletteNames.sol";

/// @notice Shared tradeable collection for every token-producing r3OS Lab.
/// @dev The owner can only edit the collection external link. Labs mint through the immutable core registry.
contract R3OSLabs is ERC721, ERC2981, Ownable2Step {
    using Strings for uint256;

    uint256 public constant LAB_TOKEN_GAS_LIMIT = 14_000_000;
    uint256 public constant LAB_TOKEN_NAME_GAS_LIMIT = 100_000;
    uint96 public constant ROYALTY_BPS = 500;

    IR3OSPaintData public immutable CORE;
    address public immutable ROYALTY_RECEIVER;

    struct MintData {
        address lab;
        uint32 experimentId;
        uint48 blockNumber;
        bool storm;
        bool holderAtMint;
        address proposer;
        uint32 season;
    }

    uint256 private _nextTokenId = 1;
    mapping(uint256 => MintData) private _mintData;
    mapping(uint256 => mapping(address => uint256)) private _experimentBalances;
    string private _externalLink;

    error ZeroAddress();
    error InvalidExperiment(uint256 experimentId);
    error ExperimentIdTooLarge(uint256 experimentId);
    error UnauthorizedLab(uint256 experimentId, address caller);
    error RetiredExperiment(uint256 experimentId);
    error NotTokenOwner(uint256 tokenId);
    error BurnNotAllowed(uint256 tokenId);
    error NotTokenSource(uint256 tokenId, address caller);

    event ContractURIUpdated();
    event MetadataUpdate(uint256 _tokenId);
    event LabTokenMinted(uint256 indexed tokenId, uint256 indexed experimentId, address indexed lab, address to);

    constructor(address core, address royaltyReceiver)
        ERC721("r3OS labs", "R3OSLABS")
        Ownable(msg.sender)
    {
        if (core == address(0) || royaltyReceiver == address(0)) revert ZeroAddress();
        CORE = IR3OSPaintData(core);
        ROYALTY_RECEIVER = royaltyReceiver;
        _setDefaultRoyalty(royaltyReceiver, ROYALTY_BPS);
    }

    function mint(address to, uint256 experimentId) external returns (uint256 tokenId) {
        if (experimentId > type(uint32).max) revert ExperimentIdTooLarge(experimentId);
        IR3OSPaintData.ExperimentData memory info_ = CORE.experimentInfo(experimentId);
        (address experiment, bool retired) = (info_.experiment, info_.retired);
        if (experiment == address(0)) revert InvalidExperiment(experimentId);
        if (experiment != msg.sender) revert UnauthorizedLab(experimentId, msg.sender);
        if (retired) revert RetiredExperiment(experimentId);

        tokenId = _nextTokenId++;
        uint256 season = CORE.currentSeason();
        if (season > type(uint32).max) revert InvalidExperiment(experimentId);
        _mintData[tokenId] = MintData({
            lab: msg.sender,
            experimentId: uint32(experimentId),
            blockNumber: uint48(block.number),
            storm: CORE.isStorm(block.number),
            holderAtMint: CORE.isR3tardHolder(to),
            proposer: block.coinbase,
            season: uint32(season)
        });
        _mint(to, tokenId);
        emit LabTokenMinted(tokenId, experimentId, msg.sender, to);
    }

    function burn(uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        if (msg.sender != tokenOwner) revert NotTokenOwner(tokenId);
        address lab = _mintData[tokenId].lab;
        bool allowed;
        try ILabTokenSource(lab).canBurn{gas: LAB_TOKEN_GAS_LIMIT}(tokenId) returns (bool canBurn_) {
            allowed = canBurn_;
        } catch {}
        if (!allowed) revert BurnNotAllowed(tokenId);
        _burn(tokenId);
    }

    /// @notice Let the source Lab emit ERC-4906 refreshes from the collection contract.
    function notifyMetadataUpdate(uint256 tokenId) external {
        _requireOwned(tokenId);
        if (_mintData[tokenId].lab != msg.sender) revert NotTokenSource(tokenId, msg.sender);
        emit MetadataUpdate(tokenId);
    }

    /// @notice Number of Labs tokens ever minted. Ids run 1..totalMinted(); burned ids are gaps.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function mintData(uint256 tokenId) external view returns (MintData memory) {
        _requireOwned(tokenId);
        return _mintData[tokenId];
    }

    function sourceOf(uint256 tokenId) external view returns (address) {
        _requireOwned(tokenId);
        return _mintData[tokenId].lab;
    }

    function experimentOf(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        return _mintData[tokenId].experimentId;
    }

    function balanceOfExperiment(uint256 experimentId, address account) external view returns (uint256) {
        return _experimentBalances[experimentId][account];
    }

    function externalLink() external view returns (string memory) {
        return _externalLink;
    }

    function setExternalLink(string calldata nextLink) external onlyOwner {
        _externalLink = nextLink;
        emit ContractURIUpdated();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        MintData memory data = _mintData[tokenId];
        string memory registryName = CORE.experimentInfo(data.experimentId).name;

        string memory kind = _fallbackKind(registryName);
        string memory description = "an onchain r3OS labs artifact on monad.";
        bytes memory imageSvg = _placeholderImage();
        string memory labAttributes;
        uint8 dominantColour;
        uint8 coloursUsed;

        // forge-lint: disable-start(return-bomb)
        (bool tokenOk, bytes memory tokenData) = data.lab.staticcall{gas: LAB_TOKEN_GAS_LIMIT}(
            abi.encodeCall(ILabTokenSource.labToken, (tokenId))
        );
        // forge-lint: disable-end(return-bomb)
        if (tokenOk && _validLabTokenReturn(tokenData)) {
            (
                string memory sourceKind,
                string memory sourceDescription,
                bytes memory sourceImageSvg,
                string memory sourceAttributes,
                uint8 sourceDominantColour,
                uint8 sourceColoursUsed
            ) = abi.decode(tokenData, (string, string, bytes, string, uint8, uint8));
            if (bytes(sourceKind).length != 0) kind = sourceKind;
            if (bytes(sourceDescription).length != 0) description = sourceDescription;
            if (sourceImageSvg.length != 0) imageSvg = sourceImageSvg;
            labAttributes = sourceAttributes;
            dominantColour = sourceDominantColour < 16 ? sourceDominantColour : 0;
            coloursUsed = sourceColoursUsed > 16 ? 16 : sourceColoursUsed;
        }

        bytes memory attributes = abi.encodePacked(
            '{"trait_type":"Type","value":"', _jsonEscape(kind), '"}',
            ',{"trait_type":"Lab","value":"', _jsonEscape(_titleCase(registryName)), '"}',
            ',{"trait_type":"Season","display_type":"number","value":', uint256(data.season + 1).toString(), '}',
            ',{"trait_type":"Monad block","display_type":"number","value":', uint256(data.blockNumber).toString(), '}',
            ',{"trait_type":"Storm","value":"', data.storm ? "yes" : "no", '"}',
            ',{"trait_type":"Holder at mint","value":"', data.holderAtMint ? "yes" : "no", '"}',
            ',{"trait_type":"Sealed by","value":"', LibString.toHexStringChecksummed(data.proposer), '"}',
            ',{"trait_type":"Dominant colour","value":"', PaletteNames.name(dominantColour), '"}',
            ',{"trait_type":"Colours used","display_type":"number","value":', uint256(coloursUsed).toString(), '}',
            ',{"trait_type":"Palette","value":"', LabTraits.palette(coloursUsed), '"}',
            labAttributes
        );

        bytes memory externalField;
        if (bytes(_externalLink).length != 0) {
            externalField = abi.encodePacked(',"external_url":"', _jsonEscape(_tokenExternalUrl(tokenId)), '"');
        }

        string memory tokenName = string.concat("r3OS labs ", _lower(kind), " #", tokenId.toString());
        // forge-lint: disable-start(return-bomb)
        (bool nameOk, bytes memory nameData) = data.lab.staticcall{gas: LAB_TOKEN_NAME_GAS_LIMIT}(
            abi.encodeCall(ILabTokenNameSource.labTokenName, (tokenId))
        );
        // forge-lint: disable-end(return-bomb)
        if (nameOk && _validAbiString(nameData)) {
            string memory sourceName = abi.decode(nameData, (string));
            if (bytes(sourceName).length != 0) tokenName = sourceName;
        }

        string memory encodedImage = Base64.encode(imageSvg);
        bytes memory json = abi.encodePacked(
            '{"name":"', _jsonEscape(tokenName), '",',
            '"description":"', _jsonEscape(description), '",',
            '"image":"data:image/svg+xml;base64,', encodedImage, '"',
            externalField,
            ',"attributes":[', attributes, ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function contractURI() external view returns (string memory) {
        bytes memory svg = bytes(
            string.concat(
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
                '<rect width="512" height="512" fill="#0b0b0c"/>',
                '<rect x="32" y="32" width="448" height="448" fill="none" stroke="#f2efe9"/>',
                '<rect x="32" y="428" width="160" height="20" fill="#5feddf"/>',
                '<text x="48" y="270" fill="#f2efe9" font-family="monospace" font-size="42">r3OS labs</text>',
                '</svg>'
            )
        );
        bytes memory json = abi.encodePacked(
            '{"name":"r3OS labs",',
            '"description":"Everything the r3OS labs make: reels, forks, dreams and mix CD-Rs from r3OS paint. Fully onchain on Monad.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(svg), '",',
            '"external_link":"', _jsonEscape(_externalLink), '",',
            '"seller_fee_basis_points":500,',
            '"fee_recipient":"', LibString.toHexStringChecksummed(ROYALTY_RECEIVER), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        uint256 experimentId = _mintData[tokenId].experimentId;
        if (from != address(0)) --_experimentBalances[experimentId][from];
        if (to != address(0)) ++_experimentBalances[experimentId][to];
    }

    function _validLabTokenReturn(bytes memory data) private pure returns (bool) {
        if (data.length < 224) return false;
        for (uint256 i; i < 4; ++i) {
            uint256 offset;
            assembly ("memory-safe") {
                offset := mload(add(add(data, 0x20), mul(i, 0x20)))
            }
            if (offset < 192 || (offset & 31) != 0 || offset > data.length - 32) return false;
            uint256 length;
            assembly ("memory-safe") {
                length := mload(add(add(data, 0x20), offset))
            }
            uint256 remaining = data.length - offset - 32;
            if (length > remaining) return false;
            uint256 padded = (length + 31) & ~uint256(31);
            if (padded > remaining) return false;
        }
        uint256 dominant;
        uint256 colours;
        assembly ("memory-safe") {
            dominant := mload(add(data, 0xa0))
            colours := mload(add(data, 0xc0))
        }
        return dominant <= type(uint8).max && colours <= type(uint8).max;
    }

    function _validAbiString(bytes memory data) private pure returns (bool) {
        if (data.length < 64) return false;
        uint256 offset;
        uint256 length;
        assembly ("memory-safe") {
            offset := mload(add(data, 0x20))
        }
        if (offset != 32 || offset > data.length - 32) return false;
        assembly ("memory-safe") {
            length := mload(add(add(data, 0x20), offset))
        }
        uint256 remaining = data.length - offset - 32;
        if (length > remaining) return false;
        uint256 padded = (length + 31) & ~uint256(31);
        return padded <= remaining;
    }

    function _tokenExternalUrl(uint256 tokenId) private view returns (string memory) {
        bytes memory link = bytes(_externalLink);
        if (link.length != 0 && link[link.length - 1] == 0x2f) {
            return string.concat(_externalLink, "#/labs?token=", tokenId.toString());
        }
        return string.concat(_externalLink, "/#/labs?token=", tokenId.toString());
    }

    function _fallbackKind(string memory labName) private pure returns (string memory) {
        bytes32 hash = keccak256(bytes(labName));
        if (hash == keccak256(bytes("flipbook"))) return "Reel";
        if (hash == keccak256(bytes("forks"))) return "Fork";
        if (hash == keccak256(bytes("sleepwalker"))) return "Dream";
        if (hash == keccak256(bytes("cd-burner"))) return "CD";
        string memory title = _titleCase(labName);
        return bytes(title).length == 0 ? "Lab" : title;
    }

    /// @dev "flipbook" -> "Flipbook", "finale auction" -> "Finale Auction", "cd-burner" -> "CD Burner".
    ///      Separators (space, '-', '_') become spaces; words of one or two letters are fully uppercased.
    function _titleCase(string memory value) private pure returns (string memory) {
        bytes memory out = bytes(value);
        uint256 wordStart;
        for (uint256 i; i <= out.length; ++i) {
            bool boundary = i == out.length || out[i] == 0x20 || out[i] == 0x2d || out[i] == 0x5f;
            if (!boundary) continue;
            if (i < out.length) out[i] = 0x20;
            bool shortWord = i - wordStart <= 2;
            for (uint256 j = wordStart; j < i; ++j) {
                bytes1 c = out[j];
                if ((j == wordStart || shortWord) && c >= 0x61 && c <= 0x7a) out[j] = bytes1(uint8(c) - 32);
            }
            wordStart = i + 1;
        }
        return string(out);
    }

    function _lower(string memory value) private pure returns (string memory) {
        bytes memory out = bytes(value);
        for (uint256 i; i < out.length; ++i) {
            bytes1 c = out[i];
            if (c >= 0x41 && c <= 0x5a) out[i] = bytes1(uint8(c) + 32);
        }
        return string(out);
    }

    function _placeholderImage() private pure returns (bytes memory) {
        return bytes(
            string.concat(
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
                '<rect width="512" height="512" fill="#0b0b0c"/>',
                '<rect x="24" y="24" width="464" height="464" fill="none" stroke="#f2efe9"/>',
                '<text x="48" y="264" fill="#f2efe9" font-family="monospace" font-size="32">r3OS labs</text>',
                '</svg>'
            )
        );
    }

    function _jsonEscape(string memory value) private pure returns (string memory) {
        bytes memory src = bytes(value);
        uint256 extra;
        for (uint256 i; i < src.length; ++i) {
            if (src[i] == 0x22 || src[i] == 0x5c) ++extra;
        }
        if (extra == 0) return value;
        bytes memory out = new bytes(src.length + extra);
        uint256 j;
        for (uint256 i; i < src.length; ++i) {
            bytes1 c = src[i];
            if (c == 0x22 || c == 0x5c) out[j++] = 0x5c;
            out[j++] = c;
        }
        return string(out);
    }
}
