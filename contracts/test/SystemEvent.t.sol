// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {R3tardsSystemEvent} from "../src/operator/R3tardsSystemEvent.sol";
import {MockMonUsdFeed} from "./MockMonUsdFeed.sol";

contract ConfigurableFeed {
    uint8 public immutable decimals;
    string public description = "MOCK MON / USD";
    uint80 public roundId = 1;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;
    bool public shouldRevert;

    constructor(uint8 decimals_) {
        decimals = decimals_;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
    }

    function setRound(uint80 round_, int256 answer_, uint256 updatedAt_, uint80 answered_) external {
        roundId = round_;
        answer = answer_;
        startedAt = updatedAt_;
        updatedAt = updatedAt_;
        answeredInRound = answered_;
    }

    function setRevert(bool value) external {
        shouldRevert = value;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        if (shouldRevert) revert("feed unavailable");
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

contract SystemEventTest is Test {
    MockMonUsdFeed feed;
    R3tardsSystemEvent event_;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(100_000);
        feed = new MockMonUsdFeed();
        feed.setAnswer(2_995_769);
        event_ = new R3tardsSystemEvent(address(feed), 333, 90_000);
    }

    function testThresholdMathAtEightAndEighteenDecimals() public {
        assertEq(event_.THRESHOLD(), 33_300_000);

        ConfigurableFeed eighteen = new ConfigurableFeed(18);
        R3tardsSystemEvent e18 = new R3tardsSystemEvent(address(eighteen), 333, 90_000);
        assertEq(e18.THRESHOLD(), 333_000_000_000_000_000);
    }

    function testConstructorRejectsBadInputsAndDecimals() public {
        vm.expectRevert(R3tardsSystemEvent.ZeroAddress.selector);
        new R3tardsSystemEvent(address(0), 333, 1);

        address eoa = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(R3tardsSystemEvent.NotAContract.selector, eoa));
        new R3tardsSystemEvent(eoa, 333, 1);

        ConfigurableFeed two = new ConfigurableFeed(2);
        vm.expectRevert(abi.encodeWithSelector(R3tardsSystemEvent.BadDecimals.selector, 2));
        new R3tardsSystemEvent(address(two), 333, 1);

        ConfigurableFeed nineteen = new ConfigurableFeed(19);
        vm.expectRevert(abi.encodeWithSelector(R3tardsSystemEvent.BadDecimals.selector, 19));
        new R3tardsSystemEvent(address(nineteen), 333, 1);

        vm.expectRevert(R3tardsSystemEvent.BadThreshold.selector);
        new R3tardsSystemEvent(address(feed), 0, 1);

        vm.expectRevert(R3tardsSystemEvent.BadMaxAge.selector);
        new R3tardsSystemEvent(address(feed), 333, 0);
    }

    function testMainnetGuardRejectsWrongFeedAndAcceptsOfficialCode() public {
        address wrong = address(feed);
        vm.chainId(143);
        vm.expectRevert(abi.encodeWithSelector(R3tardsSystemEvent.WrongMainnetFeed.selector, wrong));
        new R3tardsSystemEvent(wrong, 333, 90_000);

        address official = 0xBcD78f76005B7515837af6b50c7C52BCf73822fb;
        vm.etch(official, wrong.code);
        R3tardsSystemEvent accepted = new R3tardsSystemEvent(official, 333, 90_000);
        assertEq(accepted.FEED(), official);
    }

    function testPhaseEncodedRoundIdIsPreserved() public {
        ConfigurableFeed phaseFeed = new ConfigurableFeed(8);
        uint80 phaseRound = uint80((uint256(1) << 64) + 595_477);
        phaseFeed.setRound(phaseRound, 33_300_000, block.timestamp, phaseRound);
        R3tardsSystemEvent target = new R3tardsSystemEvent(address(phaseFeed), 333, 90_000);

        (bool met, bool fresh,, uint256 updatedAt, uint80 roundId) = target.condition();
        assertTrue(met);
        assertTrue(fresh);
        assertEq(roundId, phaseRound);
        assertEq(updatedAt, block.timestamp);

        target.activate();
        assertEq(target.activationRound(), phaseRound);
    }

    function testConditionNeverRevertsAndActivateRejectsInvalidRounds() public {
        ConfigurableFeed targetFeed = new ConfigurableFeed(8);
        R3tardsSystemEvent target = new R3tardsSystemEvent(address(targetFeed), 333, 100);

        targetFeed.setRound(2, 33_300_000, 0, 2);
        _assertConditionFalse(target);
        vm.expectRevert(R3tardsSystemEvent.StaleAnswer.selector);
        target.activate();

        targetFeed.setRound(3, 33_300_000, block.timestamp + 1, 3);
        _assertConditionFalse(target);
        vm.expectRevert(R3tardsSystemEvent.StaleAnswer.selector);
        target.activate();

        targetFeed.setRound(4, 33_300_000, block.timestamp - 101, 4);
        _assertConditionFalse(target);
        vm.expectRevert(R3tardsSystemEvent.StaleAnswer.selector);
        target.activate();

        targetFeed.setRound(5, 33_300_000, block.timestamp, 4);
        _assertConditionFalse(target);
        vm.expectRevert(R3tardsSystemEvent.StaleAnswer.selector);
        target.activate();

        targetFeed.setRound(6, 0, block.timestamp, 6);
        _assertFreshUnmet(target);
        vm.expectRevert(
            abi.encodeWithSelector(R3tardsSystemEvent.BelowThreshold.selector, int256(0), int256(33_300_000))
        );
        target.activate();

        targetFeed.setRound(7, -1, block.timestamp, 7);
        _assertFreshUnmet(target);
        vm.expectRevert(
            abi.encodeWithSelector(R3tardsSystemEvent.BelowThreshold.selector, int256(-1), int256(33_300_000))
        );
        target.activate();

        targetFeed.setRound(8, 33_299_999, block.timestamp, 8);
        _assertFreshUnmet(target);
        vm.expectRevert(
            abi.encodeWithSelector(
                R3tardsSystemEvent.BelowThreshold.selector,
                int256(33_299_999),
                int256(33_300_000)
            )
        );
        target.activate();

        targetFeed.setRevert(true);
        (bool met, bool fresh, int256 answer, uint256 updatedAt, uint80 roundId) = target.condition();
        assertFalse(met);
        assertFalse(fresh);
        assertEq(answer, 0);
        assertEq(updatedAt, 0);
        assertEq(roundId, 0);
        vm.expectRevert(R3tardsSystemEvent.FeedUnavailable.selector);
        target.activate();
    }

    function testActivateAtExactThresholdStoresPermanentLatch() public {
        feed.setAnswer(33_300_000);
        vm.roll(123_456);
        vm.warp(1_800_000_100);

        vm.prank(alice);
        event_.activate();

        assertEq(event_.activatedBlock(), 123_456);
        assertEq(event_.activatedAt(), block.timestamp);
        assertEq(event_.activationAnswer(), 33_300_000);
        assertTrue(event_.activated());
        assertTrue(event_.activatedBefore(123_456));
        assertFalse(event_.activatedBefore(123_455));

        feed.setAnswer(1);
        (bool met,,,,) = event_.condition();
        assertFalse(met);
        assertTrue(event_.activated());

        vm.prank(bob);
        vm.expectRevert(R3tardsSystemEvent.AlreadyActivated.selector);
        event_.activate();
    }

    function testAnyCallerCanActivate() public {
        feed.setAnswer(33_300_001);
        vm.prank(bob);
        event_.activate();
        assertTrue(event_.activated());
    }

    function testNoAdminMutationSelectors() public {
        (bool ownerOk,) = address(event_).staticcall(abi.encodeWithSignature("owner()"));
        (bool resetOk,) = address(event_).call(abi.encodeWithSignature("reset()"));
        (bool pauseOk,) = address(event_).call(abi.encodeWithSignature("pause()"));
        (bool setterOk,) = address(event_).call(abi.encodeWithSignature("setAnswer(int256)", int256(1)));
        assertFalse(ownerOk);
        assertFalse(resetOk);
        assertFalse(pauseOk);
        assertFalse(setterOk);
    }


    function _assertFreshUnmet(R3tardsSystemEvent target) private view {
        (bool met, bool fresh,,,) = target.condition();
        assertFalse(met);
        assertTrue(fresh);
    }

    function _assertConditionFalse(R3tardsSystemEvent target) private view {
        (bool met, bool fresh,,,) = target.condition();
        assertFalse(met);
        assertFalse(fresh);
    }
}
