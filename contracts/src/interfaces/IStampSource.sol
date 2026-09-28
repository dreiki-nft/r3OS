// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice View-only extension point for Painter Pass display stamps.
/// @dev A source grants no permissions in R3tardsPaint or the Painter Pass.
interface IStampSource {
    function stamp(address painter) external view returns (string memory name, bool earned);
}
