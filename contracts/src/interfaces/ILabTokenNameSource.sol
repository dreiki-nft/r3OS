// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Optional custom token-name hook for a source in the shared Labs collection.
interface ILabTokenNameSource {
    function labTokenName(uint256 tokenId) external view returns (string memory);
}
