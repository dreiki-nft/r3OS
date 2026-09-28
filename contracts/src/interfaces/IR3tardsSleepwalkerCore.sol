// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IR3tardsPaintData} from "./IR3tardsPaintData.sol";

/// @notice The frozen Paint entry points Sleepwalker needs in addition to the shared read interface.
interface IR3tardsSleepwalkerCore is IR3tardsPaintData {
    function MAX_SESSION_BLOCKS() external view returns (uint256);
    function MIN_PIXELS_FOR_ACTIVE_DAY() external view returns (uint32);
    function sessionNonces(address owner) external view returns (uint256);

    function startSession(
        address owner,
        address sessionKey,
        uint256 expiryBlock,
        uint256 maxUnits,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external;

    function paint(bytes calldata runs, uint256[] calldata r3tardIds) external;
    function pixelAt(uint256 season, uint256 x, uint256 y) external view returns (uint8);
}
