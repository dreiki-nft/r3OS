// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {R3tardsPainterPass} from "../src/R3tardsPainterPass.sol";
import {R3tardsQuests} from "../src/labs/R3tardsQuests.sol";
import {R3tardsBlockCamera} from "../src/monadhw/R3tardsBlockCamera.sol";
import {R3tardsCardMemory} from "../src/monadcard/R3tardsCardMemory.sol";
import {MockR3tards} from "./MockR3tards.sol";
import {MockMonadCard} from "./MockMonadCard.sol";

contract ZeroOwnerCard {
    function ownerOf(uint256) external pure returns (address) { return address(0); }
    function balanceOf(address) external pure returns (uint256) { return 0; }
}

contract RevertingCard {
    function ownerOf(uint256) external pure returns (address) { revert("missing"); }
    function balanceOf(address) external pure returns (uint256) { revert("missing"); }
}

contract MutableCard {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;

    function setOwner(uint256 id, address owner) external {
        address old = ownerOf[id];
        if (old != address(0)) balanceOf[old]--;
        ownerOf[id] = owner;
        if (owner != address(0)) balanceOf[owner]++;
    }

    function approveForTest(uint256 id, address operator) external { getApproved[id] = operator; }
}

contract CardWallet {
    function write(R3tardsCardMemory memory_, uint256 id, uint256 offset, bytes32[] calldata words) external {
        memory_.write(id, offset, words);
    }
}

contract PaintStatsMock {
    mapping(address => uint96) public pixels;
    mapping(address => uint64) public paints;

    function setStats(address owner, uint96 totalPixels, uint64 paintCount) external {
        pixels[owner] = totalPixels;
        paints[owner] = paintCount;
    }

    function isActiveSessionKey(address) external pure returns (bool) { return false; }
    function isR3tardHolder(address) external pure returns (bool) { return false; }
    function daysPainted(address) external pure returns (uint32) { return 1; }
    function sessionInfo(address) external pure returns (address, uint256, uint256, uint256, bool, bool) {
        return (address(0), 0, 0, 0, false, false);
    }

    function painterStats(address owner) external view returns (
        uint32 activeDays,
        uint32 pixelsToday,
        uint96 totalPixelsPainted,
        uint48 framesMinted,
        uint48 firstPaintBlock,
        uint48 lastPaintBlock,
        uint64 paintCount,
        uint64 paintNonce,
        uint64 sessionPaints,
        uint64 stormPaints
    ) {
        activeDays = 1;
        pixelsToday = uint32(pixels[owner]);
        totalPixelsPainted = pixels[owner];
        firstPaintBlock = paints[owner] == 0 ? 0 : 1;
        lastPaintBlock = firstPaintBlock;
        paintCount = paints[owner];
        framesMinted = 0;
        paintNonce = 0;
        sessionPaints = 0;
        stormPaints = 0;
    }
}

