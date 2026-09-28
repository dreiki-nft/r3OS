// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsPainterPass} from "../src/R3tardsPainterPass.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {DiffRenderer} from "../src/renderers/DiffRenderer.sol";
import {SeasonTimelapseRenderer} from "../src/renderers/SeasonTimelapseRenderer.sol";
import {DF1Renderer} from "../src/renderers/DF1Renderer.sol";
import {R3tardsFlipbook} from "../src/labs/R3tardsFlipbook.sol";
import {R3tardsWeeds} from "../src/labs/R3tardsWeeds.sol";
import {R3tardsForks} from "../src/labs/R3tardsForks.sol";
import {R3tardsBrushes} from "../src/labs/R3tardsBrushes.sol";
import {R3tardsFinaleAuction} from "../src/labs/R3tardsFinaleAuction.sol";
import {R3tardsQuests} from "../src/labs/R3tardsQuests.sol";
import {R3tardsSleepwalker} from "../src/labs/R3tardsSleepwalker.sol";
import {SleepwalkerKey} from "../src/labs/SleepwalkerKey.sol";
import {R3tardsRecycleBin} from "../src/labs/R3tardsRecycleBin.sol";
import {R3tardsCDBurner} from "../src/labs/R3tardsCDBurner.sol";

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
        address tokenZeroRecipient = vm.envAddress("TOKEN_ZERO_RECIPIENT");
        address royaltyReceiver = vm.envAddress("ROYALTY_RECEIVER");
        uint32 basePixelsPerHour = uint32(vm.envUint("BASE_PIXELS_PER_HOUR"));
        uint32 pixelsPerActiveDay = uint32(vm.envUint("PIXELS_PER_ACTIVE_DAY"));
        uint32 maxPixelsPerHour = uint32(vm.envUint("MAX_PIXELS_PER_HOUR"));
        uint32 minPixelsForActiveDay = uint32(vm.envUint("MIN_PIXELS_FOR_ACTIVE_DAY"));
        uint32 holderPixelsPerDay = uint32(vm.envUint("HOLDER_PIXELS_PER_DAY"));

        if (block.chainid == 143 && !vm.envOr("CONFIRM_MAINNET", false)) {
            revert("mainnet blocked: deploy testnet first, then set CONFIRM_MAINNET=true");
        }
        require(deployer == tokenZeroRecipient, "deployer must be initial owner");
        require(deployer == royaltyReceiver, "deployer must be royalty receiver");

        vm.startBroadcast(deployer);

        R3tardsPaint paint = R3tardsPaint(
            vm.deployCode(
                "R3tardsPaint.sol:R3tardsPaint",
                abi.encode(
                    r3tards,
                    seasonStart,
                    tokenZeroRecipient,
                    royaltyReceiver,
                    basePixelsPerHour,
                    pixelsPerActiveDay,
                    maxPixelsPerHour,
                    minPixelsForActiveDay,
                    holderPixelsPerDay
                )
            )
        );
        R3tardsLabs labs = R3tardsLabs(
            vm.deployCode("R3tardsLabs.sol:R3tardsLabs", abi.encode(address(paint), royaltyReceiver))
        );
        DiffRenderer diff = DiffRenderer(vm.deployCode("DiffRenderer.sol:DiffRenderer"));
        SeasonTimelapseRenderer timelapse =
            SeasonTimelapseRenderer(vm.deployCode("SeasonTimelapseRenderer.sol:SeasonTimelapseRenderer"));
        DF1Renderer df1 = DF1Renderer(vm.deployCode("DF1Renderer.sol:DF1Renderer"));
        R3tardsPainterPass pass = R3tardsPainterPass(
            vm.deployCode("R3tardsPainterPass.sol:R3tardsPainterPass", abi.encode(address(paint)))
        );

        paint.setPainterPass(address(pass));
        uint256 diffId = paint.addRenderer(address(diff), "diff");
        uint256 timelapseId = paint.addRenderer(address(timelapse), "season timelapse");
        uint256 df1Id = paint.addRenderer(address(df1), "df1");

        bytes memory genesis = vm.parseBytes(vm.trim(vm.readFile("script/flipbook-genesis.hex")));
        require(genesis.length == 512, "genesis must be 512 bytes");
        R3tardsFlipbook flipbook = R3tardsFlipbook(
            vm.deployCode(
                "R3tardsFlipbook.sol:R3tardsFlipbook",
                abi.encode(address(paint), address(labs), seasonStart, uint256(300), genesis)
            )
        );
        string memory labBaseUri = vm.envOr("LAB_BASE_URI", string(""));
        uint256 flipbookExperimentId =
            paint.addExperiment(address(flipbook), "flipbook", string.concat(labBaseUri, "/flipbook"));
        flipbook.bindExperimentId(flipbookExperimentId);
        pass.addStampSource(address(flipbook));

        R3tardsWeeds weeds = R3tardsWeeds(
            vm.deployCode("R3tardsWeeds.sol:R3tardsWeeds", abi.encode(address(paint), seasonStart))
        );
        uint256 weedsExperimentId = paint.addExperiment(address(weeds), "weeds", string.concat(labBaseUri, "/weeds"));
        pass.addStampSource(address(weeds));

        R3tardsForks forks = R3tardsForks(
            vm.deployCode(
                "R3tardsForks.sol:R3tardsForks", abi.encode(address(paint), address(labs), seasonStart)
            )
        );
        uint256 forksExperimentId = paint.addExperiment(address(forks), "forks", string.concat(labBaseUri, "/forks"));
        forks.bindExperimentId(forksExperimentId);
        pass.addStampSource(address(forks));

        R3tardsBrushes brushes = R3tardsBrushes(
            vm.deployCode("R3tardsBrushes.sol:R3tardsBrushes", abi.encode(address(paint), seasonStart))
        );
        uint256 brushesExperimentId =
            paint.addExperiment(address(brushes), "brushes", string.concat(labBaseUri, "/brushes"));
        pass.addStampSource(address(brushes));

        R3tardsFinaleAuction auction = R3tardsFinaleAuction(
            vm.deployCode("R3tardsFinaleAuction.sol:R3tardsFinaleAuction", abi.encode(address(paint)))
        );
        uint256 auctionExperimentId = paint.addExperiment(
            address(auction), "finale auction", string.concat(labBaseUri, "/finale-auction")
        );

        R3tardsQuests quests = R3tardsQuests(
            vm.deployCode("R3tardsQuests.sol:R3tardsQuests", abi.encode(address(paint), seasonStart, deployer))
        );
        uint256 questsExperimentId = paint.addExperiment(address(quests), "quests", string.concat(labBaseUri, "/quests"));
        pass.addStampSource(address(quests));

        SleepwalkerKey sleepwalkerKey = SleepwalkerKey(vm.deployCode("SleepwalkerKey.sol:SleepwalkerKey"));
        R3tardsSleepwalker sleepwalker = R3tardsSleepwalker(
            vm.deployCode(
                "R3tardsSleepwalker.sol:R3tardsSleepwalker",
                abi.encode(address(paint), address(labs), address(sleepwalkerKey))
            )
        );
        uint256 sleepwalkerExperimentId = paint.addExperiment(
            address(sleepwalker), "sleepwalker", string.concat(labBaseUri, "/sleepwalker")
        );
        sleepwalker.bindExperimentId(sleepwalkerExperimentId);
        pass.addStampSource(address(sleepwalker));

        R3tardsRecycleBin recycleBin = R3tardsRecycleBin(
            vm.deployCode("R3tardsRecycleBin.sol:R3tardsRecycleBin", abi.encode(address(paint)))
        );
        uint256 recycleBinExperimentId = paint.addExperiment(
            address(recycleBin), "recycle-bin", string.concat(labBaseUri, "/recycle-bin")
        );
        recycleBin.bindExperimentId(recycleBinExperimentId);
        pass.addStampSource(address(recycleBin));

        R3tardsCDBurner cdBurner = R3tardsCDBurner(
            vm.deployCode("R3tardsCDBurner.sol:R3tardsCDBurner", abi.encode(address(paint), address(labs)))
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
        vm.stopBroadcast();

        console.log("chainId", block.chainid);
        console.log("deployer/initial owner", deployer);
        console.log("R3tardsPaint", address(paint));
        console.log("R3tardsPainterPass", address(pass));
        console.log("R3tardsLabs", address(labs));
        console.log("DiffRenderer", address(diff));
        console.log("SeasonTimelapseRenderer", address(timelapse));
        console.log("DF1Renderer", address(df1));
        console.log("R3tardsFlipbook", address(flipbook));
        console.log("R3tardsWeeds", address(weeds));
        console.log("R3tardsForks", address(forks));
        console.log("R3tardsBrushes", address(brushes));
        console.log("R3tardsFinaleAuction", address(auction));
        console.log("R3tardsQuests", address(quests));
        console.log("SleepwalkerKey implementation", address(sleepwalkerKey));
        console.log("R3tardsSleepwalker", address(sleepwalker));
        console.log("R3tardsRecycleBin", address(recycleBin));
        console.log("R3tardsCDBurner", address(cdBurner));
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
        console.log("REMINDER: Paint, Labs, Pass and Quests ownership can later move via Ownable2Step.");
        console.log("Sleepwalker, Recycle Bin and CD Burner are adminless; Sleepwalker clone keys only accept its calls.");
    }

    function _addDayOneQuests(
        R3tardsQuests quests,
        R3tardsPaint paint,
        R3tardsFlipbook flipbook,
        R3tardsWeeds weeds,
        R3tardsForks forks,
        R3tardsBrushes brushes,
        R3tardsFinaleAuction auction,
        R3tardsRecycleBin recycleBin
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

        R3tardsQuests.Condition[] memory labRat = new R3tardsQuests.Condition[](4);
        bytes4 stampSelector = bytes4(keccak256("stamp(address)"));
        labRat[0] = R3tardsQuests.Condition(address(flipbook), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
        labRat[1] = R3tardsQuests.Condition(address(weeds), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
        labRat[2] = R3tardsQuests.Condition(address(forks), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
        labRat[3] = R3tardsQuests.Condition(address(brushes), stampSelector, 1, 0, QUEST_LAB_RAT_STAMP);
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
        R3tardsQuests quests,
        string memory name,
        address target,
        bytes4 selector,
        uint8 word,
        uint256 threshold
    ) private {
        R3tardsQuests.Condition[] memory conditions = new R3tardsQuests.Condition[](1);
        conditions[0] = R3tardsQuests.Condition(target, selector, word, 0, threshold);
        quests.addQuest(name, 0, 0, conditions);
    }
}
