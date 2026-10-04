// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSPainterPass} from "../src/R3OSPainterPass.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {R3OSQuests} from "../src/labs/R3OSQuests.sol";
import {R3OSRecycleBin} from "../src/labs/R3OSRecycleBin.sol";
import {R3OSCDBurner} from "../src/labs/R3OSCDBurner.sol";

/// @notice Transaction-sized deployment regression under the Monad Foundry profile.
/// @dev Covers the canonical hackathon/mainnet deployment surface only.
contract DeployGasTest is Test {
    uint256 private constant MAX_TX_GAS = 25_000_000;

    function testDeployAndWireEveryTransactionBelowTwentyFiveMillion() public {
        address royalty = makeAddr("royalty");
        address r3tards = makeAddr("r3tards");
        uint64 seasonStart = uint64(vm.getBlockTimestamp());

        (address paintAddress,) = _deploy(
            "R3OSPaint.sol:R3OSPaint",
            abi.encode(r3tards, seasonStart, address(this), royalty, uint32(32), uint32(16), uint32(256), uint32(16), uint32(256)),
            "R3OSPaint"
        );
        R3OSPaint paint = R3OSPaint(paintAddress);
        (address labsAddress,) = _deploy(
            "R3OSLabs.sol:R3OSLabs", abi.encode(paintAddress, royalty), "R3OSLabs"
        );
        R3OSLabs labs = R3OSLabs(labsAddress);
        (address diffAddress,) = _deploy("DiffRenderer.sol:DiffRenderer", bytes(""), "DiffRenderer");
        (address timelapseAddress,) = _deploy("SeasonTimelapseRenderer.sol:SeasonTimelapseRenderer", bytes(""), "SeasonTimelapseRenderer");
        (address df1Address,) = _deploy("DF1Renderer.sol:DF1Renderer", bytes(""), "DF1Renderer");
        (address passAddress,) = _deploy("R3OSPainterPass.sol:R3OSPainterPass", abi.encode(paintAddress), "R3OSPainterPass");
        R3OSPainterPass pass = R3OSPainterPass(passAddress);

        (address auctionAddress,) = _deploy("R3OSFinaleAuction.sol:R3OSFinaleAuction", abi.encode(paintAddress), "R3OSFinaleAuction");
        (address questsAddress,) = _deploy("R3OSQuests.sol:R3OSQuests", abi.encode(paintAddress, seasonStart, address(this)), "R3OSQuests");
        R3OSQuests quests = R3OSQuests(questsAddress);
        (address recycleBinAddress,) = _deploy(
            "R3OSRecycleBin.sol:R3OSRecycleBin", abi.encode(paintAddress), "R3OSRecycleBin"
        );
        (address cdBurnerAddress,) = _deploy(
            "R3OSCDBurner.sol:R3OSCDBurner", abi.encode(paintAddress, labsAddress), "R3OSCDBurner"
        );

        _call(paintAddress, abi.encodeCall(paint.setPainterPass, (passAddress)), "wire Painter Pass");
        _call(paintAddress, abi.encodeCall(paint.addRenderer, (diffAddress, "diff")), "wire renderer diff");
        _call(paintAddress, abi.encodeCall(paint.addRenderer, (timelapseAddress, "season timelapse")), "wire renderer timelapse");
        _call(paintAddress, abi.encodeCall(paint.addRenderer, (df1Address, "df1")), "wire renderer df1");

        _wireLab(paint, pass, auctionAddress, "finale auction", false);
        _wireLab(paint, pass, questsAddress, "quests", true);
        uint256 recycleBinExperimentId = _wireLab(paint, pass, recycleBinAddress, "recycle-bin", true);
        _call(
            recycleBinAddress,
            abi.encodeCall(R3OSRecycleBin.bindExperimentId, (recycleBinExperimentId)),
            "wire recycle-bin experiment id"
        );
        uint256 cdBurnerExperimentId = _wireLab(paint, pass, cdBurnerAddress, "cd-burner", false);
        _call(
            cdBurnerAddress,
            abi.encodeCall(R3OSCDBurner.bindExperimentId, (cdBurnerExperimentId)),
            "wire cd-burner experiment id"
        );

        _addOne(quests, "MONTH IN", paintAddress, bytes4(keccak256("painterStats(address)")), 0, 30);
        _addOne(quests, "STORM REGULAR", paintAddress, bytes4(keccak256("painterStats(address)")), 9, 50);
        _addOne(quests, "LIVE WIRE", paintAddress, bytes4(keccak256("painterStats(address)")), 8, 500);
        _addOne(quests, "10K PIXELS", paintAddress, bytes4(keccak256("painterStats(address)")), 2, 10_000);
        _addOne(quests, "ARCHIVIST", paintAddress, bytes4(keccak256("painterStats(address)")), 3, 10);
        _addOne(quests, "PADDLE UP", auctionAddress, bytes4(keccak256("bidderStats(address)")), 0, 1);
        _addOne(quests, "RECYCLER", recycleBinAddress, bytes4(keccak256("burnedBy(address)")), 0, 100);

        assertEq(paint.owner(), address(this));
        assertEq(labs.owner(), address(this));
        assertEq(pass.owner(), address(this));
        assertEq(quests.owner(), address(this));
        assertEq(paint.experimentCount(), 4);
        assertEq(quests.questCount(), 7);
        assertEq(pass.stampSourceCount(), 2);
        assertEq(pass.stampSource(0), questsAddress);
        assertEq(pass.stampSource(1), recycleBinAddress);
        assertTrue(auctionAddress.code.length != 0);
        assertTrue(questsAddress.code.length != 0);
        assertTrue(recycleBinAddress.code.length != 0);
        assertTrue(cdBurnerAddress.code.length != 0);
    }

    function _wireLab(
        R3OSPaint paint,
        R3OSPainterPass pass,
        address lab,
        string memory name,
        bool stampSource
    ) private returns (uint256 experimentId) {
        uint256 beforeCount = paint.experimentCount();
        _call(
            address(paint),
            abi.encodeCall(paint.addExperiment, (lab, name, string.concat("/", name))),
            string.concat("wire experiment ", name)
        );
        experimentId = beforeCount;
        if (stampSource) {
            _call(address(pass), abi.encodeCall(pass.addStampSource, (lab)), string.concat("wire stamp ", name));
        }
    }

    function _addOne(R3OSQuests quests, string memory name, address target, bytes4 selector, uint8 word, uint256 threshold) private {
        R3OSQuests.Condition[] memory conditions = new R3OSQuests.Condition[](1);
        conditions[0] = R3OSQuests.Condition(target, selector, word, 0, threshold);
        _call(address(quests), abi.encodeCall(quests.addQuest, (name, uint48(0), uint48(0), conditions)), string.concat("quest ", name));
    }

    function _deploy(string memory artifact, bytes memory args, string memory label)
        private
        returns (address deployed, uint256 transactionGas)
    {
        bytes memory init = abi.encodePacked(vm.getCode(artifact), args);
        uint256 beforeGas = gasleft();
        assembly ("memory-safe") { deployed := create(0, add(init, 0x20), mload(init)) }
        uint256 executionGas = beforeGas - gasleft();
        require(deployed != address(0), "deploy failed");
        transactionGas = executionGas + _intrinsic(init);
        console.log(string.concat("GAS deploy ", label), transactionGas);
        assertLt(transactionGas, MAX_TX_GAS);
    }

    function _call(address target, bytes memory data, string memory label) private returns (uint256 transactionGas) {
        uint256 beforeGas = gasleft();
        (bool ok,) = target.call(data);
        uint256 executionGas = beforeGas - gasleft();
        require(ok, "wire failed");
        transactionGas = executionGas + _intrinsic(data);
        console.log(string.concat("GAS ", label), transactionGas);
        assertLt(transactionGas, MAX_TX_GAS);
    }

    function _intrinsic(bytes memory data) private pure returns (uint256 gasCost) {
        gasCost = 21_000;
        for (uint256 i; i < data.length; ++i) gasCost += data[i] == 0 ? 4 : 16;
    }
}
