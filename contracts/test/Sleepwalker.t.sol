// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {R3tardsSleepwalker} from "../src/labs/R3tardsSleepwalker.sol";
import {SleepwalkerKey} from "../src/labs/SleepwalkerKey.sol";
import {LabTraits} from "../src/lib/LabTraits.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract ToggleRefundOwner {
    R3tardsPaint public immutable paint;
    R3tardsSleepwalker public immutable sleepwalker;
    bool public rejectRefunds = true;

    constructor(R3tardsPaint paint_, R3tardsSleepwalker sleepwalker_) {
        paint = paint_;
        sleepwalker = sleepwalker_;
    }

    receive() external payable {
        if (rejectRefunds || gasleft() < 50_000) revert("refund rejected");
    }

    function setRejectRefunds(bool reject_) external {
        rejectRefunds = reject_;
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function paintByHand(bytes calldata runs) external {
        paint.paint(runs, new uint256[](0));
    }

    function goToSleep(
        bytes calldata stencil,
        R3tardsSleepwalker.StartSessionAuthorization[] calldata sessions,
        uint256 tip
    ) external payable {
        sleepwalker.sleep{value: msg.value}(stencil, new uint256[](0), sessions, tip);
    }

    function withdrawRefund() external {
        sleepwalker.withdrawRefund();
    }

    function withdrawRefundTo(address to) external {
        sleepwalker.withdrawRefundTo(to);
    }

    function wake() external {
        sleepwalker.wake();
    }
}

