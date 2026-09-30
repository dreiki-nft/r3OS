// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MonadHW} from "../lib/MonadHW.sol";

/// @notice Isolated MIP-4 reserve-condition demonstrator. No owner, admin or upgrade path.
contract R3tardsKernelDebugger is ReentrancyGuard {
    mapping(address => uint256) public processCount;
    mapping(address => uint256) public lastRunBlock;
    mapping(address => uint256) public lastNote;
    mapping(address => uint256) public credits;

    error OnlySelf();
    error RefundFailed();
    error NothingToWithdraw();
    error WithdrawFailed();
    error OptionalStepFailed();

    event Ping(address indexed sender, uint256 indexed blockNumber);
    event ProcessReport(
        address indexed owner,
        uint256 indexed pid,
        bool graceful,
        uint256 value,
        bool reserveOk,
        bool dipAtEntry,
        bool dipAfter,
        bool optionalOk,
        bool valueKept
    );
    event Withdrawn(address indexed owner, uint256 value);

    function ping() external {
        emit Ping(msg.sender, block.number);
    }

    function run(bool graceful, bool failOptional) external payable nonReentrant returns (uint256 pid) {
        pid = ++processCount[msg.sender];
        lastRunBlock[msg.sender] = block.number;

        (bool dipAtEntry, bool reserveOk) = MonadHW.dippedIntoReserve();

        bool optionalOk;
        try this.optionalStep(msg.sender, failOptional) {
            optionalOk = true;
        } catch {
            optionalOk = false;
        }

        bool dipAfter = dipAtEntry;
        bool valueKept;
        if (msg.value > 0) {
            if (graceful && reserveOk && dipAtEntry) {
                (bool refunded,) = payable(msg.sender).call{value: msg.value, gas: 10_000}("");
                if (!refunded) revert RefundFailed();
                (dipAfter,) = MonadHW.dippedIntoReserve();
            } else {
                credits[msg.sender] += msg.value;
                valueKept = true;
                (dipAfter,) = MonadHW.dippedIntoReserve();
            }
        }

        emit ProcessReport(
            msg.sender,
            pid,
            graceful,
            msg.value,
            reserveOk,
            dipAtEntry,
            dipAfter,
            optionalOk,
            valueKept
        );
    }

    function optionalStep(address owner, bool failOptional) external {
        if (msg.sender != address(this)) revert OnlySelf();
        lastNote[owner] = block.number;
        if (failOptional) revert OptionalStepFailed();
    }

    function withdraw() external nonReentrant {
        uint256 value = credits[msg.sender];
        if (value == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: value}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(msg.sender, value);
    }
}
