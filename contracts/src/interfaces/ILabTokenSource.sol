// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Metadata and burn policy supplied by a Lab for tokens minted by the shared Labs collection.
interface ILabTokenSource {
    /// @dev `imageSvg` is raw SVG bytes. The collection base64-encodes it once into the token JSON.
    /// `attributes` is either empty or a comma-prefixed JSON attribute fragment.
    function labToken(uint256 tokenId) external view returns (
        string memory kind,
        string memory description,
        bytes memory imageSvg,
        string memory attributes,
        uint8 dominantColour,
        uint8 coloursUsed
    );

    function canBurn(uint256 tokenId) external view returns (bool);
}
