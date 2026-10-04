// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal MRC-17 draft interface used by the r3OS Router Lab.
/// @dev Pinned to monad-crypto/MIPs PR #91 @ 6e4f86333923f0c4ec77bc92b3702f1b21f37446.
/// Reference adapters: haythemsellami/mrc-17-adapters @ 2f1400d17c262cec6c4860a99916accf7f3044d8.
interface IPropAMMRouter {
    event PropAMMSwap(
        address indexed sender,
        address to,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata quoteData)
        external
        returns (uint256 amountOut, bytes memory swapData);

    function swap(
        address tokenIn,
        address tokenOut,
        address to,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline,
        bytes calldata swapData
    ) external returns (uint256 amountOut);
}
