// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}

/// @notice Permanent .333 system-event latch driven only by the Chainlink MON / USD feed.
contract R3OSSystemEvent {
    string public constant TRIGGER = "MON_PRICE_TRIGGER";
    address public constant OFFICIAL_MON_USD_FEED = 0xBcD78f76005B7515837af6b50c7C52BCf73822fb;

    address public immutable FEED;
    uint8 public immutable FEED_DECIMALS;
    uint256 public immutable THRESHOLD_MILLI_USD;
    int256 public immutable THRESHOLD;
    uint256 public immutable MAX_AGE;

    uint48 public activatedBlock;
    uint48 public activatedAt;
    uint80 public activationRound;
    int256 public activationAnswer;

    error ZeroAddress();
    error NotAContract(address target);
    error WrongMainnetFeed(address target);
    error BadDecimals(uint8 decimals);
    error BadThreshold();
    error BadMaxAge();
    error AlreadyActivated();
    error FeedUnavailable();
    error StaleAnswer();
    error BelowThreshold(int256 answer, int256 threshold);

    event SystemEventActivated(
        bytes32 indexed trigger,
        uint256 blockNumber,
        int256 answer,
        uint80 roundId,
        uint256 updatedAt,
        address indexed activator
    );

    constructor(address feed, uint256 thresholdMilliUsd, uint256 maxAge) {
        if (feed == address(0)) revert ZeroAddress();
        if (feed.code.length == 0) revert NotAContract(feed);
        if (block.chainid == 143 && feed != OFFICIAL_MON_USD_FEED) revert WrongMainnetFeed(feed);
        if (thresholdMilliUsd == 0) revert BadThreshold();
        if (maxAge == 0) revert BadMaxAge();

        uint8 decimals_;
        try IAggregatorV3(feed).decimals() returns (uint8 value) {
            decimals_ = value;
        } catch {
            revert FeedUnavailable();
        }
        if (decimals_ < 3 || decimals_ > 18) revert BadDecimals(decimals_);

        FEED = feed;
        FEED_DECIMALS = decimals_;
        THRESHOLD_MILLI_USD = thresholdMilliUsd;
        THRESHOLD = int256((thresholdMilliUsd * (10 ** uint256(decimals_))) / 1000);
        MAX_AGE = maxAge;
    }

    function condition()
        external
        view
        returns (bool met, bool fresh, int256 answer, uint256 updatedAt, uint80 roundId)
    {
        uint80 answeredInRound;
        try IAggregatorV3(FEED).latestRoundData() returns (
            uint80 roundId_,
            int256 answer_,
            uint256,
            uint256 updatedAt_,
            uint80 answeredInRound_
        ) {
            roundId = roundId_;
            answer = answer_;
            updatedAt = updatedAt_;
            answeredInRound = answeredInRound_;
        } catch {
            return (false, false, 0, 0, 0);
        }

        fresh = _fresh(roundId, answeredInRound, updatedAt);
        met = fresh && answer > 0 && answer >= THRESHOLD;
    }

    function activate() external {
        if (activatedBlock != 0) revert AlreadyActivated();

        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 answeredInRound;
        try IAggregatorV3(FEED).latestRoundData() returns (
            uint80 roundId_,
            int256 answer_,
            uint256,
            uint256 updatedAt_,
            uint80 answeredInRound_
        ) {
            roundId = roundId_;
            answer = answer_;
            updatedAt = updatedAt_;
            answeredInRound = answeredInRound_;
        } catch {
            revert FeedUnavailable();
        }

        if (!_fresh(roundId, answeredInRound, updatedAt)) revert StaleAnswer();
        if (answer <= 0 || answer < THRESHOLD) revert BelowThreshold(answer, THRESHOLD);

        activatedBlock = uint48(block.number);
        activatedAt = uint48(block.timestamp);
        activationRound = roundId;
        activationAnswer = answer;

        emit SystemEventActivated(
            keccak256(bytes(TRIGGER)),
            block.number,
            answer,
            roundId,
            updatedAt,
            msg.sender
        );
    }

    function activated() external view returns (bool) {
        return activatedBlock != 0;
    }

    function activatedBefore(uint256 blockNumber) external view returns (bool) {
        uint48 block_ = activatedBlock;
        return block_ != 0 && block_ <= blockNumber;
    }

    function _fresh(uint80 roundId, uint80 answeredInRound, uint256 updatedAt) private view returns (bool) {
        if (updatedAt == 0 || updatedAt > block.timestamp) return false;
        if (answeredInRound < roundId) return false;
        return block.timestamp - updatedAt <= MAX_AGE;
    }
}
