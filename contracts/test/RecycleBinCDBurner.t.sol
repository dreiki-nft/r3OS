// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {R3tardsQuests} from "../src/labs/R3tardsQuests.sol";
import {R3tardsRecycleBin} from "../src/labs/R3tardsRecycleBin.sol";
import {R3tardsCDBurner} from "../src/labs/R3tardsCDBurner.sol";
import {IR3tardsPaintData} from "../src/interfaces/IR3tardsPaintData.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract MockRecycleCore {
    mapping(uint256 => address) private _owners;
    mapping(uint256 => address) private _approvals;
    mapping(address => mapping(address => bool)) private _operators;
    mapping(uint256 => IR3tardsPaintData.FrameInfoData) private _info;
    uint256 private _nextId = 1;

    function mint(address to) external returns (uint256 id) {
        id = _nextId++;
        _owners[id] = to;
        _info[id] = IR3tardsPaintData.FrameInfoData({
            minter: to,
            proposer: address(0xBEEF),
            dataPointer: address(1),
            blockNumber: uint48(block.number),
            season: 0,
            seasonFrameIndex: uint48(id),
            frameNumber: uint48(id),
            paintsSincePreviousFrame: 1,
            df1Amount: 100,
            faceColor: 1,
            backgroundColor: 0,
            holderAtMint: false,
            finale: false
        });
    }

    function ownerOf(uint256 tokenId) external view returns (address owner) {
        owner = _owners[tokenId];
        require(owner != address(0), "no token");
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(_owners[tokenId] != address(0), "no token");
        return _approvals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    function approve(address operator, uint256 tokenId) external {
        require(_owners[tokenId] == msg.sender, "not owner");
        _approvals[tokenId] = operator;
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
    }

    function burn(uint256 tokenId) external {
        address owner = _owners[tokenId];
        require(owner != address(0), "no token");
        require(msg.sender == owner || _approvals[tokenId] == msg.sender || _operators[owner][msg.sender], "not auth");
        delete _owners[tokenId];
        delete _approvals[tokenId];
    }

    function frameInfo(uint256 tokenId) external view returns (IR3tardsPaintData.FrameInfoData memory) {
        return _info[tokenId];
    }

    function isStorm(uint256) external pure returns (bool) {
        return false;
    }

    function isActiveSessionKey(address) external pure returns (bool) {
        return false;
    }

    function sessionInfo(address) external pure returns (
        address owner,
        uint256 expiryBlock,
        uint256 maxUnits,
        uint256 unitsSpent,
        bool revoked,
        bool active
    ) {
        return (address(0), 0, 0, 0, false, false);
    }
}


contract MockCDCore {
    mapping(uint256 => address) private _owners;
    mapping(uint256 => bytes) private _data;
    mapping(uint256 => IR3tardsPaintData.FrameInfoData) private _info;
    address private _experiment;
    uint256 private _nextId = 1;

    function setExperiment(address experiment_) external {
        _experiment = experiment_;
    }

    function mintFrame(address to, bytes memory data, uint8 background) external returns (uint256 id) {
        id = _nextId++;
        _owners[id] = to;
        _data[id] = data;
        _info[id] = IR3tardsPaintData.FrameInfoData({
            minter: to,
            proposer: address(0xBEEF),
            dataPointer: address(1),
            blockNumber: uint48(block.number),
            season: 0,
            seasonFrameIndex: uint48(id),
            frameNumber: uint48(id),
            paintsSincePreviousFrame: 1,
            df1Amount: 100,
            faceColor: 1,
            backgroundColor: background,
            holderAtMint: false,
            finale: false
        });
    }

    function ownerOf(uint256 tokenId) external view returns (address owner) {
        owner = _owners[tokenId];
        require(owner != address(0), "no token");
    }

    function frameInfo(uint256 tokenId) external view returns (IR3tardsPaintData.FrameInfoData memory) {
        return _info[tokenId];
    }

    function frameData(uint256 tokenId) external view returns (bytes memory) {
        return _data[tokenId];
    }

    function experimentInfo(uint256 experimentId) external view returns (IR3tardsPaintData.ExperimentData memory) {
        require(experimentId == 0, "bad experiment");
        return IR3tardsPaintData.ExperimentData({
            experiment: _experiment,
            name: "cd-burner",
            uri: "",
            retired: false
        });
    }

    function currentSeason() external pure returns (uint256) {
        return 0;
    }

    function isStorm(uint256) external pure returns (bool) {
        return false;
    }

    function isR3tardHolder(address) external pure returns (bool) {
        return false;
    }

    function isActiveSessionKey(address) external pure returns (bool) {
        return false;
    }
}

