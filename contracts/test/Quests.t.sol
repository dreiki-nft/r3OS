// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSQuests} from "../src/labs/R3OSQuests.sol";
import {IStampSource} from "../src/interfaces/IStampSource.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract QuestTarget is IStampSource {
    mapping(address => uint256) public value;
    bool public earned = true;

    function setValue(address who, uint256 nextValue) external { value[who] = nextValue; }
    function setEarned(bool nextValue) external { earned = nextValue; }
    function metric(address who) external view returns (uint256) { return value[who]; }
    function twoWords(address who) external view returns (uint256, uint256) { return (value[who], value[who] + 1); }
    function shortReturn(address who) external view returns (uint256) { return value[who]; }
    function alwaysRevert(address) external pure returns (uint256) { revert("nope"); }
    function returnBomb(address) external pure {
        assembly ("memory-safe") { return(0, 0x100000) }
    }
    function stamp(address) external view returns (string memory, bool) { return ("MOCK", earned); }
}

contract QuestsTest is Test {
    R3OSPaint paint;
    R3OSQuests quests;
    MockR3tards r3tards;
    QuestTarget target;
    uint256 alicePk = 0xA11CE;
    address alice;
    address bob;

    function setUp() public {
        vm.roll(1_000_700);
        alice = vm.addr(alicePk);
        bob = makeAddr("bob");
        r3tards = new MockR3tards();
        paint = R3OSPaint(deployCode(
            "R3OSPaint.sol:R3OSPaint",
            abi.encode(
                address(r3tards), uint64(vm.getBlockTimestamp()), alice, makeAddr("royalty"),
                uint32(512), uint32(0), uint32(512), uint32(16), uint32(256)
            )
        ));
        vm.prank(alice);
        quests = new R3OSQuests(address(paint), uint64(vm.getBlockTimestamp()), address(this));
        target = new QuestTarget();
    }

    function testAddQuestValidationAndOwnable2Step() public {
        R3OSQuests.Condition[] memory one = _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 1);
        string[7] memory badNames;
        badNames[0] = "";
        badNames[1] = "bad\"name";
        badNames[2] = "bad\\name";
        badNames[3] = "bad<name";
        badNames[4] = "bad>name";
        badNames[5] = "bad&name";
        badNames[6] = "123456789012345678901";
        for (uint256 i; i < badNames.length; ++i) {
            vm.expectRevert(R3OSQuests.BadName.selector);
            quests.addQuest(badNames[i], 0, 0, one);
        }
        R3OSQuests.Condition[] memory none = new R3OSQuests.Condition[](0);
        vm.expectRevert(R3OSQuests.BadConditions.selector);
        quests.addQuest("NONE", 0, 0, none);
        R3OSQuests.Condition[] memory five = new R3OSQuests.Condition[](5);
        for (uint256 i; i < five.length; ++i) five[i] = one[0];
        vm.expectRevert(R3OSQuests.BadConditions.selector);
        quests.addQuest("FIVE", 0, 0, five);

        R3OSQuests.Condition[] memory bad = _oneCondition(bob, QuestTarget.metric.selector, 0, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.BadCondition.selector, 0));
        quests.addQuest("EOA", 0, 0, bad);
        bad = _oneCondition(address(target), QuestTarget.metric.selector, 32, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.BadCondition.selector, 0));
        quests.addQuest("WORD", 0, 0, bad);
        bad = _oneCondition(address(target), QuestTarget.metric.selector, 0, 2, 1);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.BadCondition.selector, 0));
        quests.addQuest("OP", 0, 0, bad);
        vm.expectRevert(R3OSQuests.BadWindow.selector);
        quests.addQuest("WINDOW", 100, 99, one);

        vm.expectRevert();
        vm.prank(alice);
        quests.addQuest("NOT OWNER", 0, 0, one);

        quests.transferOwnership(alice);
        assertEq(quests.owner(), address(this));
        vm.prank(alice);
        quests.acceptOwnership();
        assertEq(quests.owner(), alice);
    }

    function testTooManyQuestsAt257() public {
        R3OSQuests.Condition[] memory one = _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 0);
        for (uint256 i; i < 256; ++i) quests.addQuest("Q", 0, 0, one);
        assertEq(quests.questCount(), 256);
        vm.expectRevert(R3OSQuests.TooManyQuests.selector);
        quests.addQuest("Q", 0, 0, one);
    }

    function testReadFailuresAreConditionFailuresAndReturnBombIsBounded() public {
        R3OSQuests.Condition[] memory c = _oneCondition(address(target), QuestTarget.alwaysRevert.selector, 0, 0, 1);
        uint256 id = quests.addQuest("REVERT", 0, 0, c);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.ConditionNotMet.selector, id, 0, 0, 1));
        vm.prank(alice);
        quests.claim(id);

        c = _oneCondition(address(target), QuestTarget.shortReturn.selector, 1, 0, 1);
        id = quests.addQuest("SHORT", 0, 0, c);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.ConditionNotMet.selector, id, 0, 0, 1));
        vm.prank(alice);
        quests.claim(id);

        c = _oneCondition(address(target), QuestTarget.returnBomb.selector, 0, 0, 1);
        id = quests.addQuest("BOMB", 0, 0, c);
        uint256 beforeGas = gasleft();
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.ConditionNotMet.selector, id, 0, 0, 1));
        vm.prank(alice);
        quests.claim(id);
        uint256 used = beforeGas - gasleft();
        console.log("GAS Quests return bomb bounded", used);
        assertLt(used, 300_000);
    }

    function testClaimSessionWindowAlreadyCompletedAndLessEqual() public {
        target.setValue(alice, 7);
        uint48 start = uint48(vm.getBlockNumber() + 5);
        uint48 end = start + 5;
        uint256 id = quests.addQuest("WINDOW", start, end, _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 7));
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.QuestNotActive.selector, id));
        vm.prank(alice);
        quests.claim(id);
        vm.roll(start);

        address key = makeAddr("quest-session");
        _startSession(key, 100, 512);
        vm.prank(key);
        quests.claim(id);
        assertEq(quests.completedCount(alice), 1);
        assertEq(quests.completedMask(alice), uint256(1) << id);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.AlreadyCompleted.selector, id));
        vm.prank(alice);
        quests.claim(id);

        vm.roll(uint256(end) + 1);
        uint256 later = quests.addQuest("LATER", start, end, _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 7));
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.QuestNotActive.selector, later));
        vm.prank(alice);
        quests.claim(later);

        uint256 le = quests.addQuest("LE", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 1, 7));
        vm.prank(alice);
        quests.claim(le);
        target.setValue(bob, 8);
        uint256 fail = quests.addQuest("FAIL", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 1, 7));
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.ConditionNotMet.selector, fail, 0, 8, 7));
        vm.prank(bob);
        quests.claim(fail);
    }

    function testConditionNotMetReportsFirstFailingIndex() public {
        target.setValue(alice, 7);
        R3OSQuests.Condition[] memory conditions = new R3OSQuests.Condition[](2);
        conditions[0] = R3OSQuests.Condition(address(target), QuestTarget.metric.selector, 0, 0, 7);
        conditions[1] = R3OSQuests.Condition(address(target), QuestTarget.twoWords.selector, 1, 0, 9);
        uint256 id = quests.addQuest("INDEX", 0, 0, conditions);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.ConditionNotMet.selector, id, 1, 8, 9));
        vm.prank(alice);
        quests.claim(id);
    }

    function testViewsClaimableProgressAndStampNames() public {
        target.setValue(alice, 5);
        uint256 first = quests.addQuest("ONE", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 5));
        uint256 second = quests.addQuest("TWO", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 6));
        assertEq(quests.claimable(alice), uint256(1) << first);
        (uint256[] memory values, bool[] memory passing) = quests.progress(alice, second);
        assertEq(values[0], 5);
        assertFalse(passing[0]);
        (string memory nameBefore, bool earnedBefore) = quests.stamp(alice);
        assertEq(nameBefore, "QUESTS 0");
        assertFalse(earnedBefore);
        vm.prank(alice);
        quests.claim(first);
        (string memory nameOne, bool earnedOne) = quests.stamp(alice);
        assertEq(nameOne, "QUESTS 1");
        assertTrue(earnedOne);
        target.setValue(alice, 6);
        vm.prank(alice);
        quests.claim(second);
        (string memory nameTwo,) = quests.stamp(alice);
        assertEq(nameTwo, "QUESTS 2");
    }

    function testNotOpenYetAndUnknownQuest() public {
        R3OSQuests future = R3OSQuests(deployCode(
            "R3OSQuests.sol:R3OSQuests",
            abi.encode(address(paint), uint64(vm.getBlockTimestamp() + 100), address(this))
        ));
        future.addQuest("FUTURE", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 0));
        vm.expectRevert(R3OSQuests.NotOpenYet.selector);
        vm.prank(alice);
        future.claim(0);
        vm.expectRevert(abi.encodeWithSelector(R3OSQuests.NoQuest.selector, 99));
        vm.prank(alice);
        quests.claim(99);
    }

    function testGasTargets() public {
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        R3OSQuests.Condition[] memory coreCondition = _oneCondition(
            address(paint), bytes4(keccak256("painterStats(address)")), 2, 0, 1
        );
        uint256 one = quests.addQuest("CORE", 0, 0, coreCondition);
        uint256 beforeGas = gasleft();
        vm.prank(alice);
        quests.claim(one);
        uint256 used = beforeGas - gasleft();
        console.log("GAS Quests claim one core condition", used);
        assertLt(used, 160_000);

        QuestTarget[4] memory sources;
        R3OSQuests.Condition[] memory four = new R3OSQuests.Condition[](4);
        for (uint256 i; i < 4; ++i) {
            sources[i] = new QuestTarget();
            four[i] = R3OSQuests.Condition(address(sources[i]), QuestTarget.stamp.selector, 1, 0, 1);
        }
        uint256 fourId = quests.addQuest("FOUR", 0, 0, four);
        beforeGas = gasleft();
        vm.prank(bob);
        quests.claim(fourId);
        used = beforeGas - gasleft();
        console.log("GAS Quests claim four stamp conditions", used);
        assertLt(used, 250_000);

        beforeGas = gasleft();
        quests.stamp(alice);
        used = beforeGas - gasleft();
        console.log("GAS Quests stamp", used);
        assertLt(used, 25_000);
    }

    function _oneCondition(address targetAddress, bytes4 selector, uint8 word, uint8 op, uint256 threshold)
        private
        pure
        returns (R3OSQuests.Condition[] memory conditions)
    {
        conditions = new R3OSQuests.Condition[](1);
        conditions[0] = R3OSQuests.Condition(targetAddress, selector, word, op, threshold);
    }

    function _startSession(address key, uint256 blocks_, uint256 maxUnits) private {
        uint256 expiry = vm.getBlockNumber() + blocks_;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        uint256 nonce = paint.sessionNonces(alice);
        bytes32 typehash = paint.SESSION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(typehash, alice, key, expiry, maxUnits, nonce, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("r3OS paint")),
                keccak256(bytes("2")),
                block.chainid,
                address(paint)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);
        vm.prank(key);
        paint.startSession(alice, key, expiry, maxUnits, nonce, deadline, abi.encodePacked(r, s, v));
    }
}
