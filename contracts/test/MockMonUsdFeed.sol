// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Local/testnet-only Chainlink-shaped MON / USD feed.
contract MockMonUsdFeed {
    uint8 public constant decimals = 8;
    string public constant description = "MOCK MON / USD";

    uint80 public roundId = 1;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;

    constructor() {
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 nextAnswer) external {
        roundId += 1;
        answer = nextAnswer;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    function setUpdatedAt(uint256 nextUpdatedAt) external {
        updatedAt = nextUpdatedAt;
    }

    function setAnsweredInRound(uint80 value) external {
        answeredInRound = value;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}