contract MonadCardTest is Test {
    address constant STAKING = 0x0000000000000000000000000000000000001000;
    bytes32 constant EMPTY_PAGE_HASH = 0xa8bae11751799de4dbe638406c5c9642c0e791f2a65e852a05ba4fdf0d88e3e6;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address royalty = makeAddr("royalty");

    MockMonadCard card;
    R3tardsCardMemory memory_;

    function setUp() public {
        vm.roll(20_000);
        card = new MockMonadCard();
        memory_ = new R3tardsCardMemory(address(card));
        card.mintTo(alice, 1);
    }

    function _one(bytes32 value) private pure returns (bytes32[] memory words) {
        words = new bytes32[](1);
        words[0] = value;
    }

    function testOwnerWritesAndNonOwnerCannot() public {
        vm.prank(alice);
        memory_.write(1, 1, _one(bytes32("hello")));
        assertEq(memory_.readPage(1)[1], bytes32("hello"));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.NotCardOwner.selector, 1, alice));
        memory_.write(1, 1, _one(bytes32("no")));
    }

    function testMissingCardHandlesRevertAndZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.CardNotFound.selector, 999));
        memory_.write(999, 1, _one(bytes32(uint256(1))));

        ZeroOwnerCard zero = new ZeroOwnerCard();
        R3tardsCardMemory zeroMemory = new R3tardsCardMemory(address(zero));
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.CardNotFound.selector, 999));
        zeroMemory.write(999, 1, _one(bytes32(uint256(1))));
    }

    function testContractWalletOwnerCanWrite() public {
        CardWallet wallet = new CardWallet();
        card.mintTo(address(wallet), 77);
        wallet.write(memory_, 77, 32, _one(bytes32(uint256(0xBEEF))));
        assertEq(memory_.readPage(77)[32], bytes32(uint256(0xBEEF)));
    }

    function testApprovedOperatorAndSessionLikeKeyAreRejected() public {
        MutableCard flexible = new MutableCard();
        flexible.setOwner(9, alice);
        flexible.approveForTest(9, bob);
        R3tardsCardMemory driver = new R3tardsCardMemory(address(flexible));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.NotCardOwner.selector, 9, alice));
        driver.write(9, 1, _one(bytes32(uint256(1))));

        address sessionKey = makeAddr("paint session key");
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.NotCardOwner.selector, 9, alice));
        driver.write(9, 1, _one(bytes32(uint256(2))));
    }

    function testRangesAndMaximalWrite() public {
        vm.startPrank(alice);
        vm.expectRevert(R3tardsCardMemory.HeaderReadOnly.selector);
        memory_.write(1, 0, _one(bytes32(uint256(1))));

        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.BadRange.selector, 128, 1));
        memory_.write(1, 128, _one(bytes32(uint256(1))));

        bytes32[] memory empty = new bytes32[](0);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.BadRange.selector, 1, 0));
        memory_.write(1, 1, empty);

        bytes32[] memory two = new bytes32[](2);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.BadRange.selector, 127, 2));
        memory_.write(1, 127, two);

        bytes32[] memory maximal = new bytes32[](127);
        maximal[126] = bytes32(uint256(0xCAFE));
        memory_.write(1, 1, maximal);
        vm.stopPrank();
        assertEq(memory_.readPage(1)[127], bytes32(uint256(0xCAFE)));
    }

    function testFuzzRangeNeverOverflows(uint256 offset, uint256 length) public {
        if (offset >= 1 && offset < 128 && length >= 1 && length <= 128 - offset) return;
        bytes32[] memory words = new bytes32[](length > 129 ? 129 : length);
        vm.prank(alice);
        if (offset == 0 && words.length > 0) {
            vm.expectRevert(R3tardsCardMemory.HeaderReadOnly.selector);
        } else {
            vm.expectRevert();
        }
        memory_.write(1, offset, words);
    }

    function testFixedPageVectorsAndAlignment() public view {
        assertEq(memory_.pageBaseSlot(0), 0x6b71bb6efd9166d086e2ca2bb60c6830c27c98151766b97a776bdbac76135600);
        assertEq(memory_.pageBaseSlot(1), 0xb0317dfa75a5e4e238d0a2a8be689883bacc57aead5fdcefa5541ce837dac400);
        assertEq(memory_.pageBaseSlot(type(uint256).max), 0x96ca4398d5a8b526ff513d703c459a23941c8412ec7729e0fcdf36f8f48c2c00);
        assertEq(memory_.pageBaseSlot(143) & 127, 0);
    }

    function testFuzzDistinctPagesAreAlignedAndDisjoint(uint256 idA, uint256 idB) public view {
        vm.assume(idA != idB);
        uint256 a = memory_.pageBaseSlot(idA);
        uint256 b = memory_.pageBaseSlot(idB);
        assertTrue(a != b);
        assertEq(a & 127, 0);
        assertEq(b & 127, 0);
        uint256 distance = a > b ? a - b : b - a;
        assertGe(distance, 128);
    }

    function testMaximalWriteDoesNotTouchNeighbourPageOrAdjacentSlots() public {
        card.mintTo(alice, 2);
        uint256 a = memory_.pageBaseSlot(1);
        uint256 b = memory_.pageBaseSlot(2);
        bytes32[128] memory beforeB;
        for (uint256 i; i < 128; ++i) beforeB[i] = vm.load(address(memory_), bytes32(b + i));
        bytes32 beforeLeft = vm.load(address(memory_), bytes32(a - 1));
        bytes32 beforeRight = vm.load(address(memory_), bytes32(a + 128));
        bytes32[] memory maximal = new bytes32[](127);
        for (uint256 i; i < 127; ++i) maximal[i] = bytes32(i + 1);
        vm.prank(alice);
        memory_.write(1, 1, maximal);
        for (uint256 i; i < 128; ++i) assertEq(vm.load(address(memory_), bytes32(b + i)), beforeB[i]);
        assertEq(vm.load(address(memory_), bytes32(a - 1)), beforeLeft);
        assertEq(vm.load(address(memory_), bytes32(a + 128)), beforeRight);
    }

    function testHeaderAfterFirstAndSecondWrite() public {
        vm.roll(21_001);
        vm.prank(alice);
        memory_.write(1, 1, _one(bytes32(uint256(1))));
        R3tardsCardMemory.CardInfo memory first = memory_.cardInfo(1);
        assertTrue(first.formatted);
        assertEq(first.version, 1);
        assertEq(first.writes, 1);
        assertEq(first.firstWriteBlock, 21_001);
        assertEq(first.lastWriteBlock, 21_001);

        vm.roll(21_009);
        vm.prank(alice);
        memory_.write(1, 2, _one(bytes32(uint256(2))));
        R3tardsCardMemory.CardInfo memory second = memory_.cardInfo(1);
        assertEq(second.writes, 2);
        assertEq(second.firstWriteBlock, 21_001);
        assertEq(second.lastWriteBlock, 21_009);
    }

    function testExplicitExtremePagesAreDisjoint() public view {
        uint256 a = memory_.pageBaseSlot(0);
        uint256 b = memory_.pageBaseSlot(1);
        uint256 c = memory_.pageBaseSlot(type(uint256).max);
        assertTrue(a != b && a != c && b != c);
        assertGe(a > b ? a - b : b - a, 128);
        assertGe(a > c ? a - c : c - a, 128);
        assertGe(b > c ? b - c : c - b, 128);
    }

    function testFirstAndLastByteOfEveryRegionRoundTrips() public {
        uint256[8] memory firstWords = [uint256(1), 2, 18, 22, 23, 24, 28, 32];
        uint256[8] memory lastWords = [uint256(1), 17, 21, 22, 23, 27, 31, 127];
        uint32 expectedWrites;

        for (uint256 i; i < firstWords.length; ++i) {
            uint256 firstByte = 0xA0 + i;
            uint256 lastByte = 0xB0 + i;
            if (firstWords[i] == lastWords[i]) {
                vm.prank(alice);
                memory_.write(
                    1,
                    firstWords[i],
                    _one(bytes32((firstByte << 248) | lastByte))
                );
                expectedWrites += 1;
            } else {
                vm.prank(alice);
                memory_.write(1, firstWords[i], _one(bytes32(firstByte << 248)));
                vm.prank(alice);
                memory_.write(1, lastWords[i], _one(bytes32(lastByte)));
                expectedWrites += 2;
            }
        }

        bytes32[128] memory page = memory_.readPage(1);
        for (uint256 i; i < firstWords.length; ++i) {
            assertEq(uint8(uint256(page[firstWords[i]]) >> 248), uint8(0xA0 + i));
            assertEq(uint8(uint256(page[lastWords[i]])), uint8(0xB0 + i));
        }

        R3tardsCardMemory.CardInfo memory info = memory_.cardInfo(1);
        assertTrue(info.formatted);
        assertEq(info.version, 1);
        assertEq(info.writes, expectedWrites);
        assertGt(info.firstWriteBlock, 0);
        assertEq(info.lastWriteBlock, block.number);

        bytes32 header = page[0];
        assertEq(uint8(uint256(header) >> 248), 0x43);
        assertEq(uint32(uint256(header) >> 224), 0x43415244);
        assertEq(uint8(uint256(header) >> 216), 1);
        assertEq(uint8(uint256(header)), 0);
    }

    function testCardOfTracksLastWrittenCardAndInvalidatesAfterOwnerChange() public {
        MutableCard flexible = new MutableCard();
        flexible.setOwner(1, alice);
        flexible.setOwner(type(uint256).max, alice);
        R3tardsCardMemory driver = new R3tardsCardMemory(address(flexible));

        vm.prank(alice);
        driver.write(1, 1, _one(bytes32(uint256(1))));
        (bool found, uint256 id) = driver.cardOf(alice);
        assertTrue(found);
        assertEq(id, 1);

        vm.prank(alice);
        driver.write(type(uint256).max, 1, _one(bytes32(uint256(2))));
        (found, id) = driver.cardOf(alice);
        assertTrue(found);
        assertEq(id, type(uint256).max);

        flexible.setOwner(type(uint256).max, bob);
        (found, id) = driver.cardOf(alice);
        assertFalse(found);
        assertEq(id, type(uint256).max);
    }

    function testEmptyHashAndReadCost() public view {
        assertEq(memory_.pageHash(123456), EMPTY_PAGE_HASH);
        uint256 used = memory_.readCost(123456);
        assertGt(used, 2_000);
        assertLt(used, 60_000);
    }

    function testPageHashMatchesRawPageEncoding() public {
        vm.prank(alice);
        memory_.write(1, 1, _one(bytes32("abc")));
        bytes32[128] memory page = memory_.readPage(1);
        assertEq(memory_.pageHash(1), keccak256(abi.encode(page)));
    }

    function testStampTrueFalseAndFailureSafe() public {
        (string memory name, bool earned) = memory_.stamp(alice);
        assertEq(name, "MONAD CARD");
        assertTrue(earned);
        (, earned) = memory_.stamp(bob);
        assertFalse(earned);

        RevertingCard broken = new RevertingCard();
        R3tardsCardMemory brokenMemory = new R3tardsCardMemory(address(broken));
        (, earned) = brokenMemory.stamp(alice);
        assertFalse(earned);
    }

    function testPainterPassDecodesCardStampAtSixPlusSourceId() public {
        PaintStatsMock stats = new PaintStatsMock();
        stats.setStats(alice, 1, 1);
        R3tardsPainterPass pass = new R3tardsPainterPass(address(stats));
        uint256 sourceId = pass.addStampSource(address(memory_));
        assertEq(6 + sourceId, 6);
        vm.prank(alice);
        uint256 tokenId = pass.claim();
        assertGt(bytes(pass.tokenURI(tokenId)).length, 100);
    }

    function testCardCarrierQuestRequiresCardAnd143Pixels() public {
        PaintStatsMock stats = new PaintStatsMock();
        R3tardsQuests quests = new R3tardsQuests(address(stats), uint64(block.timestamp), address(this));
        R3tardsQuests.Condition[] memory conditions = new R3tardsQuests.Condition[](2);
        conditions[0] = R3tardsQuests.Condition(
            address(card), bytes4(keccak256("balanceOf(address)")), 0, 0, 1
        );
        conditions[1] = R3tardsQuests.Condition(
            address(stats), bytes4(keccak256("painterStats(address)")), 2, 0, 143
        );
        uint256 id = quests.addQuest("CARD CARRIER", 0, 0, conditions);

        stats.setStats(alice, 142, 1);
        vm.prank(alice);
        vm.expectRevert();
        quests.claim(id);

        stats.setStats(bob, 143, 1);
        vm.prank(bob);
        vm.expectRevert();
        quests.claim(id);

        stats.setStats(alice, 143, 1);
        vm.prank(alice);
        quests.claim(id);
        assertEq(quests.completedCount(alice), 1);
    }

    function _cameraFixture() private returns (
        R3tardsPaint paint,
        R3tardsLabs labs,
        R3tardsBlockCamera camera
    ) {
        MockR3tards r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards), uint64(block.timestamp), alice, royalty, 512, 0, 512, 16, 256
        );
        labs = new R3tardsLabs(address(paint), royalty);
        camera = new R3tardsBlockCamera(address(paint), address(labs), address(memory_));
        vm.prank(alice);
        uint256 experimentId = paint.addExperiment(address(camera), "block-camera", "");
        camera.bindExperimentId(experimentId);
        vm.mockCall(
            STAKING,
            abi.encodeWithSelector(bytes4(keccak256("getEpoch()"))),
            abi.encode(uint64(7), false)
        );
        vm.mockCall(
            STAKING,
            abi.encodeWithSelector(bytes4(keccak256("getProposerValId()"))),
            abi.encode(uint64(182))
        );
    }

    function testBlockCameraCardCaptureOwnerHashesAndAttributes() public {
        (R3tardsPaint paint, R3tardsLabs labs, R3tardsBlockCamera camera) = _cameraFixture();
        card.mintTo(bob, 88);
        vm.prank(bob);
        memory_.write(88, 1, _one(bytes32("camera")));

        vm.prank(bob);
        uint256 plainId = camera.captureCard(88, false);
        (bool present, R3tardsBlockCamera.CardShot memory plain) = camera.cardShot(plainId);
        assertTrue(present);
        assertEq(plain.cardPageHash, memory_.pageHash(88));
        assertFalse(plain.hasCanvas);
        assertEq(plain.canvasHash, bytes32(0));

        vm.roll(block.number + 1);
        bytes32 expectedCanvas = keccak256(paint.getCanvas(paint.currentSeason()));
        vm.prank(bob);
        uint256 canvasId = camera.captureCard(88, true);
        (, R3tardsBlockCamera.CardShot memory withCanvas) = camera.cardShot(canvasId);
        assertTrue(withCanvas.hasCanvas);
        assertEq(withCanvas.canvasHash, expectedCanvas);
        assertEq(labs.ownerOf(canvasId), bob);

        (
            string memory kind,
            string memory description,
            bytes memory imageSvg,
            string memory attributes,
            uint8 dominant,
            uint8 colours
        ) = camera.labToken(canvasId);
        assertEq(kind, "block portrait");
        assertTrue(_contains(description, "CARD.DRV"));
        assertGt(imageSvg.length, 100);
        dominant;
        colours;
        assertTrue(_contains(attributes, "Card slot"));
        assertTrue(_contains(attributes, "Card page hash"));
        assertTrue(_contains(attributes, "Canvas hash"));
    }

    function testBlockCameraCardOwnerAndDisabledChecks() public {
        (, R3tardsLabs labs, R3tardsBlockCamera camera) = _cameraFixture();
        card.mintTo(bob, 99);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsBlockCamera.NotCardOwner.selector, 99, bob));
        camera.captureCard(99, false);

        MockR3tards r3tards = new MockR3tards();
        R3tardsPaint paint2 = new R3tardsPaint(
            address(r3tards), uint64(block.timestamp), alice, royalty, 512, 0, 512, 16, 256
        );
        R3tardsLabs labs2 = new R3tardsLabs(address(paint2), royalty);
        R3tardsBlockCamera disabled = new R3tardsBlockCamera(address(paint2), address(labs2), address(0));
        vm.prank(alice);
        uint256 experimentId = paint2.addExperiment(address(disabled), "block-camera", "");
        disabled.bindExperimentId(experimentId);
        vm.prank(bob);
        vm.expectRevert(R3tardsBlockCamera.CardCaptureDisabled.selector);
        disabled.captureCard(99, false);
        labs;
    }

    function testPlainCaptureStillHasNoCardShot() public {
        (, R3tardsLabs labs, R3tardsBlockCamera camera) = _cameraFixture();
        vm.prank(bob);
        uint256 beforeGas = gasleft();
        uint256 tokenId = camera.capture();
        uint256 used = beforeGas - gasleft();
        (bool present,) = camera.cardShot(tokenId);
        assertFalse(present);
        assertEq(labs.ownerOf(tokenId), bob);
        assertLt(used, 3_000_000);
    }

    function testCaptureCardGasLoggedBothWays() public {
        (, , R3tardsBlockCamera camera) = _cameraFixture();
        card.mintTo(bob, 111);
        vm.prank(bob);
        uint256 before = gasleft();
        camera.captureCard(111, false);
        uint256 pageOnly = before - gasleft();
        vm.roll(block.number + 1);
        vm.prank(bob);
        before = gasleft();
        camera.captureCard(111, true);
        uint256 withCanvas = before - gasleft();
        emit log_named_uint("captureCard page only", pageOnly);
        emit log_named_uint("captureCard + canvas", withCanvas);
        assertLt(pageOnly, 5_000_000);
        assertLt(withCanvas, 8_000_000);
    }

    function testConstructorRejectsEOAAndWrongMainnetCard() public {
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.NotAContract.selector, alice));
        new R3tardsCardMemory(alice);

        MutableCard local = new MutableCard();
        vm.chainId(143);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.WrongMainnetCard.selector, address(local)));
        new R3tardsCardMemory(address(local));
    }

    function _contains(string memory haystack, string memory needle) private pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool same = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) { same = false; break; }
            }
            if (same) return true;
        }
        return false;
    }
}