contract RecycleBinCDBurnerTest is Test {
    MockR3tards r3tards;
    R3tardsPaint paint;
    R3tardsLabs labs;
    R3tardsRecycleBin bin;
    R3tardsCDBurner cd;

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = address(0xB0B);
    address royalty = address(0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA);
    uint64 seasonStart;

    function setUp() public {
        vm.roll(1_000);
        alice = vm.addr(alicePk);
        seasonStart = uint64(vm.getBlockTimestamp());
        r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards), seasonStart, alice, royalty, 10_000, 0, 10_000, 16, 256
        );
        labs = new R3tardsLabs(address(paint), royalty);
        bin = new R3tardsRecycleBin(address(paint));
        cd = new R3tardsCDBurner(address(paint), address(labs));

        vm.prank(alice);
        uint256 binExperiment = paint.addExperiment(address(bin), "recycle-bin", "");
        bin.bindExperimentId(binExperiment);
        vm.prank(alice);
        uint256 cdExperiment = paint.addExperiment(address(cd), "cd-burner", "");
        cd.bindExperimentId(cdExperiment);
    }

    function testRecycleWithApprovalSnapshotsAndEvents() public {
        uint256[] memory ids = _makeFrames(3);
        IR3tardsPaintData.FrameInfoData[] memory infos = new IR3tardsPaintData.FrameInfoData[](3);
        for (uint256 i; i < 3; ++i) infos[i] = IR3tardsPaintData(address(paint)).frameInfo(ids[i]);

        vm.prank(alice);
        paint.setApprovalForAll(address(bin), true);
        vm.recordLogs();
        uint256 burnBlock = block.number;
        vm.prank(alice);
        bin.recycle(ids);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 recycledTopic = keccak256("Recycled(address,uint256,uint256,uint256)");
        uint256 recycledIndex;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log_ = logs[i];
            if (log_.emitter != address(bin) || log_.topics.length == 0 || log_.topics[0] != recycledTopic) continue;
            assertLt(recycledIndex, ids.length);
            assertEq(address(uint160(uint256(log_.topics[1]))), alice);
            assertEq(uint256(log_.topics[2]), ids[recycledIndex]);
            (uint256 season, uint256 frameBlock) = abi.decode(log_.data, (uint256, uint256));
            assertEq(season, infos[recycledIndex].season);
            assertEq(frameBlock, infos[recycledIndex].blockNumber);
            ++recycledIndex;
        }
        assertEq(recycledIndex, 3);
        assertEq(bin.burnedBy(alice), 3);
        assertEq(bin.totalBurned(), 3);
        assertEq(bin.lastBurnBlock(alice), burnBlock);
        for (uint256 i; i < 3; ++i) {
            vm.expectRevert();
            paint.ownerOf(ids[i]);
            (address minter, uint32 season, uint48 blockNumber, bool storm) = bin.tombstone(ids[i]);
            assertEq(minter, infos[i].minter);
            assertEq(season, infos[i].season);
            assertEq(blockNumber, infos[i].blockNumber);
            assertEq(storm, paint.isStorm(infos[i].blockNumber));

            // Core snapshots deliberately survive an ERC-721 burn; the Bin tombstone is a cheap indexed graveyard record.
            IR3tardsPaintData.FrameInfoData memory survivingInfo = IR3tardsPaintData(address(paint)).frameInfo(ids[i]);
            assertEq(survivingInfo.minter, infos[i].minter);
            assertEq(paint.frameData(ids[i]).length, 32_768);
        }
    }

    function testRecycleRejectsBadBatchSizesAndMissingApproval() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsRecycleBin.InvalidCount.selector, 0));
        bin.recycle(new uint256[](0));

        uint256[] memory tooMany = new uint256[](51);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsRecycleBin.InvalidCount.selector, 51));
        bin.recycle(tooMany);

        uint256 frame = _makeFrame(alice, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsRecycleBin.BinNotApproved.selector, frame));
        bin.recycle(_one(frame));
        assertEq(paint.ownerOf(frame), alice);
    }

    function testRecycleRejectsNotYoursTokenZeroFinalesAndSessionKeys() public {
        uint256 frame = _makeFrame(alice, 0);
        vm.prank(alice);
        paint.setApprovalForAll(address(bin), true);

        uint256[] memory one = _one(frame);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3tardsRecycleBin.NotFrameOwner.selector, frame, alice));
        bin.recycle(one);

        vm.prank(alice);
        paint.approve(address(bin), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.NonBurnableToken.selector, 0));
        bin.recycle(_one(0));

        vm.warp(uint256(seasonStart) + 30 days);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 finale = paint.mintSeasonFinale(0);
        vm.prank(alice);
        paint.approve(address(bin), finale);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.NonBurnableToken.selector, finale));
        bin.recycle(_one(finale));

        address key = makeAddr("recycle-session");
        _startSession(key, 100, 512);
        vm.prank(key);
        vm.expectRevert(R3tardsRecycleBin.SessionKeyCannotRecycle.selector);
        bin.recycle(one);

        vm.prank(alice);
        paint.setApprovalForAll(key, true);
        vm.prank(key);
        vm.expectRevert(R3tardsRecycleBin.SessionKeyCannotRecycle.selector);
        paint.safeTransferFrom(alice, address(bin), frame);
    }

    function testReceiverRejectsOtherCollections() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3tardsRecycleBin.WrongCollection.selector, bob));
        bin.onERC721Received(alice, alice, 1, "");
    }

    function testSafeTransferSingleDropBurnsAndCreditsFrom() public {
        uint256 frame = _makeFrame(alice, 0);
        vm.prank(alice);
        paint.safeTransferFrom(alice, address(bin), frame);

        vm.expectRevert();
        paint.ownerOf(frame);
        assertEq(bin.burnedBy(alice), 1);
        assertEq(bin.totalBurned(), 1);
        (address minter,,,) = bin.tombstone(frame);
        assertEq(minter, alice);
    }

    function testTopTenMatchesNaiveStableSortAcrossFifteenWallets() public {
        MockRecycleCore core = new MockRecycleCore();
        R3tardsRecycleBin mockBin = new R3tardsRecycleBin(address(core));
        address[] memory wallets = new address[](15);
        uint256[] memory counts = new uint256[](15);

        for (uint256 i; i < 15; ++i) {
            address wallet = address(uint160(0x1000 + i));
            uint256 count = (uint256(keccak256(abi.encodePacked("burn-count", i))) % 19) + 1;
            wallets[i] = wallet;
            counts[i] = count;
            uint256[] memory ids = new uint256[](count);
            for (uint256 j; j < count; ++j) ids[j] = core.mint(wallet);
            vm.prank(wallet);
            core.setApprovalForAll(address(mockBin), true);
            vm.prank(wallet);
            mockBin.recycle(ids);
        }

        // stable insertion sort, descending: earlier wallets stay ahead on ties
        for (uint256 i = 1; i < wallets.length; ++i) {
            uint256 c = counts[i];
            address w = wallets[i];
            uint256 j = i;
            while (j > 0 && counts[j - 1] < c) {
                counts[j] = counts[j - 1];
                wallets[j] = wallets[j - 1];
                --j;
            }
            counts[j] = c;
            wallets[j] = w;
        }

        (address[10] memory top, uint256[10] memory topCounts) = mockBin.topBurners();
        for (uint256 i; i < 10; ++i) {
            assertEq(top[i], wallets[i]);
            assertEq(topCounts[i], counts[i]);
        }
    }

    function testTopTenReordersOnLaterUpdatesAndKeepsFirstToTieAhead() public {
        MockRecycleCore core = new MockRecycleCore();
        R3tardsRecycleBin mockBin = new R3tardsRecycleBin(address(core));
        address a = address(0xA0);
        address b = address(0xB0);

        vm.prank(a);
        core.setApprovalForAll(address(mockBin), true);
        vm.prank(b);
        core.setApprovalForAll(address(mockBin), true);

        uint256[] memory aFirst = _mockFrames(core, a, 1);
        uint256[] memory bFirst = _mockFrames(core, b, 2);
        uint256[] memory aSecond = _mockFrames(core, a, 1);
        vm.prank(a);
        mockBin.recycle(aFirst);
        vm.prank(b);
        mockBin.recycle(bFirst);
        vm.prank(a);
        mockBin.recycle(aSecond);

        (address[10] memory tied, uint256[10] memory tiedCounts) = mockBin.topBurners();
        assertEq(tied[0], b);
        assertEq(tiedCounts[0], 2);
        assertEq(tied[1], a);
        assertEq(tiedCounts[1], 2);

        uint256[] memory aThird = _mockFrames(core, a, 1);
        vm.prank(a);
        mockBin.recycle(aThird);
        (address[10] memory moved, uint256[10] memory movedCounts) = mockBin.topBurners();
        assertEq(moved[0], a);
        assertEq(movedCounts[0], 3);
        assertEq(moved[1], b);
        assertEq(movedCounts[1], 2);
    }

    function testRecyclerQuestThirteenBecomesClaimableAtOneHundredBurns() public {
        MockRecycleCore core = new MockRecycleCore();
        R3tardsRecycleBin mockBin = new R3tardsRecycleBin(address(core));
        vm.prank(alice);
        core.setApprovalForAll(address(mockBin), true);
        for (uint256 batch; batch < 2; ++batch) {
            uint256[] memory ids = new uint256[](50);
            for (uint256 i; i < 50; ++i) ids[i] = core.mint(alice);
            vm.prank(alice);
            mockBin.recycle(ids);
        }
        assertEq(mockBin.burnedBy(alice), 100);
        (string memory stampName, bool earned) = mockBin.stamp(alice);
        assertEq(stampName, "RECYCLER");
        assertTrue(earned);

        R3tardsQuests quests = new R3tardsQuests(address(core), 0, address(this));
        for (uint256 i; i < 12; ++i) _addQuest(quests, mockBin, string.concat("DUMMY ", vm.toString(i)), 0);
        _addQuest(quests, mockBin, "RECYCLER", 100);
        assertEq(quests.questCount(), 13);
        assertTrue((quests.claimable(alice) & (uint256(1) << 12)) != 0);
        vm.prank(alice);
        quests.claim(12);
        assertEq(quests.completedCount(alice), 1);
    }

    function testCDBurnerValidationAndUppercaseFold() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCDBurner.InvalidTrackCount.selector, 0));
        cd.burnCD(new uint256[](0), "mix");

        uint256[] memory thirteen = new uint256[](13);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCDBurner.InvalidTrackCount.selector, 13));
        cd.burnCD(thirteen, "mix");

        uint256 frame = _makeFrame(alice, 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCDBurner.InvalidLabelLength.selector, 0));
        cd.burnCD(_one(frame), "");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCDBurner.InvalidLabelLength.selector, 25));
        cd.burnCD(_one(frame), "abcdefghijklmnopqrstuvwxy");

        uint256[] memory duplicate = new uint256[](2);
        duplicate[0] = frame;
        duplicate[1] = frame;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCDBurner.DuplicateTrack.selector, frame));
        cd.burnCD(duplicate, "mix");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCDBurner.NotFrameOwner.selector, frame, alice));
        cd.burnCD(_one(frame), "mix");

        vm.prank(alice);
        vm.expectRevert(R3tardsCDBurner.TokenZeroNotAllowed.selector);
        cd.burnCD(_one(0), "mix");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCDBurner.InvalidLabelCharacter.selector, uint256(3), bytes1("_")));
        cd.burnCD(_one(frame), "bad_label");

        address key = makeAddr("cd-session");
        _startSession(key, 100, 512);
        vm.prank(key);
        vm.expectRevert(R3tardsCDBurner.SessionKeyCannotBurnCD.selector);
        cd.burnCD(_one(frame), "mix");

        vm.prank(alice);
        uint256 cdId = cd.burnCD(_one(frame), "MY MIX #1");
        bytes memory json = _json(labs.tokenURI(cdId));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".name"), string.concat("r3tards labs cd #", vm.toString(cdId), ": my mix #1"));
    }

    function testCDBurnerLeavesFramesUntouchedAndSnapshotSurvivesRecycle() public {
        uint256[] memory ids = _makeFrames(2);
        vm.prank(alice);
        uint256 cdId = cd.burnCD(ids, "keep these");
        assertEq(paint.ownerOf(ids[0]), alice);
        assertEq(paint.ownerOf(ids[1]), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsLabs.BurnNotAllowed.selector, cdId));
        labs.burn(cdId);

        bytes32 beforeHash = keccak256(bytes(labs.tokenURI(cdId)));
        vm.prank(alice);
        paint.approve(address(bin), ids[0]);
        vm.prank(alice);
        bin.recycle(_one(ids[0]));
        vm.expectRevert();
        paint.ownerOf(ids[0]);
        assertEq(paint.ownerOf(ids[1]), alice);
        assertEq(keccak256(bytes(labs.tokenURI(cdId))), beforeHash);
    }

    function testCDJsonTraitsBucketsMultiSeasonAndFinale() public {
        uint256 first = _makeFrame(alice, 0);
        vm.warp(uint256(seasonStart) + 30 days);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 finale = paint.mintSeasonFinale(0);
        uint256 second = _makeFrame(alice, 1);

        uint256[] memory tracks = new uint256[](3);
        tracks[0] = first;
        tracks[1] = finale;
        tracks[2] = second;
        vm.prank(alice);
        uint256 cdId = cd.burnCD(tracks, "two seasons");
        bytes memory json = _json(labs.tokenURI(cdId));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".attributes[0].value"), "CD");
        assertEq(vm.parseJsonUint(string(json), ".attributes[10].value"), 3);
        assertEq(vm.parseJsonString(string(json), ".attributes[11].value"), "EP");
        assertEq(vm.parseJsonUint(string(json), ".attributes[12].value"), 2);
        assertEq(vm.parseJsonString(string(json), ".attributes[13].value"), "Multi season");
        assertEq(vm.parseJsonString(string(json), ".attributes[15].value"), "yes");
        assertEq(vm.parseJsonUint(string(json), ".attributes[16].value"), first);
        assertEq(vm.parseJsonUint(string(json), ".attributes[17].value"), 0);
        assertEq(vm.parseJsonString(string(json), ".attributes[18].value"), "Silver");
    }

    function testCDFormatBucketsAndSvg() public {
        uint256[] memory frames = _makeFrames(9);
        uint256[4] memory lengths = [uint256(1), 2, 5, 9];
        string[4] memory expected = [string("Single"), "EP", "Album", "Full length"];
        uint256 lastId;
        for (uint256 k; k < 4; ++k) {
            uint256[] memory subset = new uint256[](lengths[k]);
            for (uint256 i; i < lengths[k]; ++i) subset[i] = frames[i];
            vm.prank(alice);
            uint256 cdId = cd.burnCD(subset, string.concat("bucket ", vm.toString(k)));
            bytes memory json = _json(labs.tokenURI(cdId));
            vm.parseJson(string(json));
            assertEq(vm.parseJsonString(string(json), ".attributes[11].value"), expected[k]);
            lastId = cdId;
        }

        (
            string memory kind,
            string memory description,
            bytes memory svg,
            string memory attributes,
            uint8 dominant,
            uint8 colours
        ) = cd.labToken(lastId);
        assertEq(kind, "CD");
        assertTrue(bytes(description).length != 0);
        assertTrue(bytes(attributes).length != 0);
        assertLt(dominant, 16);
        assertGt(colours, 0);
        vm.writeFile("test-output/cd.svg", string(svg));
    }


    function testCDTrackColoursPickTopTwoAndLowerTie() public {
        (MockCDCore core, R3tardsLabs mockLabs, R3tardsCDBurner mockCd) = _newMockCD();
        bytes memory data = new bytes(32_768);
        for (uint256 i; i < 7; ++i) _setSample(data, i, 4);
        for (uint256 i = 7; i < 12; ++i) _setSample(data, i, 5);
        for (uint256 i = 12; i < 17; ++i) _setSample(data, i, 8);

        uint256 frame = core.mintFrame(alice, data, 1);
        vm.prank(alice);
        uint256 cdId = mockCd.burnCD(_one(frame), "tie");
        address pointer = mockCd.snapshotPointer(cdId);
        bytes memory code = pointer.code;

        assertEq(uint8(code[118]), 0x45);
        assertEq(_snapshotDiscMask(code), (uint16(1) << 4) | (uint16(1) << 5));
        bytes memory json = _json(mockLabs.tokenURI(cdId));
        assertEq(vm.parseJsonUint(string(json), ".attributes[17].value"), 2);
        assertEq(vm.parseJsonString(string(json), ".attributes[18].value"), "Duo");
    }

    function testCDBlackAndWhiteHasNoDiscColoursAndRendersSilver() public {
        (MockCDCore core, R3tardsLabs mockLabs, R3tardsCDBurner mockCd) = _newMockCD();
        bytes memory data = new bytes(32_768);
        for (uint256 i; i < 24; ++i) _setSample(data, i, 7);

        uint256 frame = core.mintFrame(alice, data, 1);
        vm.prank(alice);
        uint256 cdId = mockCd.burnCD(_one(frame), "b&w only");
        address pointer = mockCd.snapshotPointer(cdId);
        bytes memory code = pointer.code;

        assertEq(uint8(code[118]), 0);
        assertEq(_snapshotDiscMask(code), 0);
        bytes memory json = _json(mockLabs.tokenURI(cdId));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonUint(string(json), ".attributes[17].value"), 0);
        assertEq(vm.parseJsonString(string(json), ".attributes[18].value"), "Silver");

        (
            string memory kind,
            string memory description,
            bytes memory svg,
            string memory attributes,
            uint8 dominant,
            uint8 colours
        ) = mockCd.labToken(cdId);
        assertEq(kind, "CD");
        assertTrue(bytes(description).length != 0);
        assertTrue(bytes(attributes).length != 0);
        assertLt(dominant, 16);
        assertGt(colours, 0);
        assertGt(svg.length, 0);
    }

    function testCDOneDiscColourStoresExactlyOne() public {
        (MockCDCore core, R3tardsLabs mockLabs, R3tardsCDBurner mockCd) = _newMockCD();
        bytes memory data = new bytes(32_768);
        for (uint256 i; i < 19; ++i) _setSample(data, i, 8);

        uint256 frame = core.mintFrame(alice, data, 1);
        vm.prank(alice);
        uint256 cdId = mockCd.burnCD(_one(frame), "all green");
        address pointer = mockCd.snapshotPointer(cdId);
        bytes memory code = pointer.code;

        assertEq(uint8(code[118]), 0x80);
        assertEq(_snapshotDiscMask(code), uint16(1) << 8);
        bytes memory json = _json(mockLabs.tokenURI(cdId));
        assertEq(vm.parseJsonUint(string(json), ".attributes[17].value"), 1);
        assertEq(vm.parseJsonString(string(json), ".attributes[18].value"), "Mono");
    }

    function testGasTwelveTrackCDTokenURIAndRecycle() public {
        uint256[] memory frames = _makeFrames(12);
        vm.prank(alice);
        uint256 beforeGas = gasleft();
        uint256 cdId = cd.burnCD(frames, "gas test full length");
        uint256 mintGas = beforeGas - gasleft();
        console.log("GAS CD burner 12-track mint", mintGas);
        assertLe(mintGas, 3_500_000);

        beforeGas = gasleft();
        labs.tokenURI(cdId);
        uint256 uriGas = beforeGas - gasleft();
        console.log("GAS Labs tokenURI 12-track CD", uriGas);
        assertLe(uriGas, 9_000_000);

        vm.prank(alice);
        paint.setApprovalForAll(address(bin), true);
        vm.prank(alice);
        beforeGas = gasleft();
        bin.recycle(_one(frames[0]));
        console.log("GAS RecycleBin recycle(1)", beforeGas - gasleft());

        uint256[] memory fifty = _makeFrames(50);
        vm.prank(alice);
        beforeGas = gasleft();
        bin.recycle(fifty);
        console.log("GAS RecycleBin recycle(50)", beforeGas - gasleft());
    }


    function _newMockCD() private returns (MockCDCore core, R3tardsLabs mockLabs, R3tardsCDBurner mockCd) {
        core = new MockCDCore();
        mockLabs = new R3tardsLabs(address(core), royalty);
        mockCd = new R3tardsCDBurner(address(core), address(mockLabs));
        core.setExperiment(address(mockCd));
        mockCd.bindExperimentId(0);
    }

    function _setSample(bytes memory data, uint256 sampleIndex, uint8 colour) private pure {
        uint256 y = sampleIndex / 32;
        uint256 x = sampleIndex % 32;
        uint256 offset = (255 - y * 8) * 128 + x * 4;
        data[offset] = bytes1(colour << 4);
    }

    function _snapshotDiscMask(bytes memory runtimeCode) private pure returns (uint16) {
        return (uint16(uint8(runtimeCode[49])) << 8) | uint16(uint8(runtimeCode[50]));
    }

    function _makeFrames(uint256 count) private returns (uint256[] memory ids) {
        ids = new uint256[](count);
        for (uint256 i; i < count; ++i) ids[i] = _makeFrame(alice, i);
    }

    function _makeFrame(address painter, uint256 index) private returns (uint256 id) {
        uint8 colour = uint8(2 + (index % 14));
        // Same known-clear test patch used by the Forks suite: row 200, x 200..215.
        bytes memory run = abi.encodePacked(bytes1(uint8(200)), bytes1(uint8(200)), bytes1(uint8(215)), bytes1(colour));
        vm.prank(painter);
        paint.paint(run, new uint256[](0));
        vm.prank(painter);
        id = paint.mintFrame();
        vm.roll(vm.getBlockNumber() + paint.FRAME_COOLDOWN_BLOCKS() + 1);
    }

    function _mockFrames(MockRecycleCore core, address owner, uint256 count) private returns (uint256[] memory ids) {
        ids = new uint256[](count);
        for (uint256 i; i < count; ++i) ids[i] = core.mint(owner);
    }

    function _one(uint256 id) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = id;
    }

    function _startSession(address key, uint256 blocks_, uint256 maxUnits) private {
        uint256 expiry = vm.getBlockNumber() + blocks_;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        uint256 nonce = paint.sessionNonces(alice);
        bytes32 structHash = keccak256(
            abi.encode(paint.SESSION_TYPEHASH(), alice, key, expiry, maxUnits, nonce, deadline)
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);
        vm.prank(key);
        paint.startSession(alice, key, expiry, maxUnits, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function _addQuest(R3tardsQuests quests, R3tardsRecycleBin target, string memory name, uint256 threshold)
        private
    {
        R3tardsQuests.Condition[] memory conditions = new R3tardsQuests.Condition[](1);
        conditions[0] = R3tardsQuests.Condition(
            address(target), bytes4(keccak256("burnedBy(address)")), 0, 0, threshold
        );
        quests.addQuest(name, 0, 0, conditions);
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
