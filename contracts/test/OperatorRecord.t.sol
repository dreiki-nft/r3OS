// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {R3OSPainterPass} from "../src/R3OSPainterPass.sol";
import {R3OSQuests} from "../src/labs/R3OSQuests.sol";
import {R3OSPageExe} from "../src/monadhw/R3OSPageExe.sol";
import {R3OSBlockCamera} from "../src/monadhw/R3OSBlockCamera.sol";
import {R3OSCardMemory} from "../src/monadcard/R3OSCardMemory.sol";
import {R3OSOperatorRecord} from "../src/operator/R3OSOperatorRecord.sol";
import {MockR3tards} from "./MockR3tards.sol";
import {MockMonadCard} from "./MockMonadCard.sol";

contract OperatorActiveSource {
    mapping(address => uint32) public bids;
    mapping(address => uint32) public wins;
    mapping(address => uint256) public burned;
    mapping(address => uint256) public lastBurn;

    function setAuction(address who, uint32 bids_, uint32 wins_) external {
        bids[who] = bids_;
        wins[who] = wins_;
    }

    function setRecycle(address who, uint256 burned_, uint256 last_) external {
        burned[who] = burned_;
        lastBurn[who] = last_;
    }

    function bidderStats(address who) external view returns (uint32, uint32) {
        return (bids[who], wins[who]);
    }

    function burnedBy(address who) external view returns (uint256) {
        return burned[who];
    }

    function lastBurnBlock(address who) external view returns (uint256) {
        return lastBurn[who];
    }
}

contract OperatorWallet {
    function paintOne(R3OSPaint paint) external {
        paint.paint(hex"08080804", new uint256[](0));
    }

    function writeCard(R3OSCardMemory cardMemory, uint256 cardId) external {
        bytes32[] memory words = new bytes32[](1);
        words[0] = bytes32("wallet");
        cardMemory.write(cardId, 1, words);
    }
}

