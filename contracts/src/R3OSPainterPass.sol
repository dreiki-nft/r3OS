// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IR3OSPaintData} from "./interfaces/IR3OSPaintData.sol";
import {IStampSource} from "./interfaces/IStampSource.sol";
import {PassArt} from "./lib/PassArt.sol";

/// @notice ERC-5192-style soulbound painter credential. It grants no privileges.
contract R3OSPainterPass is ERC721, Ownable2Step {
    using Strings for uint256;

    uint256 public constant STAMP_SOURCE_GAS_LIMIT = 100_000;

    IR3OSPaintData public immutable PAINT;
    uint256 private _nextTokenId = 1;
    mapping(address => uint256) public passOf;
    mapping(address => bool) public hasClaimed;
    address[] private _stampSources;
    bool[] private _stampSourceEnabled;
    string private _externalLink;

    error NoPaintYet();
    error AlreadyClaimed();
    error SessionKeyCannotClaim();
    error Soulbound();
    error NotAuthorized();
    error InvalidStampSource();
    error InvalidStampSourceIndex(uint256 sourceId);

    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    event StampSourceAdded(uint256 indexed sourceId, address indexed source);
    event StampSourceEnabled(uint256 indexed sourceId, bool enabled);
    event ContractURIUpdated();

    constructor(address paint) ERC721("r3OS painter pass", "R3OSPASS") Ownable(msg.sender) {
        if (paint == address(0)) revert NoPaintYet();
        PAINT = IR3OSPaintData(paint);
    }

    function claim() external returns (uint256 tokenId) {
        if (PAINT.isActiveSessionKey(msg.sender)) revert SessionKeyCannotClaim();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        (,,,,,, uint64 paintCount,,,) = PAINT.painterStats(msg.sender);
        if (paintCount == 0) revert NoPaintYet();
        tokenId = _nextTokenId++;
        passOf[msg.sender] = tokenId;
        hasClaimed[msg.sender] = true;
        _mint(msg.sender, tokenId);
        emit Locked(tokenId);
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function burn(uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        if (msg.sender != tokenOwner) revert NotAuthorized();
        passOf[tokenOwner] = 0;
        _burn(tokenId);
    }

    /// @notice Append a view-only Lab stamp source. It cannot grant contract privileges.
    function addStampSource(address source) external onlyOwner returns (uint256 sourceId) {
        if (source == address(0) || source.code.length == 0) revert InvalidStampSource();
        sourceId = _stampSources.length;
        _stampSources.push(source);
        _stampSourceEnabled.push(true);
        emit StampSourceAdded(sourceId, source);
    }

    function stampSourceCount() external view returns (uint256) {
        return _stampSources.length;
    }

    function stampSource(uint256 sourceId) external view returns (address) {
        return _stampSources[sourceId];
    }

    function stampSourceEnabled(uint256 sourceId) external view returns (bool) {
        if (sourceId >= _stampSources.length) revert InvalidStampSourceIndex(sourceId);
        return _stampSourceEnabled[sourceId];
    }

    function setStampSourceEnabled(uint256 sourceId, bool enabled) external onlyOwner {
        if (sourceId >= _stampSources.length) revert InvalidStampSourceIndex(sourceId);
        _stampSourceEnabled[sourceId] = enabled;
        emit StampSourceEnabled(sourceId, enabled);
    }

    function externalLink() external view returns (string memory) {
        return _externalLink;
    }

    function setExternalLink(string calldata nextLink) external onlyOwner {
        _externalLink = nextLink;
        emit ContractURIUpdated();
    }

    function contractURI() external view returns (string memory) {
        bytes memory svg = bytes(
            string.concat(
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
                '<rect width="512" height="512" fill="#f2efe9"/>',
                '<rect x="28" y="28" width="456" height="456" fill="none" stroke="#0b0b0c"/>',
                '<rect x="52" y="74" width="96" height="96" fill="#0b0b0c"/>',
                '<rect x="364" y="74" width="96" height="96" fill="#0b0b0c"/>',
                '<rect x="116" y="214" width="8" height="8" fill="#5feddf"/>',
                '<rect x="388" y="286" width="6" height="6" fill="#5feddf"/>',
                '<text x="36" y="442" fill="#0b0b0c" font-family="monospace" font-size="38">r3 pass</text>',
                '</svg>'
            )
        );
        bytes memory json = abi.encodePacked(
            '{"name":"r3OS painter pass",',
            '"description":"Soulbound painter credentials for r3OS paint. Fully onchain on Monad.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(svg), '",',
            '"external_link":"', _jsonEscape(_externalLink), '",',
            '"seller_fee_basis_points":0,',
            '"fee_recipient":"', LibString.toHexStringChecksummed(address(0)), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address tokenOwner = ownerOf(tokenId);
        (
            uint32 activeDays,
            ,
            uint96 totalPixelsPainted,
            uint48 framesMinted,
            uint48 firstPaintBlock,
            ,
            ,
            ,
            uint64 sessionPaints,
            uint64 stormPaints
        ) = PAINT.painterStats(tokenOwner);
        uint32 paintedDays = PAINT.daysPainted(tokenOwner);
        bool holder = PAINT.isR3tardHolder(tokenOwner);

        uint256 pinMask;
        if (firstPaintBlock != 0) pinMask |= 1 << 0;
        if (framesMinted != 0) pinMask |= 1 << 1;
        if (sessionPaints >= 10) pinMask |= 1 << 2;
        if (stormPaints != 0) pinMask |= 1 << 3;
        if (activeDays >= 7) pinMask |= 1 << 4;
        if (holder) pinMask |= 1 << 5;

        bytes memory extraAttributes;
        for (uint256 i; i < _stampSources.length; ++i) {
            if (!_stampSourceEnabled[i]) continue;
            // forge-lint: disable-start(return-bomb)
            (bool ok, bytes memory data) = _stampSources[i].staticcall{gas: STAMP_SOURCE_GAS_LIMIT}(
                abi.encodeCall(IStampSource.stamp, (tokenOwner))
            );
            // forge-lint: disable-end(return-bomb)
            if (!ok || !_validStampReturn(data)) continue;
            (string memory name, bool earned) = abi.decode(data, (string, bool));
            if (earned) {
                uint256 pin = 6 + i;
                if (pin < PassArt.MAX_PINS) pinMask |= 1 << pin;
                if (bytes(name).length != 0) {
                    extraAttributes = abi.encodePacked(
                        extraAttributes,
                        ',{"trait_type":"Stamp: ',
                        _jsonEscape(name),
                        '","value":"earned"}'
                    );
                }
            }
        }

        uint256 pinCount = 6 + _stampSources.length;
        if (pinCount > PassArt.MAX_PINS) pinCount = PassArt.MAX_PINS;
        PassArt.Params memory params = PassArt.Params({
            owner: tokenOwner,
            tokenId: tokenId,
            pixels: totalPixelsPainted,
            frames: framesMinted,
            days_: paintedDays,
            stormPaints: stormPaints,
            firstPaintBlock: firstPaintBlock,
            holder: holder,
            pinCount: pinCount,
            pinMask: pinMask
        });
        (uint32 df1Seed, uint256 df1Amount) = PassArt.df1Params(params);
        bytes memory image = PassArt.svg(params);

        bytes memory json = abi.encodePacked(
            '{"name":"r3 pass #',
            tokenId.toString(),
            '","description":"soulbound proof that this address painted the shared canvas. stamps update live and grant no advantages.","image":"data:image/svg+xml;base64,',
            Base64.encode(image),
            '","attributes":[',
            '{"trait_type":"Days painted","value":',
            uint256(paintedDays).toString(),
            '},',
            '{"trait_type":"Trust level","value":',
            uint256(activeDays).toString(),
            '},',
            '{"trait_type":"Pixels painted","value":',
            uint256(totalPixelsPainted).toString(),
            '},',
            '{"trait_type":"Frames minted","value":',
            uint256(framesMinted).toString(),
            '},',
            '{"trait_type":"Session paints","value":',
            uint256(sessionPaints).toString(),
            '},',
            '{"trait_type":"Storm paints","value":',
            uint256(stormPaints).toString(),
            '},',
            '{"trait_type":"Holder","value":"',
            holder ? 'yes' : 'no',
            '"},',
            '{"trait_type":"First paint block","value":',
            uint256(firstPaintBlock).toString(),
            '}',
            extraAttributes,
            ',{"trait_type":"DF1 seed","value":',
            uint256(df1Seed).toString(),
            '}',
            ',{"trait_type":"DF1 amount","value":',
            df1Amount.toString(),
            '}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function _validStampReturn(bytes memory data) internal pure returns (bool) {
        if (data.length < 96) return false;
        uint256 offset;
        uint256 earned;
        uint256 length;
        assembly ("memory-safe") {
            offset := mload(add(data, 0x20))
            earned := mload(add(data, 0x40))
        }
        if (offset != 64 || earned > 1 || offset > data.length - 32) return false;
        assembly ("memory-safe") {
            length := mload(add(add(data, 0x20), offset))
        }
        uint256 remaining = data.length - offset - 32;
        if (length > remaining) return false;
        uint256 padded = (length + 31) & ~uint256(31);
        return padded <= remaining;
    }

    function _jsonEscape(string memory value) internal pure returns (string memory) {
        bytes memory src = bytes(value);
        uint256 extra;
        for (uint256 i; i < src.length; ++i) if (src[i] == 0x22 || src[i] == 0x5c) ++extra;
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

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId);
    }
}
