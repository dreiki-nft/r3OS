// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsPainterPass} from "../src/R3tardsPainterPass.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {R3tardsQuests} from "../src/labs/R3tardsQuests.sol";
import {R3tardsFlipbook} from "../src/labs/R3tardsFlipbook.sol";
import {R3tardsWeeds} from "../src/labs/R3tardsWeeds.sol";
import {R3tardsForks} from "../src/labs/R3tardsForks.sol";
import {R3tardsBrushes} from "../src/labs/R3tardsBrushes.sol";
import {BrushDNA} from "../src/lib/BrushDNA.sol";
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
    R3tardsPaint paint;
    R3tardsPainterPass pass;
    R3tardsQuests quests;
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
        paint = R3tardsPaint(deployCode(
            "R3tardsPaint.sol:R3tardsPaint",
            abi.encode(
                address(r3tards), uint64(vm.getBlockTimestamp()), alice, makeAddr("royalty"),
                uint32(512), uint32(0), uint32(512), uint32(16), uint32(256)
            )
        ));
        pass = R3tardsPainterPass(deployCode(
            "R3tardsPainterPass.sol:R3tardsPainterPass", abi.encode(address(paint))
        ));
        vm.prank(alice);
        paint.setPainterPass(address(pass));
        quests = new R3tardsQuests(address(paint), uint64(vm.getBlockTimestamp()), address(this));
        target = new QuestTarget();
    }

    function testAddQuestValidationAndOwnable2Step() public {
        R3tardsQuests.Condition[] memory one = _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 1);
        string[7] memory badNames;
        badNames[0] = "";
        badNames[1] = "bad\"name";
        badNames[2] = "bad\\name";
        badNames[3] = "bad<name";
        badNames[4] = "bad>name";
        badNames[5] = "bad&name";
        badNames[6] = "123456789012345678901";
        for (uint256 i; i < badNames.length; ++i) {
            vm.expectRevert(R3tardsQuests.BadName.selector);
            quests.addQuest(badNames[i], 0, 0, one);
        }
        R3tardsQuests.Condition[] memory none = new R3tardsQuests.Condition[](0);
        vm.expectRevert(R3tardsQuests.BadConditions.selector);
        quests.addQuest("NONE", 0, 0, none);
        R3tardsQuests.Condition[] memory five = new R3tardsQuests.Condition[](5);
        for (uint256 i; i < five.length; ++i) five[i] = one[0];
        vm.expectRevert(R3tardsQuests.BadConditions.selector);
        quests.addQuest("FIVE", 0, 0, five);

        R3tardsQuests.Condition[] memory bad = _oneCondition(bob, QuestTarget.metric.selector, 0, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.BadCondition.selector, 0));
        quests.addQuest("EOA", 0, 0, bad);
        bad = _oneCondition(address(target), QuestTarget.metric.selector, 32, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.BadCondition.selector, 0));
        quests.addQuest("WORD", 0, 0, bad);
        bad = _oneCondition(address(target), QuestTarget.metric.selector, 0, 2, 1);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.BadCondition.selector, 0));
        quests.addQuest("OP", 0, 0, bad);
        vm.expectRevert(R3tardsQuests.BadWindow.selector);
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
        R3tardsQuests.Condition[] memory one = _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 0);
        for (uint256 i; i < 256; ++i) quests.addQuest("Q", 0, 0, one);
        assertEq(quests.questCount(), 256);
        vm.expectRevert(R3tardsQuests.TooManyQuests.selector);
        quests.addQuest("Q", 0, 0, one);
    }

    function testReadFailuresAreConditionFailuresAndReturnBombIsBounded() public {
        R3tardsQuests.Condition[] memory c = _oneCondition(address(target), QuestTarget.alwaysRevert.selector, 0, 0, 1);
        uint256 id = quests.addQuest("REVERT", 0, 0, c);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.ConditionNotMet.selector, id, 0, 0, 1));
        vm.prank(alice);
        quests.claim(id);

        c = _oneCondition(address(target), QuestTarget.shortReturn.selector, 1, 0, 1);
        id = quests.addQuest("SHORT", 0, 0, c);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.ConditionNotMet.selector, id, 0, 0, 1));
        vm.prank(alice);
        quests.claim(id);

        c = _oneCondition(address(target), QuestTarget.returnBomb.selector, 0, 0, 1);
        id = quests.addQuest("BOMB", 0, 0, c);
        uint256 beforeGas = gasleft();
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.ConditionNotMet.selector, id, 0, 0, 1));
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
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.QuestNotActive.selector, id));
        vm.prank(alice);
        quests.claim(id);
        vm.roll(start);

        address key = makeAddr("quest-session");
        _startSession(key, 100, 512);
        vm.prank(key);
        quests.claim(id);
        assertEq(quests.completedCount(alice), 1);
        assertEq(quests.completedMask(alice), uint256(1) << id);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.AlreadyCompleted.selector, id));
        vm.prank(alice);
        quests.claim(id);

        vm.roll(uint256(end) + 1);
        uint256 later = quests.addQuest("LATER", start, end, _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 7));
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.QuestNotActive.selector, later));
        vm.prank(alice);
        quests.claim(later);

        uint256 le = quests.addQuest("LE", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 1, 7));
        vm.prank(alice);
        quests.claim(le);
        target.setValue(bob, 8);
        uint256 fail = quests.addQuest("FAIL", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 1, 7));
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.ConditionNotMet.selector, fail, 0, 8, 7));
        vm.prank(bob);
        quests.claim(fail);
    }

    function testConditionNotMetReportsFirstFailingIndex() public {
        target.setValue(alice, 7);
        R3tardsQuests.Condition[] memory conditions = new R3tardsQuests.Condition[](2);
        conditions[0] = R3tardsQuests.Condition(address(target), QuestTarget.metric.selector, 0, 0, 7);
        conditions[1] = R3tardsQuests.Condition(address(target), QuestTarget.twoWords.selector, 1, 0, 9);
        uint256 id = quests.addQuest("INDEX", 0, 0, conditions);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.ConditionNotMet.selector, id, 1, 8, 9));
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
        R3tardsQuests future = R3tardsQuests(deployCode(
            "R3tardsQuests.sol:R3tardsQuests",
            abi.encode(address(paint), uint64(vm.getBlockTimestamp() + 100), address(this))
        ));
        future.addQuest("FUTURE", 0, 0, _oneCondition(address(target), QuestTarget.metric.selector, 0, 0, 0));
        vm.expectRevert(R3tardsQuests.NotOpenYet.selector);
        vm.prank(alice);
        future.claim(0);
        vm.expectRevert(abi.encodeWithSelector(R3tardsQuests.NoQuest.selector, 99));
        vm.prank(alice);
        quests.claim(99);
    }

    function testLabRatWithFourRealLabsAndPainterPassBadgePath() public {
        // Earn a core paint first, seed a frame for Forks, and configure season 1 with no outline for brush stamping.
        vm.prank(alice);
        paint.paint(hex"c8c8d704", new uint256[](0));
        vm.prank(alice);
        uint256 frameId = paint.mintFrame();
        vm.prank(alice);
        paint.setSeasonOutline(1, bytes(""), "");
        vm.warp(paint.seasonStartTime(1));
        vm.roll(vm.getBlockNumber() + 700);

        bytes memory genesis = new bytes(512);
        R3tardsLabs labs = new R3tardsLabs(address(paint), makeAddr("royalty"));
        R3tardsFlipbook flipbook = R3tardsFlipbook(deployCode(
            "R3tardsFlipbook.sol:R3tardsFlipbook",
            abi.encode(address(paint), address(labs), uint64(vm.getBlockTimestamp()), uint256(300), genesis)
        ));
        vm.prank(alice);
        uint256 flipbookExperimentId = paint.addExperiment(address(flipbook), "flipbook", "");
        flipbook.bindExperimentId(flipbookExperimentId);
        R3tardsWeeds weeds = R3tardsWeeds(deployCode(
            "R3tardsWeeds.sol:R3tardsWeeds", abi.encode(address(paint), uint64(vm.getBlockTimestamp()))
        ));
        R3tardsForks forks = R3tardsForks(deployCode(
            "R3tardsForks.sol:R3tardsForks",
            abi.encode(address(paint), address(labs), uint64(vm.getBlockTimestamp()))
        ));
        vm.prank(alice);
        uint256 forksExperimentId = paint.addExperiment(address(forks), "forks", "");
        forks.bindExperimentId(forksExperimentId);
        R3tardsBrushes brushes = R3tardsBrushes(deployCode(
            "R3tardsBrushes.sol:R3tardsBrushes", abi.encode(address(paint), uint64(vm.getBlockTimestamp()))
        ));

        // FLIPBOOK: ten distinct frames painted.
        for (uint256 i; i < 10; ++i) {
            if (i != 0) vm.roll(vm.getBlockNumber() + 1);
            vm.prank(alice);
            flipbook.paint(abi.encodePacked(bytes1(uint8(i % 32)), bytes1(uint8(i % 32)), bytes1(uint8(i % 32)), bytes1(uint8(2 + (i & 1)))));
        }
        (, bool flipEarned) = flipbook.stamp(alice);
        assertTrue(flipEarned);

        // GARDENER: five plants separated by the cooldown.
        for (uint256 i; i < 5; ++i) {
            if (i != 0) vm.roll(vm.getBlockNumber() + weeds.PLANT_COOLDOWN_BLOCKS());
            vm.prank(alice);
            weeds.plant(15, uint8(i * 10), 0, 5);
        }
        (, bool weedEarned) = weeds.stamp(alice);
        assertTrue(weedEarned);

        // FORKER: paint three different forks.
        for (uint256 i; i < 3; ++i) {
            if (i != 0) vm.roll(vm.getBlockNumber() + forks.FORK_COOLDOWN_BLOCKS());
            vm.prank(alice);
            uint256 forkId = forks.forkFrame(frameId);
            vm.prank(alice);
            forks.paint(forkId, abi.encodePacked(bytes1(uint8(i)), bytes1(uint8(0)), bytes1(uint8(0)), bytes1(uint8(3 + i))));
        }
        (, bool forkEarned) = forks.stamp(alice);
        assertTrue(forkEarned);

        // BLOCK DNA: catch, stamp and verify three brushes on the outline-free season.
        for (uint256 i; i < 3; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            uint256 sourceBlock = vm.getBlockNumber() - 1;
            vm.setBlockhash(sourceBlock, keccak256(abi.encode("lab rat brush", i)));
            vm.prank(alice);
            uint8 slot = brushes.catchBrush(sourceBlock);
            (uint256[8] memory words,,,,,) = brushes.box(alice);
            uint8 x = uint8(10 + i * 70);
            uint8 y = 120;
            vm.prank(alice);
            paint.paint(BrushDNA.runs(words[slot], x, y), new uint256[](0));
            vm.prank(alice);
            brushes.verify(slot, x, y);
        }
        (, bool brushEarned) = brushes.stamp(alice);
        assertTrue(brushEarned);

        R3tardsQuests.Condition[] memory conditions = new R3tardsQuests.Condition[](4);
        bytes4 stampSelector = bytes4(keccak256("stamp(address)"));
        conditions[0] = R3tardsQuests.Condition(address(flipbook), stampSelector, 1, 0, 1);
        conditions[1] = R3tardsQuests.Condition(address(weeds), stampSelector, 1, 0, 1);
        conditions[2] = R3tardsQuests.Condition(address(forks), stampSelector, 1, 0, 1);
        conditions[3] = R3tardsQuests.Condition(address(brushes), stampSelector, 1, 0, 1);
        uint256 labRat = quests.addQuest("LAB RAT", 0, 0, conditions);
        vm.prank(alice);
        quests.claim(labRat);
        (string memory questStamp, bool questEarned) = quests.stamp(alice);
        assertEq(questStamp, "QUESTS 1");
        assertTrue(questEarned);

        pass.addStampSource(address(quests));
        vm.prank(alice);
        uint256 passId = pass.claim();
        assertGt(bytes(pass.tokenURI(passId)).length, 0);
    }

    function testGasTargets() public {
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        R3tardsQuests.Condition[] memory coreCondition = _oneCondition(
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
        R3tardsQuests.Condition[] memory four = new R3tardsQuests.Condition[](4);
        for (uint256 i; i < 4; ++i) {
            sources[i] = new QuestTarget();
            four[i] = R3tardsQuests.Condition(address(sources[i]), QuestTarget.stamp.selector, 1, 0, 1);
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
        returns (R3tardsQuests.Condition[] memory conditions)
    {
        conditions = new R3tardsQuests.Condition[](1);
        conditions[0] = R3tardsQuests.Condition(targetAddress, selector, word, op, threshold);
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
                keccak256(bytes("r3tards paint")),
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