contract SleepwalkerTest is Test {
    R3tardsPaint paint;
    R3tardsLabs labs;
    R3tardsSleepwalker sleepwalker;
    SleepwalkerKey keyImplementation;
    MockR3tards r3tards;

    uint256 ownerPk = 0xA11CE;
    address owner;
    address cranker = address(0xC0FFEE);
    uint256 experimentId;

    function setUp() public {
        vm.roll(10_000);
        owner = vm.addr(ownerPk);
        vm.deal(owner, 100 ether);
        vm.deal(cranker, 0);
        r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards),
            uint64(vm.getBlockTimestamp()),
            address(this),
            address(this),
            512,
            0,
            512,
            20,
            256
        );
        labs = new R3tardsLabs(address(paint), address(this));
        keyImplementation = new SleepwalkerKey();
        sleepwalker = new R3tardsSleepwalker(address(paint), address(labs), address(keyImplementation));
        experimentId = paint.addExperiment(address(sleepwalker), "sleepwalker", "");
        sleepwalker.bindExperimentId(experimentId);
    }

    function testMainFlowAllowanceMidnightAndActiveDays() public {
        _humanPaint(0, 0, 19, 4);
        _assertActiveDays(1);

        bytes memory stencil = _run(10, 0, 99, 5);
        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions = _signedSessions(4, 4_096);
        uint256 tip = 0.01 ether;
        vm.prank(owner);
        sleepwalker.sleep{value: 0.1 ether}(stencil, _emptyIds(), sessions, tip);

        uint256 beforeCranker = cranker.balance;
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Painted));
        assertEq(cranker.balance, beforeCranker + tip);

        (, uint256 cursor,,,,,,) = sleepwalker.dreamOf(owner);
        assertEq(cursor, 40);
        (uint256 human, uint256 dream, uint256 allowance, bool passes) = sleepwalker.allowanceOf(owner);
        assertEq(human, 20);
        assertEq(dream, 40);
        assertEq(allowance, 0);
        assertTrue(passes);
        _assertActiveDays(1);

        vm.roll(vm.getBlockNumber() + 100);
        vm.prank(cranker);
        (code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Allowance));

        uint256 tomorrow = ((vm.getBlockTimestamp() / 1 days) + 1) * 1 days;
        vm.warp(tomorrow);
        vm.roll(vm.getBlockNumber() + 100);
        vm.prank(cranker);
        (code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.NotPaintedToday));
        _assertActiveDays(1);

        _humanPaint(1, 0, 19, 6);
        _assertActiveDays(2);
        vm.prank(cranker);
        (code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Painted));
        _assertActiveDays(2);
        assertEq(sleepwalker.dreamingDays(owner), 2);
    }

    function testFuzzDreamCannotCreateActiveDay(uint8 humanRaw, uint8 dreamRaw) public {
        uint256 human = bound(uint256(humanRaw), 0, 64);
        uint256 dreamPixels = bound(uint256(dreamRaw), 1, 64);
        if (human != 0) _humanPaint(2, 0, uint8(human - 1), 4);
        uint256 expectedDays = human >= paint.MIN_PIXELS_FOR_ACTIVE_DAY() ? 1 : 0;

        _sleep(_run(12, 0, uint8(dreamPixels - 1), 5), 1, 128, 1 wei, 0);
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        if (expectedDays == 0) {
            assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.NotPaintedToday));
        } else {
            assertTrue(
                code == R3tardsSleepwalker.StepCode.Painted || code == R3tardsSleepwalker.StepCode.Complete
            );
        }
        _assertActiveDays(expectedDays);
        _assertKeyNeverPaintedAsItself();
    }

    function testSessionChainingStartsSecondOnlyAfterFirstExpires() public {
        _humanPaint(3, 0, 99, 4);
        uint256 maxBlocks = paint.MAX_SESSION_BLOCKS();
        uint256 firstExpiry = vm.getBlockNumber() + maxBlocks;
        _sleep(_run(13, 0, 199, 5), 2, 64, 1 wei, 0);

        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode first,) = sleepwalker.step(owner);
        assertEq(uint256(first), uint256(R3tardsSleepwalker.StepCode.Painted));
        assertEq(paint.sessionNonces(owner), 1);

        vm.roll(firstExpiry + 1);
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode second,) = sleepwalker.step(owner);
        assertEq(uint256(second), uint256(R3tardsSleepwalker.StepCode.Painted));
        assertEq(paint.sessionNonces(owner), 2);
        (address sessionOwner,,,,, bool active) = paint.sessionInfo(sleepwalker.keyOf(owner));
        assertEq(sessionOwner, owner);
        assertTrue(active);
        _assertKeyNeverPaintedAsItself();
    }

    function testSec_ExhaustedStoredSessionsStall() public {
        _humanPaint(4, 0, 63, 4);
        uint256 firstExpiry = vm.getBlockNumber() + paint.MAX_SESSION_BLOCKS();
        _sleep(_run(14, 0, 199, 5), 3, 256, 1 wei, 0);

        vm.roll(firstExpiry + 1);
        _consumeNonceWithLiveKey(0xB001);
        _consumeNonceWithLiveKey(0xB002);
        assertEq(paint.sessionNonces(owner), 3);

        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Stalled));
        (,,,,,,, bool stalled) = sleepwalker.dreamOf(owner);
        assertTrue(stalled);
        _assertKeyNeverPaintedAsItself();
    }

    function testTipOnlyPaidOnSuccessfulPaintAndBudgetFailureDoesNotAdvance() public {
        bytes memory fullBudget = abi.encodePacked(_run(5, 0, 255, 4), _run(6, 0, 255, 4));
        vm.prank(owner);
        paint.paint(fullBudget, _emptyIds());
        _assertActiveDays(1);

        uint256 tip = 0.02 ether;
        _sleep(_run(15, 0, 63, 5), 1, 128, tip, 0.1 ether);

        uint256 beforeBalance = cranker.balance;
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Budget));
        assertEq(cranker.balance, beforeBalance);
        (, uint256 cursor,, uint256 deposit,,,,) = sleepwalker.dreamOf(owner);
        assertEq(cursor, 0);
        assertEq(deposit, 0.1 ether);
    }

    function testHotTilePaysNoTipAndDoesNotAdvance() public {
        _humanPaint(100, 0, 63, 4);
        _setTileHeat(0, 512);

        uint256 tip = 0.02 ether;
        _sleep(_run(0, 0, 9, 5), 1, 128, tip, 0.1 ether);

        uint256 beforeBalance = cranker.balance;
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.CoreRejected));
        assertEq(cranker.balance, beforeBalance);
        (, uint256 cursor,, uint256 deposit,,,,) = sleepwalker.dreamOf(owner);
        assertEq(cursor, 0);
        assertEq(deposit, 0.1 ether);
    }

    function testWakeRefundsDeletesSignaturesAndStampCountsDreamingDays() public {
        _humanPaint(7, 0, 19, 4);
        uint256 deposit = 0.1 ether;
        uint256 tip = 0.01 ether;
        _sleep(_run(16, 0, 63, 5), 2, 256, tip, deposit);
        vm.prank(cranker);
        sleepwalker.step(owner);

        (string memory stampName, bool earned) = sleepwalker.stamp(owner);
        assertEq(stampName, "DREAMING DAYS 1");
        assertTrue(earned);

        uint256 balanceBefore = owner.balance;
        vm.prank(owner);
        sleepwalker.wake();
        assertEq(owner.balance, balanceBefore + deposit - tip);
        (address pointer,,,,,,,) = sleepwalker.dreamOf(owner);
        assertEq(pointer, address(0));

        vm.roll(vm.getBlockNumber() + paint.MAX_SESSION_BLOCKS() + 1);
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.NoDream));
    }

    function testDreamCompleteAutoWakesAndRefunds() public {
        _humanPaint(8, 0, 19, 4);
        uint256 deposit = 0.1 ether;
        uint256 tip = 0.01 ether;
        _sleep(_run(17, 0, 9, 5), 1, 128, tip, deposit);

        uint256 ownerBefore = owner.balance;
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Complete));
        (, uint256 cursor, uint256 total, uint256 left,, uint256 sessionsLeft,,) = sleepwalker.dreamOf(owner);
        assertEq(cursor, total);
        assertEq(total, 10);
        assertEq(left, 0);
        assertEq(sessionsLeft, 0);
        assertEq(owner.balance, ownerBefore + deposit - tip);

        vm.prank(cranker);
        (code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Complete));
    }

    function testMintAfterCompleteAndTraitsAreValidJson() public {
        _humanPaint(9, 0, 19, 4);
        _sleep(_run(18, 0, 9, 5), 1, 128, 1 wei, 0);
        vm.prank(owner);
        sleepwalker.step(owner);

        vm.prank(owner);
        uint256 tokenId = sleepwalker.mintDream();
        assertEq(labs.ownerOf(tokenId), owner);
        bytes memory json = _json(labs.tokenURI(tokenId));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".attributes[0].value"), "Dream");
        assertEq(vm.parseJsonString(string(json), ".attributes[1].value"), "Sleepwalker");
        assertEq(vm.parseJsonUint(string(json), ".attributes[10].value"), 10);
        assertEq(vm.parseJsonString(string(json), ".attributes[11].value"), "Nap");
        assertEq(vm.parseJsonUint(string(json), ".attributes[12].value"), 1);
        assertEq(vm.parseJsonUint(string(json), ".attributes[13].value"), 1);
        assertEq(vm.parseJsonUint(string(json), ".attributes[14].value"), 1);
        assertEq(vm.parseJsonString(string(json), ".attributes[15].value"), "Alone");
        assertEq(vm.parseJsonString(string(json), ".attributes[16].value"), "yes");
        assertEq(vm.parseJsonUint(string(json), ".attributes[17].value"), 1);
        assertEq(vm.parseJsonString(string(json), ".attributes[18].value"), "Intact");
        assertTrue(_contains(string(json), "data:image/svg+xml;base64,"));
    }

    function testMintBeforeWakePersistsAfterWakeAndOnlyOncePerDream() public {
        _sleep(_run(19, 0, 9, 5), 1, 128, 1 wei, 0);
        vm.prank(owner);
        uint256 tokenId = sleepwalker.mintDream();
        bytes memory json = _json(labs.tokenURI(tokenId));
        assertEq(vm.parseJsonString(string(json), ".attributes[16].value"), "no");
        assertEq(vm.parseJsonUint(string(json), ".attributes[10].value"), 0);

        vm.prank(owner);
        vm.expectRevert(R3tardsSleepwalker.DreamAlreadyMinted.selector);
        sleepwalker.mintDream();
        vm.prank(owner);
        sleepwalker.wake();

        json = _json(labs.tokenURI(tokenId));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".attributes[16].value"), "no");
    }

    function testSurvivalBucketEdges() public {
        _assertSurvivalBucket(90, "Intact");
    }

    function testSurvivalFiftyPercentIsScarred() public {
        _assertSurvivalBucket(50, "Scarred");
    }

    function testSurvivalBelowFiftyIsGhost() public {
        _assertSurvivalBucket(49, "Ghost");
    }

    function testDreamTraitBucketEdges() public pure {
        assertEq(LabTraits.dreamSize(255), "Nap");
        assertEq(LabTraits.dreamSize(256), "Dream");
        assertEq(LabTraits.dreamSize(1_023), "Dream");
        assertEq(LabTraits.dreamSize(1_024), "Epic dream");
        assertEq(LabTraits.nightShift(1), "Alone");
        assertEq(LabTraits.nightShift(2), "Helped");
        assertEq(LabTraits.nightShift(5), "Helped");
        assertEq(LabTraits.nightShift(6), "Crowd");
        assertEq(LabTraits.survival(9_000), "Intact");
        assertEq(LabTraits.survival(8_999), "Scarred");
        assertEq(LabTraits.survival(5_000), "Scarred");
        assertEq(LabTraits.survival(4_999), "Ghost");
    }

    function testDryPaintBudgetUsesWorstCaseTwoUnitsPerPixel() public {
        bytes memory human = abi.encodePacked(_run(30, 0, 255, 4), _run(31, 0, 223, 4));
        vm.prank(owner);
        paint.paint(human, _emptyIds());
        (,, uint256 available,,) = paint.budgetOf(owner, _emptyIds());
        assertEq(available, 32);

        vm.roll(vm.getBlockNumber() + paint.WET_WINDOW_BLOCKS() * 2 + 1);
        _sleep(_run(30, 0, 31, 5), 1, 32, 1 wei, 0);

        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Painted));
        (, uint256 cursor,,,,,,) = sleepwalker.dreamOf(owner);
        assertEq(cursor, 16);
    }

    function testMissedSessionWindowStallsAndResumeKeepsProgress() public {
        _humanPaint(32, 0, 63, 4);
        bytes memory stencil = _run(33, 0, 95, 5);
        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions = _signedSessions(3, 256);
        uint256 missedExpiry = sessions[1].expiryBlock;
        vm.prank(owner);
        sleepwalker.sleep(stencil, _emptyIds(), sessions, 1 wei);

        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Painted));
        (, uint256 cursorBefore,,,,,,) = sleepwalker.dreamOf(owner);
        assertEq(cursorBefore, 64);

        vm.roll(missedExpiry + 1);
        address[] memory owners = new address[](1);
        owners[0] = owner;
        assertFalse(sleepwalker.stepReady(owners)[0]);
        (,,,,,,, bool stalled) = sleepwalker.dreamOf(owner);
        assertTrue(stalled);

        vm.prank(cranker);
        (code,) = sleepwalker.step(owner);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Stalled));

        R3tardsSleepwalker.StartSessionAuthorization[] memory fresh = _signedSessions(2, 256);
        vm.prank(owner);
        sleepwalker.resume(fresh);
        uint256 cursorAfter;
        (, cursorAfter,,,,,, stalled) = sleepwalker.dreamOf(owner);
        assertEq(cursorAfter, cursorBefore);
        assertFalse(stalled);

        vm.prank(cranker);
        (code,) = sleepwalker.step(owner);
        assertTrue(
            code == R3tardsSleepwalker.StepCode.Painted || code == R3tardsSleepwalker.StepCode.Complete
        );
    }

    function testCompletionCreditsRefundWhenOwnerRejectsMon() public {
        ToggleRefundOwner contractOwner = new ToggleRefundOwner(paint, sleepwalker);
        vm.deal(address(contractOwner), 1 ether);
        contractOwner.paintByHand(_run(34, 0, 19, 4));

        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions =
            new R3tardsSleepwalker.StartSessionAuthorization[](1);
        sessions[0] = R3tardsSleepwalker.StartSessionAuthorization({
            expiryBlock: vm.getBlockNumber() + paint.MAX_SESSION_BLOCKS(),
            maxUnits: 128,
            nonce: paint.sessionNonces(address(contractOwner)),
            deadline: vm.getBlockTimestamp() + 1 hours,
            sig: hex"01"
        });

        uint256 deposit = 0.1 ether;
        contractOwner.goToSleep{value: deposit}(_run(35, 0, 9, 5), sessions, 1 wei);

        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(address(contractOwner));
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Complete));
        assertEq(sleepwalker.refunds(address(contractOwner)), deposit - 1 wei);

        contractOwner.setRejectRefunds(false);
        uint256 before = address(contractOwner).balance;
        contractOwner.withdrawRefund();
        assertEq(sleepwalker.refunds(address(contractOwner)), 0);
        assertEq(address(contractOwner).balance, before + deposit - 1 wei);
    }

    function testStepReadyMatchesStepAcrossTwentyPseudoRandomStates() public {
        for (uint256 i; i < 20; ++i) {
            uint256 pk = 0x10000 + i;
            address painter = vm.addr(pk);
            vm.deal(painter, 10 ether);
            uint256 kind = uint256(keccak256(abi.encode(i, vm.getBlockNumber()))) % 5;
            uint8 humanY = uint8(40 + i * 2);

            if (kind != 0) {
                if (kind == 2) {
                    vm.prank(painter);
                    paint.paint(_run(humanY, 0, 19, 4), _emptyIds());
                } else if (kind == 3) {
                    vm.prank(painter);
                    paint.paint(_run(humanY, 0, 63, 4), _emptyIds());
                } else if (kind == 4) {
                    vm.prank(painter);
                    paint.paint(_run(humanY, 0, 31, 4), _emptyIds());
                }

                uint256 count = kind == 4 ? 2 : 1;
                R3tardsSleepwalker.StartSessionAuthorization[] memory sessions =
                    _signedSessionsFor(pk, painter, count, 256);
                vm.prank(painter);
                sleepwalker.sleep{value: 1 wei}(
                    _run(uint8(200 + i), 0, uint8(kind == 3 ? 99 : 9), 5),
                    _emptyIds(),
                    sessions,
                    1 wei
                );

                if (kind == 3) {
                    vm.prank(cranker);
                    sleepwalker.step(painter);
                } else if (kind == 4) {
                    vm.roll(sessions[1].expiryBlock + 1);
                }
            }

            address[] memory owners = new address[](1);
            owners[0] = painter;
            bool ready = sleepwalker.stepReady(owners)[0];
            vm.prank(cranker);
            (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(painter);
            bool painted = code == R3tardsSleepwalker.StepCode.Painted
                || (code == R3tardsSleepwalker.StepCode.Complete && kind != 0);
            assertEq(ready, painted, "stepReady mismatch");
        }
    }

    function testSec_ResumeAllowedWheneverCoreSessionIsInactive() public {
        _humanPaint(36, 0, 31, 4);
        R3tardsSleepwalker.StartSessionAuthorization[] memory first = _signedSessions(1, 256);
        vm.prank(owner);
        sleepwalker.sleep{value: 1 wei}(_run(37, 0, 95, 5), _emptyIds(), first, 1 wei);

        vm.roll(first[0].expiryBlock + 1);
        (,,,,,,, bool stalledBefore) = sleepwalker.dreamOf(owner);
        assertTrue(stalledBefore); // S1: exhausted sessions now report the dream as stalled

        R3tardsSleepwalker.StartSessionAuthorization[] memory fresh = _signedSessions(1, 256);
        vm.prank(owner);
        sleepwalker.resume(fresh);
        (,,,,,,, bool stalledAfter) = sleepwalker.dreamOf(owner);
        assertFalse(stalledAfter);
    }

    function testSec_NoChangeChunkSkipsWithoutTipAndStepReadyIsFalse() public {
        _humanPaint(38, 0, 63, 5);
        uint256 tip = 0.01 ether;
        uint256 deposit = 0.1 ether;
        _sleep(_run(38, 0, 63, 5), 1, 256, tip, deposit);

        address[] memory owners = new address[](1);
        owners[0] = owner;
        assertFalse(sleepwalker.stepReady(owners)[0]);

        uint256 crankerBefore = cranker.balance;
        uint256 gasBefore = gasleft();
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        uint256 gasUsed = gasBefore - gasleft();
        console.log("GAS Sleepwalker skipped step", gasUsed);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Skipped));
        assertEq(cranker.balance, crankerBefore);
        (, uint256 cursor,, uint256 remaining,,,,) = sleepwalker.dreamOf(owner);
        assertEq(cursor, 64);
        assertEq(remaining, 0);
    }

    function testSec_RefundPushIsGasCappedAndWakeCreditsOnFailure() public {
        ToggleRefundOwner contractOwner = new ToggleRefundOwner(paint, sleepwalker);
        vm.deal(address(contractOwner), 1 ether);

        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions =
            new R3tardsSleepwalker.StartSessionAuthorization[](1);
        sessions[0] = R3tardsSleepwalker.StartSessionAuthorization({
            expiryBlock: vm.getBlockNumber() + paint.MAX_SESSION_BLOCKS(),
            maxUnits: 128,
            nonce: paint.sessionNonces(address(contractOwner)),
            deadline: vm.getBlockTimestamp() + 1 hours,
            sig: hex"01"
        });

        uint256 deposit = 0.1 ether;
        contractOwner.goToSleep{value: deposit}(_run(39, 0, 9, 5), sessions, 1 wei);
        contractOwner.setRejectRefunds(false);
        contractOwner.wake();
        assertEq(sleepwalker.refunds(address(contractOwner)), deposit);
    }

    function testSec_WithdrawRefundToRecoversFromRejectingOwner() public {
        ToggleRefundOwner contractOwner = new ToggleRefundOwner(paint, sleepwalker);
        vm.deal(address(contractOwner), 1 ether);

        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions =
            new R3tardsSleepwalker.StartSessionAuthorization[](1);
        sessions[0] = R3tardsSleepwalker.StartSessionAuthorization({
            expiryBlock: vm.getBlockNumber() + paint.MAX_SESSION_BLOCKS(),
            maxUnits: 128,
            nonce: paint.sessionNonces(address(contractOwner)),
            deadline: vm.getBlockTimestamp() + 1 hours,
            sig: hex"01"
        });

        uint256 deposit = 0.1 ether;
        contractOwner.goToSleep{value: deposit}(_run(40, 0, 9, 5), sessions, 1 wei);
        contractOwner.wake();
        assertEq(sleepwalker.refunds(address(contractOwner)), deposit);

        uint256 before = cranker.balance;
        contractOwner.withdrawRefundTo(cranker);
        assertEq(sleepwalker.refunds(address(contractOwner)), 0);
        assertEq(cranker.balance, before + deposit);
    }

    function testSec_SessionsUsedWiderThanUint8() public {
        _humanPaint(41, 0, 31, 4);
        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions = _signedSessions(1, 256);
        vm.prank(owner);
        sleepwalker.sleep{value: 1 wei}(_run(42, 0, 95, 5), _emptyIds(), sessions, 1 wei);

        for (uint256 i = 1; i < 256; ++i) {
            vm.roll(sessions[0].expiryBlock + 1);
            sessions = _signedSessions(1, 256);
            vm.prank(owner);
            sleepwalker.resume(sessions);
        }

        vm.prank(owner);
        uint256 tokenId = sleepwalker.mintDream();
        R3tardsSleepwalker.DreamTokenData memory data = sleepwalker.dreamToken(tokenId);
        assertEq(data.nights, 256);
    }

    function testSec_UnpaidDreamIsHiddenButOwnerCanStillStep() public {
        _humanPaint(43, 0, 31, 4);
        _sleep(_run(44, 0, 9, 5), 1, 128, 1 wei, 0);

        address[] memory owners = new address[](1);
        owners[0] = owner;
        assertFalse(sleepwalker.stepReady(owners)[0]);

        vm.prank(owner);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        assertTrue(code == R3tardsSleepwalker.StepCode.Painted || code == R3tardsSleepwalker.StepCode.Complete);
    }

    function testSec_GasCompletingStep() public {
        _humanPaint(45, 0, 31, 4);
        _sleep(_run(46, 0, 9, 5), 1, 128, 1 wei, 1 wei);
        uint256 before = gasleft();
        vm.prank(cranker);
        (R3tardsSleepwalker.StepCode code,) = sleepwalker.step(owner);
        uint256 used = before - gasleft();
        console.log("GAS Sleepwalker completing step", used);
        assertEq(uint256(code), uint256(R3tardsSleepwalker.StepCode.Complete));
    }

    function testGasSleepStepWake() public {
        _humanPaint(20, 0, 31, 4);
        bytes memory stencil;
        for (uint8 y = 30; y < 46; ++y) stencil = abi.encodePacked(stencil, _run(y, 0, 255, 5));
        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions = _signedSessions(4, 5_000);

        uint256 before = gasleft();
        vm.prank(owner);
        sleepwalker.sleep{value: 0.1 ether}(stencil, _emptyIds(), sessions, 1 wei);
        uint256 sleepGas = before - gasleft();
        console.log("GAS Sleepwalker sleep", sleepGas);

        before = gasleft();
        vm.prank(cranker);
        sleepwalker.step(owner);
        uint256 stepGas = before - gasleft();
        console.log("GAS Sleepwalker step", stepGas);
        assertLt(stepGas, 600_000);

        before = gasleft();
        vm.prank(owner);
        sleepwalker.wake();
        uint256 wakeGas = before - gasleft();
        console.log("GAS Sleepwalker wake", wakeGas);
    }

    function testKeyPaintPathRejectsExpiredSession() public {
        _humanPaint(23, 0, 19, 4);
        _sleep(_run(24, 0, 9, 5), 1, 128, 1 wei, 0);
        address key = sleepwalker.keyOf(owner);
        (, uint256 expiryBlock,,,, bool active) = paint.sessionInfo(key);
        assertTrue(active);

        vm.roll(expiryBlock + 1);
        vm.startPrank(address(sleepwalker));
        vm.expectRevert(SleepwalkerKey.InactiveSession.selector);
        SleepwalkerKey(key).paint(_run(24, 0, 0, 5), _emptyIds());
        vm.stopPrank();
        _assertKeyNeverPaintedAsItself();
    }

    function testKeyAddressIsPredictableBeforeDeployment() public {
        address predicted = sleepwalker.keyOf(owner);
        assertEq(predicted.code.length, 0);
        _sleep(_run(21, 0, 9, 5), 1, 128, 1 wei, 0);
        assertEq(sleepwalker.keyOf(owner), predicted);
        assertGt(predicted.code.length, 0);
    }

    function _assertSurvivalBucket(uint8 matchingPixels, string memory expected) private {
        if (matchingPixels != 0) _humanPaint(22, 0, matchingPixels - 1, 4);
        _sleep(_run(22, 0, 99, 4), 1, 128, 1 wei, 0);
        vm.prank(owner);
        uint256 tokenId = sleepwalker.mintDream();
        bytes memory json = _json(labs.tokenURI(tokenId));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".attributes[18].value"), expected);
    }

    function _sleep(bytes memory stencil, uint256 count, uint256 maxUnits, uint256 tip, uint256 value) private {
        R3tardsSleepwalker.StartSessionAuthorization[] memory sessions = _signedSessions(count, maxUnits);
        vm.prank(owner);
        sleepwalker.sleep{value: value}(stencil, _emptyIds(), sessions, tip);
    }

    function _setTileHeat(uint16 tile, uint16 heat) private {
        uint256 tileRow = uint256(tile) >> 4;
        uint256 tileCol = uint256(tile) & 15;
        uint8 region = uint8((tileRow >> 2) * 4 + (tileCol >> 2));
        uint256 localTile = (tileRow & 3) * 4 + (tileCol & 3);
        uint256 slot = paint.regionPageSlot(paint.currentSeason(), region) + localTile;
        uint256 epoch = vm.getBlockNumber() / paint.WET_WINDOW_BLOCKS();
        uint256 meta = epoch | (vm.getBlockNumber() << 64) | (uint256(heat) << 112);
        vm.store(address(paint), bytes32(slot), bytes32(meta));
    }

    function _consumeNonceWithLiveKey(uint256 keyPk) private {
        address liveKey = vm.addr(keyPk);
        uint256 nonce = paint.sessionNonces(owner);
        uint256 expiry = vm.getBlockNumber() + 100;
        uint256 deadline = vm.getBlockTimestamp() + 1 days;
        bytes memory sig = _signatureFor(liveKey, expiry, 128, nonce, deadline);
        vm.prank(liveKey);
        paint.startSession(owner, liveKey, expiry, 128, nonce, deadline, sig);
        vm.prank(owner);
        paint.revokeSession(liveKey);
    }

    function _signedSessions(uint256 count, uint256 maxUnits)
        private
        view
        returns (R3tardsSleepwalker.StartSessionAuthorization[] memory sessions)
    {
        return _signedSessionsFor(ownerPk, owner, count, maxUnits);
    }

    function _signedSessionsFor(uint256 pk, address signer, uint256 count, uint256 maxUnits)
        private
        view returns (R3tardsSleepwalker.StartSessionAuthorization[] memory sessions)
    {
        sessions = new R3tardsSleepwalker.StartSessionAuthorization[](count);
        address key = sleepwalker.keyOf(signer);
        uint256 nonce = paint.sessionNonces(signer);
        uint256 maxBlocks = paint.MAX_SESSION_BLOCKS();
        uint256 firstExpiry = vm.getBlockNumber() + maxBlocks;
        uint256 deadline = vm.getBlockTimestamp() + 1 days;
        for (uint256 i; i < count; ++i) {
            uint256 expiry = firstExpiry + i * maxBlocks;
            sessions[i] = R3tardsSleepwalker.StartSessionAuthorization({
                expiryBlock: expiry,
                maxUnits: maxUnits,
                nonce: nonce + i,
                deadline: deadline,
                sig: _signatureForSigner(pk, signer, key, expiry, maxUnits, nonce + i, deadline)
            });
        }
    }

    function _signatureFor(address sessionKey, uint256 expiry, uint256 maxUnits, uint256 nonce, uint256 deadline)
        private
        view returns (bytes memory)
    {
        return _signatureForSigner(ownerPk, owner, sessionKey, expiry, maxUnits, nonce, deadline);
    }

    function _signatureForSigner(
        uint256 pk,
        address signer,
        address sessionKey,
        uint256 expiry,
        uint256 maxUnits,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(paint.SESSION_TYPEHASH(), signer, sessionKey, expiry, maxUnits, nonce, deadline)
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("r3tards paint")),
                keccak256(bytes("2")),
                block.chainid,
                address(paint)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, digest);
        return abi.encodePacked(r, ss, v);
    }

    function _humanPaint(uint8 y, uint8 x0, uint8 x1, uint8 colour) private {
        vm.prank(owner);
        paint.paint(_run(y, x0, x1, colour), _emptyIds());
    }

    function _assertActiveDays(uint256 expected) private view {
        (uint32 activeDays,,,,,,,,,) = paint.painterStats(owner);
        assertEq(activeDays, expected);
    }

    function _assertKeyNeverPaintedAsItself() private view {
        (,,,,,, uint64 paintCount,,,) = paint.painterStats(sleepwalker.keyOf(owner));
        assertEq(paintCount, 0);
    }

    function _run(uint8 y, uint8 x0, uint8 x1, uint8 colour) private pure returns (bytes memory) {
        return abi.encodePacked(bytes1(y), bytes1(x0), bytes1(x1), bytes1(colour));
    }

    function _emptyIds() private pure returns (uint256[] memory ids) {
        ids = new uint256[](0);
    }

    function _contains(string memory haystack, string memory needle) private pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }

    function _json(string memory uri) private pure returns (bytes memory out) {
        bytes memory src = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        uint256 len = src.length - prefix.length;
        uint256 padding = src[src.length - 1] == bytes1("=") ? 1 : 0;
        if (src[src.length - 2] == bytes1("=")) ++padding;
        out = new bytes((len / 4) * 3 - padding);
        uint256 j;
        for (uint256 i = prefix.length; i < src.length; i += 4) {
            uint256 n = (uint256(_b64(src[i])) << 18) | (uint256(_b64(src[i + 1])) << 12)
                | (uint256(_b64(src[i + 2])) << 6) | uint256(_b64(src[i + 3]));
            if (j < out.length) out[j++] = bytes1(uint8(n >> 16));
            if (j < out.length) out[j++] = bytes1(uint8(n >> 8));
            if (j < out.length) out[j++] = bytes1(uint8(n));
        }
    }

    function _b64(bytes1 c) private pure returns (uint8) {
        uint8 v = uint8(c);
        if (v >= 65 && v <= 90) return v - 65;
        if (v >= 97 && v <= 122) return v - 71;
        if (v >= 48 && v <= 57) return v + 4;
        if (v == 43) return 62;
        if (v == 47) return 63;
        return 0;
    }
}