contract OperatorRecordTest is Test {
    uint256 constant OWNER_PK = 0xA11CE;

    address alice;
    address bob;
    address royalty;
    address sessionKey;

    MockR3tards r3tards;
    R3OSPaint paint;
    R3OSLabs labs;
    R3OSPainterPass pass;
    R3OSQuests quests;
    R3OSPageExe page;
    R3OSBlockCamera camera;
    MockMonadCard monadCard;
    R3OSCardMemory cardMemory;
    OperatorActiveSource auction;
    OperatorActiveSource recycleBin;
    R3OSOperatorRecord record;

    function setUp() public {
        vm.roll(10_000);
        alice = vm.addr(OWNER_PK);
        bob = makeAddr("bob");
        royalty = makeAddr("royalty");
        sessionKey = makeAddr("session-key");
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        r3tards = new MockR3tards();
        paint = new R3OSPaint(
            address(r3tards), uint64(block.timestamp), alice, royalty, 512, 0, 512, 16, 256
        );
        labs = new R3OSLabs(address(paint), royalty);
        pass = new R3OSPainterPass(address(paint));
        quests = new R3OSQuests(address(paint), uint64(block.timestamp), address(this));
        page = new R3OSPageExe();
        monadCard = new MockMonadCard();
        cardMemory = new R3OSCardMemory(address(monadCard));
        camera = new R3OSBlockCamera(address(paint), address(labs), address(cardMemory));
        auction = new OperatorActiveSource();
        recycleBin = new OperatorActiveSource();

        vm.startPrank(alice);
        paint.setPainterPass(address(pass));
        uint256 cameraId = paint.addExperiment(address(camera), "block-camera", "");
        paint.addExperiment(address(page), "page-exe", "");
        paint.addExperiment(address(cardMemory), "card-drv", "");
        vm.stopPrank();
        camera.bindExperimentId(cameraId);

        record = _deployRecord();
    }

    function _deployRecord() internal returns (R3OSOperatorRecord out) {
        R3OSOperatorRecord.Sources memory sources = R3OSOperatorRecord.Sources({
            paint: address(paint),
            pass: address(pass),
            quests: address(quests),
            flipbook: address(0),
            weeds: address(0),
            forks: address(0),
            brushes: address(0),
            auction: address(auction),
            sleepwalker: address(0),
            recycleBin: address(recycleBin),
            blockCamera: address(camera),
            kernelDebugger: address(0),
            pageExe: address(page),
            cardMemory: address(cardMemory)
        });
        out = new R3OSOperatorRecord(sources);
    }

    function testActivePredicatesAndLegacySlotsStayZero() public {
        (uint256 mask,) = record.usedMask(alice);
        assertEq(mask, 0);

        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.prank(alice);
        paint.mintFrame();
        vm.prank(alice);
        pass.claim();
        vm.mockCall(address(quests), abi.encodeWithSignature("completedCount(address)", alice), abi.encode(uint32(1)));
        auction.setAuction(alice, 1, 0);
        recycleBin.setRecycle(alice, 1, 12_004);
        vm.prank(alice);
        camera.capture();

        bytes32[] memory pageWord = new bytes32[](1);
        pageWord[0] = bytes32(uint256(1));
        vm.prank(alice);
        page.writePage(4, pageWord);

        monadCard.mintTo(alice, 77);
        bytes32[] memory cardWord = new bytes32[](1);
        cardWord[0] = bytes32("operator");
        vm.prank(alice);
        cardMemory.write(77, 1, cardWord);

        uint256 answered;
        (mask, answered) = record.usedMask(alice);
        uint256[10] memory active = [uint256(0), 1, 2, 3, 8, 10, 11, 13, 14, 15];
        for (uint256 i; i < active.length; ++i) assertTrue(_bit(mask, active[i]));
        uint256[6] memory legacy = [uint256(4), 5, 6, 7, 9, 12];
        for (uint256 i; i < legacy.length; ++i) {
            assertFalse(_bit(mask, legacy[i]));
            assertFalse(_bit(answered, legacy[i]));
        }
    }

    function testRecordSetsFirstObservedOnlyOnceAndLastRecordMoves() public {
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));

        vm.roll(11_000);
        record.record(alice);
        assertEq(record.firstObservedBlock(alice, 0), 11_000);

        (uint48 firstRecord, uint48 lastRecord,,,) = record.recordOf(alice);
        assertEq(firstRecord, 11_000);
        assertEq(lastRecord, 11_000);

        vm.roll(11_100);
        record.record(alice);
        assertEq(record.firstObservedBlock(alice, 0), 11_000);
        (, lastRecord,,,) = record.recordOf(alice);
        assertEq(lastRecord, 11_100);

        auction.setAuction(alice, 1, 0);
        vm.roll(11_200);
        record.record(alice);
        assertEq(record.firstObservedBlock(alice, 8), 11_200);
    }

    function testAnyoneCanRecordAnyoneAndResultMatchesSelfRecord() public {
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.roll(12_000);

        vm.prank(bob);
        record.record(alice);
        uint48 observedByStranger = record.firstObservedBlock(alice, 0);

        R3OSOperatorRecord second = _deployRecord();
        vm.prank(alice);
        second.record(alice);
        assertEq(second.firstObservedBlock(alice, 0), observedByStranger);
    }

    function testZeroLegacySourcesNeverRevertFactsOrRecord() public {
        R3OSOperatorRecord.Facts memory f = record.facts(alice);
        uint256[6] memory legacy = [uint256(4), 5, 6, 7, 9, 12];
        for (uint256 i; i < legacy.length; ++i) assertFalse(_bit(f.answeredMask, legacy[i]));
        record.record(alice);
    }

    function testPageUseCanDisappearButObservationCannot() public {
        bytes32[] memory words = new bytes32[](1);
        words[0] = bytes32(uint256(123));
        vm.prank(alice);
        page.writePage(9, words);

        record.record(alice);
        assertTrue(_bit(_liveMask(alice), 13));
        assertTrue(_observed(alice, 13));

        words[0] = bytes32(0);
        vm.prank(alice);
        page.writePage(9, words);
        assertFalse(_bit(_liveMask(alice), 13));
        assertTrue(_observed(alice, 13));
    }

    function testUsedBeforeExactPaintAndCard() public {
        vm.roll(20_000);
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));

        monadCard.mintTo(alice, 5);
        bytes32[] memory words = new bytes32[](1);
        words[0] = bytes32("x");
        vm.roll(20_010);
        vm.prank(alice);
        cardMemory.write(5, 1, words);

        (bool proven, bool exact) = record.usedBefore(alice, 0, 20_000);
        assertTrue(proven);
        assertTrue(exact);

        (proven, exact) = record.usedBefore(alice, 14, 20_010);
        assertTrue(proven);
        assertTrue(exact);

        (proven, exact) = record.usedBefore(alice, 4, 20_010);
        assertFalse(proven);
        assertFalse(exact);
    }

    function testSeasonsOnlyCreditPaintObservedAfterSeasonRecordWindowOpens() public {
        uint256[] memory noIds = new uint256[](0);

        vm.roll(30_000);
        vm.prank(alice);
        paint.paint(hex"00000304", noIds);
        vm.roll(30_001);
        record.record(alice);

        (,,, uint256 seasons,) = record.recordOf(alice);
        assertEq(seasons, 0);

        vm.roll(30_002);
        vm.prank(alice);
        paint.paint(hex"01010305", noIds);
        record.record(alice);
        (,,, seasons,) = record.recordOf(alice);
        assertEq(seasons & 1, 1);

        vm.warp(block.timestamp + 31 days);
        vm.roll(40_000);
        record.record(bob);
        vm.roll(40_001);
        vm.prank(alice);
        paint.paint(hex"02020306", noIds);
        record.record(alice);
        uint256 season = paint.currentSeason();
        (,,, seasons,) = record.recordOf(alice);
        assertTrue((seasons & (uint256(1) << season)) != 0);
    }

    function testSessionKeyPaintCreditsOwnerAndSessionAddressHasNoFact() public {
        uint256 expiry = block.number + 100;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = paint.sessionNonces(alice);
        bytes memory signature = _signatureFor(
            OWNER_PK,
            address(paint),
            alice,
            sessionKey,
            expiry,
            100,
            nonce,
            deadline
        );

        vm.prank(sessionKey);
        paint.startSession(alice, sessionKey, expiry, 100, nonce, deadline, signature);
        vm.prank(sessionKey);
        paint.paint(hex"04000304", new uint256[](0));

        record.record(alice);
        record.record(sessionKey);
        assertTrue(_observed(alice, 0));
        assertFalse(_observed(sessionKey, 0));
    }

    function testContractWalletIsRecordedByThirdParty() public {
        OperatorWallet wallet = new OperatorWallet();
        wallet.paintOne(paint);
        monadCard.mintTo(address(wallet), 909);
        wallet.writeCard(cardMemory, 909);

        vm.prank(bob);
        record.record(address(wallet));

        assertTrue(_observed(address(wallet), 0));
        assertTrue(_observed(address(wallet), 14));
        assertTrue(_observed(address(wallet), 15));
    }

    function testRecordPagesAlignedDisjointAndBounded(address a, address b) public {
        vm.assume(a != b);
        uint256 baseA = record.recordBaseSlot(a);
        uint256 baseB = record.recordBaseSlot(b);
        assertEq(baseA & 127, 0);
        assertEq(baseB & 127, 0);
        assertTrue(baseA != baseB);
        assertGe(baseA > baseB ? baseA - baseB : baseB - baseA, 128);

        bytes32 beforeLeft = vm.load(address(record), bytes32(baseA - 1));
        bytes32 beforeRight = vm.load(address(record), bytes32(baseA + 128));
        record.record(a);
        assertEq(vm.load(address(record), bytes32(baseA - 1)), beforeLeft);
        assertEq(vm.load(address(record), bytes32(baseA + 128)), beforeRight);
    }

    function testRecordManyMax32() public {
        address[] memory ok = new address[](32);
        for (uint256 i; i < ok.length; ++i) ok[i] = address(uint160(i + 1));
        record.recordMany(ok);

        address[] memory tooMany = new address[](33);
        vm.expectRevert(R3OSOperatorRecord.TooMany.selector);
        record.recordMany(tooMany);
    }

    function testEventOnlyWhenSomethingAdded() public {
        vm.prank(alice);
        paint.paint(hex"05000304", new uint256[](0));

        vm.recordLogs();
        record.record(alice);
        Vm.Log[] memory first = vm.getRecordedLogs();
        assertGt(first.length, 0);

        vm.roll(block.number + 1);
        vm.recordLogs();
        record.record(alice);
        Vm.Log[] memory second = vm.getRecordedLogs();
        assertEq(second.length, 0);
    }

    function testRecordGasWithEveryActiveSourceLive() public {
        vm.prank(alice);
        paint.paint(hex"06000304", new uint256[](0));
        vm.mockCall(address(quests), abi.encodeWithSignature("completedCount(address)", alice), abi.encode(uint32(1)));
        auction.setAuction(alice, 1, 1);
        recycleBin.setRecycle(alice, 1, block.number);
        monadCard.mintTo(alice, 31337);
        bytes32[] memory words = new bytes32[](1);
        words[0] = bytes32(uint256(1));
        vm.prank(alice);
        cardMemory.write(31337, 1, words);
        vm.prank(alice);
        page.writePage(1, words);
        vm.prank(alice);
        camera.capture();

        uint256 beforeGas = gasleft();
        record.record(alice);
        emit log_named_uint("OperatorRecord record gas, active sources live", beforeGas - gasleft());
    }

    function _liveMask(address operator) internal view returns (uint256 mask) {
        (mask,) = record.usedMask(operator);
    }

    function _observed(address operator, uint256 id) internal view returns (bool) {
        (,, uint256 mask,,) = record.recordOf(operator);
        return _bit(mask, id);
    }

    function _bit(uint256 mask, uint256 id) internal pure returns (bool) {
        return mask & (uint256(1) << id) != 0;
    }

    function _signatureFor(
        uint256 signerPk,
        address verifyingContract,
        address owner_,
        address key,
        uint256 expiry,
        uint256 maxUnits,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 typehash = paint.SESSION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(typehash, owner_, key, expiry, maxUnits, nonce, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("r3OS paint")),
                keccak256(bytes("2")),
                block.chainid,
                verifyingContract
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
