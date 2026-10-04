// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSPainterPass} from "../src/R3OSPainterPass.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {DiffRenderer} from "../src/renderers/DiffRenderer.sol";
import {SeasonTimelapseRenderer} from "../src/renderers/SeasonTimelapseRenderer.sol";
import {DF1Renderer} from "../src/renderers/DF1Renderer.sol";
import {R3OSFlipbook} from "../src/labs/R3OSFlipbook.sol";
import {R3OSWeeds} from "../src/labs/R3OSWeeds.sol";
import {R3OSForks} from "../src/labs/R3OSForks.sol";
import {R3OSBrushes} from "../src/labs/R3OSBrushes.sol";
import {R3OSFinaleAuction} from "../src/labs/R3OSFinaleAuction.sol";
import {R3OSQuests} from "../src/labs/R3OSQuests.sol";
import {R3OSSleepwalker} from "../src/labs/R3OSSleepwalker.sol";
import {SleepwalkerKey} from "../src/labs/SleepwalkerKey.sol";
import {R3OSRecycleBin} from "../src/labs/R3OSRecycleBin.sol";
import {R3OSCDBurner} from "../src/labs/R3OSCDBurner.sol";

contract Deploy is Script {
    uint256 private constant QUEST_MONTH_IN_ACTIVE_DAYS = 30;
    uint256 private constant QUEST_STORM_REGULAR_PAINTS = 50;
    uint256 private constant QUEST_LIVE_WIRE_SESSION_PAINTS = 500;
    uint256 private constant QUEST_TEN_K_PIXELS = 10_000;
    uint256 private constant QUEST_ARCHIVIST_FRAMES = 10;
    uint256 private constant QUEST_ANIMATOR_FRAMES = 100;
    uint256 private constant QUEST_REEL_MAKER_BALANCE = 1;
    uint256 private constant QUEST_GREEN_THUMB_PLANTS = 25;
    uint256 private constant QUEST_TIMELINES_FORKS = 10;
    uint256 private constant QUEST_DNA_HUNTER_VERIFIED = 10;
    uint256 private constant QUEST_LAB_RAT_STAMP = 1;
    uint256 private constant QUEST_PADDLE_UP_BIDS = 1;
    uint256 private constant QUEST_RECYCLER_BURNS = 100;

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address r3tards = vm.envAddress("R3TARDS_ADDRESS");
        uint64 seasonStart = uint64(vm.envUint("SEASON_START"));
        address tokenZeroRecipient = vm.envOr("TOKEN_ZERO_RECIPIENT", deployer);
        address royaltyReceiver = vm.envOr("ROYALTY_RECEIVER", deployer);
        address finalOwner = vm.envOr("FINAL_OWNER", deployer);
        uint32 basePixelsPerHour = uint32(vm.envUint("BASE_PIXELS_PER_HOUR"));
        uint32 pixelsPerActiveDay = uint32(vm.envUint("PIXELS_PER_ACTIVE_DAY"));
        uint32 maxPixelsPerHour = uint32(vm.envUint("MAX_PIXELS_PER_HOUR"));
        uint32 minPixelsForActiveDay = uint32(vm.envUint("MIN_PIXELS_FOR_ACTIVE_DAY"));
        uint32 holderPixelsPerDay = uint32(vm.envUint("HOLDER_PIXELS_PER_DAY"));

        if (block.chainid == 143 && !vm.envOr("CONFIRM_MAINNET", false)) {
            revert("mainnet blocked: deploy testnet first, then set CONFIRM_MAINNET=true");
        }
        require(tokenZeroRecipient != address(0), "token zero recipient is zero");
        require(royaltyReceiver != address(0), "royalty receiver is zero");
        require(finalOwner != address(0), "final owner is zero");

        vm.startBroadcast(deployer);

        R3OSPaint paint = R3OSPaint(
            vm.deployCode(
                "R3OSPaint.sol:R3OSPaint",
                abi.encode(
                    r3tards,
                    seasonStart,
                    deployer,
                    royaltyReceiver,
                    basePixelsPerHour,
                    pixelsPerActiveDay,
                    maxPixelsPerHour,
                    minPixelsForActiveDay,
                    holderPixelsPerDay
                )
            )
        );
        R3OSLabs labs = R3OSLabs(
            vm.deployCode("R3OSLabs.sol:R3OSLabs", abi.encode(address(paint), royaltyReceiver))
        );
        DiffRenderer diff = DiffRenderer(vm.deployCode("DiffRenderer.sol:DiffRenderer"));
        SeasonTimelapseRenderer timelapse =
            SeasonTimelapseRenderer(vm.deployCode("SeasonTimelapseRenderer.sol:SeasonTimelapseRenderer"));
        DF1Renderer df1 = DF1Renderer(vm.deployCode("DF1Renderer.sol:DF1Renderer"));
        R3OSPainterPass pass = R3OSPainterPass(
            vm.deployCode("R3OSPainterPass.sol:R3OSPainterPass", abi.encode(address(paint)))
        );
        paint.setPainterPass(address(pass));

        uint256 diffId = paint.addRenderer(address(diff), "diff");
        uint256 timelapseId = paint.addRenderer(address(timelapse), "season timelapse");
        uint256 df1Id = paint.addRenderer(address(df1), "df1");

        bytes memory genesis = vm.parseBytes(vm.trim(vm.readFile("script/flipbook-genesis.hex")));
        require(genesis.length == 512, "genesis must be 512 bytes");
        R3OSFlipbook flipbook = R3OSFlipbook(
            vm.deployCode(
                "R3OSFlipbook.sol:R3OSFlipbook",
                abi.encode(address(paint), address(labs), seasonStart, uint256(300), genesis)
            )
        );
        string memory labBaseUri = vm.envOr("LAB_BASE_URI", string(""));
        uint256 flipbookExperimentId =
            paint.addExperiment(address(flipbook), "flipbook", string.concat(labBaseUri, "/flipbook"));
        flipbook.bindExperimentId(flipbookExperimentId);
        pass.addStampSource(address(flipbook));

        R3OSWeeds weeds = R3OSWeeds(
            vm.deployCode("R3OSWeeds.sol:R3OSWeeds", abi.encode(address(paint), seasonStart))
        );
        uint256 weedsExperimentId = paint.addExperiment(address(weeds), "weeds", string.concat(labBaseUri, "/weeds"));
        pass.addStampSource(address(weeds));

        R3OSForks forks = R3OSForks(
            vm.deployCode(
                "R3OSForks.sol:R3OSForks", abi.encode(address(paint), address(labs), seasonStart)
            )
        );
        uint256 forksExperimentId = paint.addExperiment(address(forks), "forks", string.concat(labBaseUri, "/forks"));
        forks.bindExperimentId(forksExperimentId);
        pass.addStampSource(address(forks));

        R3OSBrushes brushes = R3OSBrushes(
            vm.deployCode("R3OSBrushes.sol:R3OSBrushes", abi.encode(address(paint), seasonStart))
        );
        uint256 brushesExperimentId =
            paint.addExperiment(address(brushes), "brushes", string.concat(labBaseUri, "/brushes"));
        pass.addStampSource(address(brushes));

        R3OSFinaleAuction auction = R3OSFinaleAuction(
            vm.deployCode("R3OSFinaleAuction.sol:R3OSFinaleAuction", abi.encode(address(paint)))
        );
        uint256 auctionExperimentId = paint.addExperiment(
            address(auction), "finale auction", string.concat(labBaseUri, "/finale-auction")
        );

        R3OSQuests quests = R3OSQuests(
            vm.deployCode("R3OSQuests.sol:R3OSQuests", abi.encode(address(paint), seasonStart, deployer))
        );
        uint256 questsExperimentId = paint.addExperiment(address(quests), "quests", string.concat(labBaseUri, "/quests"));
        pass.addStampSource(address(quests));

        SleepwalkerKey sleepwalkerKey = SleepwalkerKey(vm.deployCode("SleepwalkerKey.sol:SleepwalkerKey"));
        R3OSSleepwalker sleepwalker = R3OSSleepwalker(
            vm.deployCode(
                "R3OSSleepwalker.sol:R3OSSleepwalker",
                abi.encode(address(paint), address(labs), address(sleepwalkerKey))
            )
        );
        uint256 sleepwalkerExperimentId = paint.addExperiment(
            address(sleepwalker), "sleepwalker", string.concat(labBaseUri, "/sleepwalker")
        );
        sleepwalker.bindExperimentId(sleepwalkerExperimentId);
        pass.addStampSource(address(sleepwalker));

        R3OSRecycleBin recycleBin = R3OSRecycleBin(
            vm.deployCode("R3OSRecycleBin.sol:R3OSRecycleBin", abi.encode(address(paint)))
        );
        uint256 recycleBinExperimentId = paint.addExperiment(
            address(recycleBin), "recycle-bin", string.concat(labBaseUri, "/recycle-bin")
        );
        recycleBin.bindExperimentId(recycleBinExperimentId);
        pass.addStampSource(address(recycleBin));

        R3OSCDBurner cdBurner = R3OSCDBurner(
            vm.deployCode("R3OSCDBurner.sol:R3OSCDBurner", abi.encode(address(paint), address(labs)))
        );
        uint256 cdBurnerExperimentId = paint.addExperiment(
            address(cdBurner), "cd-burner", string.concat(labBaseUri, "/cd-burner")
        );
        cdBurner.bindExperimentId(cdBurnerExperimentId);

        _addDayOneQuests(quests, paint, flipbook, weeds, forks, brushes, auction, recycleBin);

        require(
            paint.owner() == deployer && labs.owner() == deployer && pass.owner() == deployer && quests.owner() == deployer,
            "owner mismatch"
        );
        if (tokenZeroRecipient != deployer) paint.transferFrom(deployer, tokenZeroRecipient, 0);
        if (finalOwner != deployer) {
            paint.transferOwnership(finalOwner);
            labs.transferOwnership(finalOwner);
            pass.transferOwnership(finalOwner);
            quests.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        console.log("chainId", block.chainid);
        console.log("deployer/initial owner", deployer);
        console.log("token #0 recipient", tokenZeroRecipient);
        console.log("royalty receiver", royaltyReceiver);
        console.log("final owner", finalOwner);
        console.log("R3OSPaint", address(paint));
        console.log("R3OSPainterPass", address(pass));
        console.log("R3OSLabs", address(labs));
        console.log("DiffRenderer", address(diff));
        console.log("SeasonTimelapseRenderer", address(timelapse));
        console.log("DF1Renderer", address(df1));
        console.log("R3OSFlipbook", address(flipbook));
        console.log("R3OSWeeds", address(weeds));
        console.log("R3OSForks", address(forks));
        console.log("R3OSBrushes", address(brushes));
        console.log("R3OSFinaleAuction", address(auction));
        console.log("R3OSQuests", address(quests));
        console.log("SleepwalkerKey implementation", address(sleepwalkerKey));
        console.log("R3OSSleepwalker", address(sleepwalker));
        console.log("R3OSRecycleBin", address(recycleBin));
        console.log("R3OSCDBurner", address(cdBurner));
        console.log("flipbook experiment id", flipbookExperimentId);
        console.log("weeds experiment id", weedsExperimentId);
        console.log("forks experiment id", forksExperimentId);
        console.log("brushes experiment id", brushesExperimentId);
        console.log("auction experiment id", auctionExperimentId);
        console.log("quests experiment id", questsExperimentId);
        console.log("sleepwalker experiment id", sleepwalkerExperimentId);
        console.log("recycle-bin experiment id", recycleBinExperimentId);
        console.log("cd-burner experiment id", cdBurnerExperimentId);
        console.log("quest count", quests.questCount());
        console.log("diff renderer id", diffId);
        console.log("timelapse renderer id", timelapseId);
        console.log("df1 renderer id", df1Id);
        console.log("renderers frozen", paint.renderersFrozen());
        console.log("OWNERSHIP CHECKLIST");
        if (finalOwner == deployer) {
            console.log("Paint: deployer remains owner (FINAL_OWNER default)");
            console.log("Labs: deployer remains owner (FINAL_OWNER default)");
            console.log("Pass: deployer remains owner (FINAL_OWNER default)");
            console.log("Quests: deployer remains owner (FINAL_OWNER default)");
        } else {
            console.log("Paint: FINAL_OWNER must call acceptOwnership()", address(paint));
            console.log("Labs: FINAL_OWNER must call acceptOwnership()", address(labs));
            console.log("Pass: FINAL_OWNER must call acceptOwnership()", address(pass));
            console.log("Quests: FINAL_OWNER must call acceptOwnership()", address(quests));
        }
        console.log("Sleepwalker, Recycle Bin and CD Burner are adminless; Sleepwalker clone keys only accept its calls.");
    }

    function _addDayOneQuests(
        R3OSQuests quests,
        R3OSPaint paint,
        R3OSFlipbook flipbook,
        R3OSWeeds weeds,
        R3OSForks forks,
        R3OSBrushes brushes,
        R3OSFinaleAuction auction,
        R3OSRecycleBin recycleBin
    ) private {
        _addOne(quests, "MONTH IN", address(paint), bytes4(keccak256("painterStats(address)")), 0, QUEST_MONTH_IN_ACTIVE_DAYS);
        _addOne(quests, "STORM REGULAR", address(paint), bytes4(keccak256("painterStats(address)")), 9, QUEST_STORM_REGULAR_PAINTS);
        _addOne(quests, "LIVE WIRE", address(paint), bytes4(keccak256("painterStats(address)")), 8, QUEST_LIVE_WIRE_SESSION_PAINTS);
        _addOne(quests, "10K PIXELS", address(paint), bytes4(keccak256("painterStats(address)")), 2, QUEST_TEN_K_PIXELS);
        _addOne(quests, "ARCHIVIST", address(paint), bytes4(keccak256("painterStats(address)")), 3, QUEST_ARCHIVIST_FRAMES);
        _addOne(quests, "ANIMATOR", address(flipbook), bytes4(keccak256("painterInfo(address)")), 4, QUEST_ANIMATOR_FRAMES);
        _addOne(quests, "REEL MAKER", address(flipbook), bytes4(keccak256("balanceOf(address)")), 0, QUEST_REEL_MAKER_BALANCE);
        _addOne(quests, "GREEN THUMB", address(weeds), bytes4(keccak256("gardenerInfo(address)")), 1, QUEST_GREEN_THUMB_PLANTS);
        _addOne(quests, "TIMELINES", address(forks), bytes4(keccak256("painterInfo(address)")), 0, QUEST_TIMELINES_FORKS);
        _addOne(quests, "DNA HUNTER", address(brushes), bytes4(keccak256("box(address)")), 11, QUEST_DNA_HUNTER_VERIFIED);

        R3OSQuests.Condition[] memory labRat = new R3OSQuests.Condition[](4);
        bytes4 stampSelector = bytes4(keccak256("stamp(address)"));
        labRat[0] = R3OSQuests.Condition(address(flipbook), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
        labRat[1] = R3OSQuests.Condition(address(weeds), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
        labRat[2] = R3OSQuests.Condition(address(forks), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
        labRat[3] = R3OSQuests.Condition(address(brushes), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
        quests.addQuest("LAB RAT", 0, 0, labRat);

        _addOne(quests, "PADDLE UP", address(auction), bytes4(keccak256("bidderStats(address)")), 0, QUEST_PADDLE_UP_BIDS);
        _addOne(
            quests,
            "RECYCLER",
            address(recycleBin),
            bytes4(keccak256("burnedBy(address)")),
            0,
            QUEST_RECYCLER_BURNS
        );
    }

    function _addOne(
        R3OSQuests quests,
        string memory name,
        address target,
        bytes4 selector,
        uint8 word,
        uint256 threshold
    ) private {
        R3OSQuests.Condition[] memory conditions = new R3OSQuests.Condition[](1);
        conditions[0] = R3OSQuests.Condition(target, selector, word, 0, threshold);
        quests.addQuest(name, 0, 0, conditions);
    }
}
