// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFrameRenderer {
    /// @notice Return a complete tokenURI for `tokenId` owned by `paint`.
    /// @dev The core calls this with a gas cap and falls back to renderer 0 on failure.
    function tokenURI(address paint, uint256 tokenId) external view returns (string memory);
}
