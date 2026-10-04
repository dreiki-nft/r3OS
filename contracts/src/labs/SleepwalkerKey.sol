// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IR3OSSleepwalkerCore} from "../interfaces/IR3OSSleepwalkerCore.sol";

/// @notice Tiny EIP-1167 session key used only by its Sleepwalker Lab clone factory.
contract SleepwalkerKey {
    address public lab;
    IR3OSSleepwalkerCore public core;

    error AlreadyInitialized();
    error OnlyLab();
    error ZeroAddress();
    error InactiveSession();

    modifier onlyLab() {
        if (msg.sender != lab) revert OnlyLab();
        _;
    }

    function initialize(address core_) external {
        if (lab != address(0)) revert AlreadyInitialized();
        if (core_ == address(0)) revert ZeroAddress();
        lab = msg.sender;
        core = IR3OSSleepwalkerCore(core_);
    }

    function start(
        address owner,
        uint256 expiryBlock,
        uint256 maxUnits,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external onlyLab {
        core.startSession(owner, address(this), expiryBlock, maxUnits, nonce, deadline, sig);
    }

    function paint(bytes calldata runs, uint256[] calldata holderIds) external onlyLab {
        if (!core.isActiveSessionKey(address(this))) revert InactiveSession();
        core.paint(runs, holderIds);
    }
}
