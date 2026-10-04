// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSPainterPass} from "../src/R3OSPainterPass.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {DiffRenderer} from "../src/renderers/DiffRenderer.sol";
import {SeasonTimelapseRenderer} from "../src/renderers/SeasonTimelapseRenderer.sol";
import {DF1Renderer} from "../src/renderers/DF1Renderer.sol";
import {R3OSFinaleAuction} from "../src/labs/R3OSFinaleAuction.sol";
import {R3OSQuests} from "../src/labs/R3OSQuests.sol";
import {R3OSRecycleBin} from "../src/labs/R3OSRecycleBin.sol";
import {R3OSCDBurner} from "../src/labs/R3OSCDBurner.sol";

/// @notice Canonical r3OS core deployment.
/// @dev The submission surface intentionally deploys only features that remain reachable in the product.
contract Deploy is Script {
    uint256 private constant QUEST_MONTH_IN_ACTIVE_DAYS = 30;
    uint256 private constant QUEST_STORM_REGULAR_PAINTS = 50;
    uint256 private constant QUEST_LIVE_WIRE_SESSION_PAINTS = 500;
    uint256 private constant QUEST_TEN_K_PIXELS = 10_000;
    uint256 private constant QUEST_ARCHIVIST_FRAMES = 10;
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

        string memory labBaseUri = vm.envOr("LAB_BASE_URI", string(""));

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

        _addDayOneQuests(quests, paint, auction, recycleBin);

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
        console.log("R3OSFinaleAuction", address(auction));
        console.log("R3OSQuests", address(quests));
        console.log("R3OSRecycleBin", address(recycleBin));
        console.log("R3OSCDBurner", address(cdBurner));
        console.log("auction experiment id", auctionExperimentId);
        console.log("quests experiment id", questsExperimentId);
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
        console.log("Finale Auction, Recycle Bin and CD Burner are adminless.");
    }

    function _addDayOneQuests(
        R3OSQuests quests,
        R3OSPaint paint,
        R3OSFinaleAuction auction,
        R3OSRecycleBin recycleBin
    ) private {
        _addOne(quests, "MONTH IN", address(paint), bytes4(keccak256("painterStats(address)")), 0, QUEST_MONTH_IN_ACTIVE_DAYS);
        _addOne(quests, "STORM REGULAR", address(paint), bytes4(keccak256("painterStats(address)")), 9, QUEST_STORM_REGULAR_PAINTS);
        _addOne(quests, "LIVE WIRE", address(paint), bytes4(keccak256("painterStats(address)")), 8, QUEST_LIVE_WIRE_SESSION_PAINTS);
        _addOne(quests, "10K PIXELS", address(paint), bytes4(keccak256("painterStats(address)")), 2, QUEST_TEN_K_PIXELS);
        _addOne(quests, "ARCHIVIST", address(paint), bytes4(keccak256("painterStats(address)")), 3, QUEST_ARCHIVIST_FRAMES);
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
