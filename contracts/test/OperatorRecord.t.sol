// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {R3tardsPainterPass} from "../src/R3tardsPainterPass.sol";
import {R3tardsQuests} from "../src/labs/R3tardsQuests.sol";
import {R3tardsPageExe} from "../src/monadhw/R3tardsPageExe.sol";
import {R3tardsBlockCamera} from "../src/monadhw/R3tardsBlockCamera.sol";
import {R3tardsKernelDebugger} from "../src/monadhw/R3tardsKernelDebugger.sol";
import {R3tardsCardMemory} from "../src/monadcard/R3tardsCardMemory.sol";
import {R3tardsOperatorRecord} from "../src/operator/R3tardsOperatorRecord.sol";
import {MockR3tards} from "./MockR3tards.sol";
import {MockMonadCard} from "./MockMonadCard.sol";

contract OperatorEmptySource {}

contract OperatorRevertingSource {
    fallback() external {
        revert("source revert");
    }
}

contract OperatorGasBurningSource {
    fallback() external {
        while (true) {
            assembly ("memory-safe") { pop(gas()) }
        }
    }
}

contract OperatorWallet {
    function paintOne(R3tardsPaint paint) external {
        paint.paint(hex"08080804", new uint256[](0));
    }

    function writeCard(R3tardsCardMemory cardMemory, uint256 cardId) external {
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
    R3tardsPaint paint;
    R3tardsLabs labs;
    R3tardsPainterPass pass;
    R3tardsQuests quests;
    R3tardsPageExe page;
    R3tardsBlockCamera camera;
    R3tardsKernelDebugger kernel;
    MockMonadCard monadCard;
    R3tardsCardMemory cardMemory;
    R3tardsOperatorRecord record;

    OperatorEmptySource flipbook;
    OperatorEmptySource weeds;
    OperatorEmptySource forks;
    OperatorEmptySource brushes;
    OperatorEmptySource auction;
    OperatorEmptySource sleepwalker;
    OperatorEmptySource recycleBin;

    function setUp() public {
        vm.roll(10_000);
        alice = vm.addr(OWNER_PK);
        bob = makeAddr("bob");
        royalty = makeAddr("royalty");
        sessionKey = makeAddr("session-key");
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards), uint64(block.timestamp), alice, royalty, 512, 0, 512, 16, 256
        );
        labs = new R3tardsLabs(address(paint), royalty);
        pass = new R3tardsPainterPass(address(paint));
        quests = new R3tardsQuests(address(paint), uint64(block.timestamp), address(this));
        page = new R3tardsPageExe();
        monadCard = new MockMonadCard();
        cardMemory = new R3tardsCardMemory(address(monadCard));
        camera = new R3tardsBlockCamera(address(paint), address(labs), address(cardMemory));
        kernel = new R3tardsKernelDebugger();

        flipbook = new OperatorEmptySource();
        weeds = new OperatorEmptySource();
        forks = new OperatorEmptySource();
        brushes = new OperatorEmptySource();
        auction = new OperatorEmptySource();
        sleepwalker = new OperatorEmptySource();
        recycleBin = new OperatorEmptySource();

        vm.startPrank(alice);
        paint.setPainterPass(address(pass));
        uint256 cameraId = paint.addExperiment(address(camera), "block-camera", "");
        paint.addExperiment(address(page), "page-exe", "");
        paint.addExperiment(address(kernel), "kernel-debugger", "");
        paint.addExperiment(address(cardMemory), "card-drv", "");
        vm.stopPrank();
        camera.bindExperimentId(cameraId);

        record = _deployRecord(
            address(flipbook),
            address(weeds),
            address(forks),
            address(brushes),
            address(auction),
            address(sleepwalker),
            address(recycleBin)
        );
    }

    function _deployRecord(
        address flipbook_,
        address weeds_,
        address forks_,
        address brushes_,
        address auction_,
        address sleepwalker_,
        address recycleBin_
    ) internal returns (R3tardsOperatorRecord out) {
        R3tardsOperatorRecord.Sources memory sources = R3tardsOperatorRecord.Sources({
            paint: address(paint),
            pass: address(pass),
            quests: address(quests),
            flipbook: flipbook_,
            weeds: weeds_,
            forks: forks_,
            brushes: brushes_,
            auction: auction_,
            sleepwalker: sleepwalker_,
            recycleBin: recycleBin_,
            blockCamera: address(camera),
            kernelDebugger: address(kernel),
            pageExe: address(page),
            cardMemory: address(cardMemory)
        });
        out = new R3tardsOperatorRecord(sources);
    }

    function testEveryUsedPredicateFlipsAtSpecifiedWord() public {
        (uint256 mask,) = record.usedMask(alice);
        assertEq(mask, 0);

        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        (mask,) = record.usedMask(alice);
        assertTrue(_bit(mask, 0));

        vm.prank(alice);
        paint.mintFrame();
        (mask,) = record.usedMask(alice);
        assertTrue(_bit(mask, 1));

        vm.prank(alice);
        pass.claim();
        (mask,) = record.usedMask(alice);
        assertTrue(_bit(mask, 2));

        vm.mockCall(
            address(quests),
            abi.encodeWithSignature("completedCount(address)", alice),
            abi.encode(uint32(1))
        );
        vm.mockCall(
            address(flipbook),
            abi.encodeWithSignature("painterInfo(address)", alice),
            abi.encode(uint48(12_000), uint48(0), uint16(0), uint64(0), uint32(2), uint48(0))
        );
        vm.mockCall(
            address(weeds),
            abi.encodeWithSignature("gardenerInfo(address)", alice),
            abi.encode(uint48(12_001), uint32(1), uint32(0))
        );
        vm.mockCall(
            address(forks),
            abi.encodeWithSignature("painterInfo(address)", alice),
            abi.encode(uint32(1), uint48(12_002))
        );

        uint256[8] memory boxWords;
        vm.mockCall(
            address(brushes),
            abi.encodeWithSignature("box(address)", alice),
            abi.encode(boxWords, uint8(0), uint8(0), uint32(1), uint32(1), uint48(12_003))
        );
        vm.mockCall(
            address(auction),
            abi.encodeWithSignature("bidderStats(address)", alice),
            abi.encode(uint32(1), uint32(0))
        );
        vm.mockCall(
            address(sleepwalker),
            abi.encodeWithSignature("dreamingDays(address)", alice),
            abi.encode(uint256(1))
        );
        vm.mockCall(
            address(recycleBin),
            abi.encodeWithSignature("burnedBy(address)", alice),
            abi.encode(uint256(1))
        );
        vm.mockCall(
            address(recycleBin),
            abi.encodeWithSignature("lastBurnBlock(address)", alice),
            abi.encode(uint256(12_004))
        );

        vm.prank(alice);
        camera.capture();
        vm.prank(alice);
        kernel.run(false, false);

        bytes32[] memory pageWord = new bytes32[](1);
        pageWord[0] = bytes32(uint256(1));
        vm.prank(alice);
        page.writePage(4, pageWord);

        monadCard.mintTo(alice, 77);
        bytes32[] memory cardWord = new bytes32[](1);
        cardWord[0] = bytes32("operator");
        vm.prank(alice);
        cardMemory.write(77, 1, cardWord);

        (mask,) = record.usedMask(alice);
        for (uint256 i; i < 16; ++i) assertTrue(_bit(mask, i), string.concat("missing bit ", vm.toString(i)));
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

        vm.mockCall(
            address(flipbook),
            abi.encodeWithSignature("painterInfo(address)", alice),
            abi.encode(uint48(11_101), uint48(0), uint16(0), uint64(0), uint32(1), uint48(0))
        );
        vm.roll(11_200);
        record.record(alice);
        assertEq(record.firstObservedBlock(alice, 4), 11_200);
    }

    function testAnyoneCanRecordAnyoneAndResultMatchesSelfRecord() public {
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));
        vm.roll(12_000);

        vm.prank(bob);
        record.record(alice);
        uint48 observedByStranger = record.firstObservedBlock(alice, 0);

        R3tardsOperatorRecord second = _deployRecord(
            address(flipbook),
            address(weeds),
            address(forks),
            address(brushes),
            address(auction),
            address(sleepwalker),
            address(recycleBin)
        );
        vm.prank(alice);
        second.record(alice);
        assertEq(second.firstObservedBlock(alice, 0), observedByStranger);
    }

    function testBadSourcesNeverRevertFactsOrRecord() public {
        OperatorRevertingSource reverting = new OperatorRevertingSource();
        OperatorGasBurningSource burning = new OperatorGasBurningSource();
        R3tardsOperatorRecord guarded =
            _deployRecord(address(burning), address(reverting), address(0), address(brushes), address(0), address(0), address(0));

        R3tardsOperatorRecord.Facts memory f = guarded.facts(alice);
        assertFalse(_bit(f.answeredMask, 4));
        assertFalse(_bit(f.answeredMask, 5));
        assertFalse(_bit(f.answeredMask, 6));
        guarded.record(alice);
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

    function testUsedBeforeExactPaintExactCardAndObservedFlipbook() public {
        vm.roll(20_000);
        vm.prank(alice);
        paint.paint(hex"00000304", new uint256[](0));

        monadCard.mintTo(alice, 5);
        bytes32[] memory words = new bytes32[](1);
        words[0] = bytes32("x");
        vm.roll(20_010);
        vm.prank(alice);
        cardMemory.write(5, 1, words);

        vm.mockCall(
            address(flipbook),
            abi.encodeWithSignature("painterInfo(address)", alice),
            abi.encode(uint48(20_020), uint48(0), uint16(0), uint64(0), uint32(1), uint48(0))
        );
        vm.roll(20_020);
        record.record(alice);

        (bool proven, bool exact) = record.usedBefore(alice, 0, 20_000);
        assertTrue(proven);
        assertTrue(exact);

        (proven, exact) = record.usedBefore(alice, 14, 20_010);
        assertTrue(proven);
        assertTrue(exact);

        (proven, exact) = record.usedBefore(alice, 4, 20_019);
        assertFalse(proven);
        assertFalse(exact);
        (proven, exact) = record.usedBefore(alice, 4, 20_020);
        assertTrue(proven);
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
        record.record(bob); // opens the next season's observation window
        vm.roll(40_001);
        vm.prank(alice);
        paint.paint(hex"02020306", noIds);
        record.record(alice);
        uint256 season = paint.currentSeason();
        (,,, seasons,) = record.recordOf(alice);
        assertTrue((seasons & (uint256(1) << season)) != 0);

        vm.warp(uint256(paint.SEASON_START()) + 256 * paint.SEASON_LENGTH());
        vm.roll(50_000);
        record.record(bob);
        vm.roll(50_001);
        vm.prank(alice);
        paint.paint(hex"03030307", noIds);
        record.record(alice);
        assertEq(paint.currentSeason(), 256);
        (,,, seasons,) = record.recordOf(alice);
        assertTrue((seasons >> 256) == 0);
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
        vm.expectRevert(R3tardsOperatorRecord.TooMany.selector);
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

    function testRecordGasWithEverySourceLive() public {
        vm.prank(alice);
        paint.paint(hex"06000304", new uint256[](0));
        _mockAllLabs(alice);
        monadCard.mintTo(alice, 31337);
        bytes32[] memory words = new bytes32[](1);
        words[0] = bytes32(uint256(1));
        vm.prank(alice);
        cardMemory.write(31337, 1, words);
        vm.prank(alice);
        page.writePage(1, words);
        vm.prank(alice);
        camera.capture();
        vm.prank(alice);
        kernel.run(false, false);

        uint256 beforeGas = gasleft();
        record.record(alice);
        emit log_named_uint("OperatorRecord record gas, all sources live", beforeGas - gasleft());
    }

    function _mockAllLabs(address operator) internal {
        vm.mockCall(
            address(quests),
            abi.encodeWithSignature("completedCount(address)", operator),
            abi.encode(uint32(1))
        );
        vm.mockCall(
            address(flipbook),
            abi.encodeWithSignature("painterInfo(address)", operator),
            abi.encode(uint48(block.number), uint48(0), uint16(0), uint64(0), uint32(1), uint48(0))
        );
        vm.mockCall(
            address(weeds),
            abi.encodeWithSignature("gardenerInfo(address)", operator),
            abi.encode(uint48(block.number), uint32(1), uint32(1))
        );
        vm.mockCall(
            address(forks),
            abi.encodeWithSignature("painterInfo(address)", operator),
            abi.encode(uint32(1), uint48(block.number))
        );
        uint256[8] memory boxWords;
        vm.mockCall(
            address(brushes),
            abi.encodeWithSignature("box(address)", operator),
            abi.encode(boxWords, uint8(0), uint8(0), uint32(1), uint32(1), uint48(block.number))
        );
        vm.mockCall(
            address(auction),
            abi.encodeWithSignature("bidderStats(address)", operator),
            abi.encode(uint32(1), uint32(1))
        );
        vm.mockCall(
            address(sleepwalker),
            abi.encodeWithSignature("dreamingDays(address)", operator),
            abi.encode(uint256(1))
        );
        vm.mockCall(
            address(recycleBin),
            abi.encodeWithSignature("burnedBy(address)", operator),
            abi.encode(uint256(1))
        );
        vm.mockCall(
            address(recycleBin),
            abi.encodeWithSignature("lastBurnBlock(address)", operator),
            abi.encode(uint256(block.number))
        );
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
    ) internal returns (bytes memory) {
        bytes32 typehash = paint.SESSION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(typehash, owner_, key, expiry, maxUnits, nonce, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("r3tards paint")),
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
