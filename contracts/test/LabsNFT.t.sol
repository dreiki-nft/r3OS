// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSLabs} from "../src/R3OSLabs.sol";
import {ILabTokenSource} from "../src/interfaces/ILabTokenSource.sol";
import {LabTraits} from "../src/lib/LabTraits.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract MockLabTokenSource is ILabTokenSource {
    R3OSLabs public immutable LABS;
    uint256 public experimentId;
    uint8 public mode;
    bool public burnable;

    constructor(R3OSLabs labs) {
        LABS = labs;
    }

    function configure(uint256 id, uint8 nextMode, bool nextBurnable) external {
        experimentId = id;
        mode = nextMode;
        burnable = nextBurnable;
    }

    function mintTo(address to) external returns (uint256) {
        return LABS.mint(to, experimentId);
    }

    function labToken(uint256) external view returns (
        string memory kind,
        string memory description,
        bytes memory imageSvg,
        string memory attributes,
        uint8 dominantColour,
        uint8 coloursUsed
    ) {
        if (mode == 1) revert("broken lab");
        if (mode == 2) {
            uint256 n;
            while (gasleft() > 1_000) {
                unchecked { ++n; }
            }
            if (n != 0) revert("spent gas");
        }
        return (
            "Dream",
            "a mock dream",
            bytes("<svg/>"),
            ',{"trait_type":"Pixels dreamt","display_type":"number","value":321}',
            11,
            3
        );
    }

    function canBurn(uint256) external view returns (bool) {
        return burnable;
    }
}

contract LabTraitsHarness {
    function palette(uint256 n) external pure returns (string memory) { return LabTraits.palette(n); }
    function reelLength(uint256 n) external pure returns (string memory) { return LabTraits.reelLength(n); }
    function tempo(uint256 n) external pure returns (string memory) { return LabTraits.tempo(n); }
    function validatorMix(uint256 n) external pure returns (string memory) { return LabTraits.validatorMix(n); }
    function crowd(uint256 n) external pure returns (string memory) { return LabTraits.crowd(n); }
    function activity(uint256 n) external pure returns (string memory) { return LabTraits.activity(n); }
    function lineage(uint256 n) external pure returns (string memory) { return LabTraits.lineage(n); }
}

contract LabsNFTTest is Test {
    R3OSPaint paint;
    R3OSLabs labs;
    MockR3tards r3tards;
    MockLabTokenSource sourceA;
    MockLabTokenSource sourceB;
    LabTraitsHarness traits;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address royalty = address(0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA);
    uint256 experimentA;
    uint256 experimentB;

    function setUp() public {
        vm.roll(1_000);
        r3tards = new MockR3tards();
        paint = new R3OSPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), address(this), royalty, 512, 0, 512, 16, 256
        );
        labs = new R3OSLabs(address(paint), royalty);
        sourceA = new MockLabTokenSource(labs);
        sourceB = new MockLabTokenSource(labs);
        experimentA = paint.addExperiment(address(sourceA), "sleepwalker", "");
        experimentB = paint.addExperiment(address(sourceB), "sleepwalker", "");
        sourceA.configure(experimentA, 0, false);
        sourceB.configure(experimentB, 0, false);
        traits = new LabTraitsHarness();
    }

    function testCollectionIdentityRoyaltyAndOwnerScope() public {
        assertEq(labs.name(), "r3OS labs");
        assertEq(labs.symbol(), "R3OSLABS");
        assertEq(labs.owner(), address(this));
        assertEq(labs.ROYALTY_RECEIVER(), royalty);
        assertTrue(labs.supportsInterface(0x49064906));

        uint256 id = sourceA.mintTo(alice);
        (address receiver, uint256 amount) = labs.royaltyInfo(id, 10_000);
        assertEq(receiver, royalty);
        assertEq(amount, 500);

        vm.prank(alice);
        vm.expectRevert();
        labs.setExternalLink("https://wrong.example");
        labs.setExternalLink("https://r3tards.example");
        assertEq(labs.externalLink(), "https://r3tards.example");

        vm.expectRevert();
        labs.mint(alice, experimentA);
        vm.expectRevert();
        labs.transferFrom(alice, bob, id);
        vm.expectRevert();
        labs.burn(id);
        (bool changedRoyalty,) = address(labs).call(
            abi.encodeWithSignature("setDefaultRoyalty(address,uint96)", bob, uint96(1_000))
        );
        assertFalse(changedRoyalty);
        assertEq(labs.ownerOf(id), alice);
    }

    function testOnlyRegisteredActiveExperimentMintsAndIdsAreGlobal() public {
        uint256 first = sourceA.mintTo(alice);
        uint256 second = sourceB.mintTo(bob);
        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(labs.totalMinted(), 2);
        assertEq(labs.sourceOf(first), address(sourceA));
        assertEq(labs.sourceOf(second), address(sourceB));
        assertEq(labs.balanceOfExperiment(experimentA, alice), 1);
        vm.prank(alice);
        labs.transferFrom(alice, bob, first);
        assertEq(labs.balanceOfExperiment(experimentA, alice), 0);
        assertEq(labs.balanceOfExperiment(experimentA, bob), 1);

        MockLabTokenSource unregistered = new MockLabTokenSource(labs);
        unregistered.configure(experimentA, 0, false);
        vm.expectRevert();
        unregistered.mintTo(alice);

        paint.retireExperiment(experimentA);
        vm.expectRevert(abi.encodeWithSelector(R3OSLabs.RetiredExperiment.selector, experimentA));
        sourceA.mintTo(alice);

        bytes memory json = _json(labs.tokenURI(first));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".attributes[0].value"), "Dream");
    }

    function testBurnRequiresOwnerAndSourcePermission() public {
        sourceA.configure(experimentA, 0, true);
        uint256 id = sourceA.mintTo(alice);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(R3OSLabs.NotTokenOwner.selector, id));
        labs.burn(id);

        vm.prank(alice);
        labs.burn(id);
        vm.expectRevert();
        labs.ownerOf(id);
    }

    function testTokenAndContractJsonCommonTraitsAndExternalUrl() public {
        r3tards.mint(alice, 1);
        vm.coinbase(address(0xC01B453));
        uint256 mintBlock = vm.getBlockNumber();
        uint256 id = sourceA.mintTo(alice);
        R3OSLabs.MintData memory mintData = labs.mintData(id);
        assertEq(mintData.lab, address(sourceA));
        assertEq(mintData.experimentId, experimentA);
        assertEq(mintData.blockNumber, mintBlock);
        assertEq(mintData.proposer, address(0xC01B453));
        assertEq(mintData.season, 0);
        assertEq(mintData.storm, paint.isStorm(mintBlock));
        assertTrue(mintData.holderAtMint);

        labs.setExternalLink("https://r3tards.example/");

        bytes memory json = _json(labs.tokenURI(id));
        vm.parseJson(string(json));
        assertEq(vm.parseJsonString(string(json), ".name"), "r3OS labs dream #1");
        assertEq(vm.parseJsonString(string(json), ".external_url"), "https://r3tards.example/#/labs?token=1");
        assertEq(vm.parseJsonString(string(json), ".attributes[0].value"), "Dream");
        assertEq(vm.parseJsonString(string(json), ".attributes[1].value"), "Sleepwalker");
        assertEq(vm.parseJsonUint(string(json), ".attributes[2].value"), 1);
        assertEq(vm.parseJsonString(string(json), ".attributes[5].value"), "yes");
        assertEq(vm.parseJsonString(string(json), ".attributes[7].value"), "DF1 cyan");
        assertEq(vm.parseJsonString(string(json), ".attributes[9].value"), "Few");
        assertEq(vm.parseJsonUint(string(json), ".attributes[10].value"), 321);

        bytes memory collection = _json(labs.contractURI());
        vm.parseJson(string(collection));
        assertEq(vm.parseJsonString(string(collection), ".name"), "r3OS labs");
        assertEq(vm.parseJsonUint(string(collection), ".seller_fee_basis_points"), 500);
        assertEq(vm.parseJsonString(string(collection), ".external_link"), "https://r3tards.example/");
        assertEq(
            vm.parseJsonString(string(collection), ".fee_recipient"),
            "0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA"
        );
    }

    function test_FailingAndGasHungryLabsStillReturnValidJson() public {
        uint256 revertId = sourceA.mintTo(alice);
        sourceA.configure(experimentA, 1, false);
        bytes memory revertJson = _json(labs.tokenURI(revertId));
        vm.parseJson(string(revertJson));
        assertEq(vm.parseJsonString(string(revertJson), ".attributes[0].value"), "Dream");
        assertEq(vm.parseJsonString(string(revertJson), ".attributes[9].value"), "Mono");

        sourceB.configure(experimentB, 0, false);
        uint256 gasId = sourceB.mintTo(bob);
        sourceB.configure(experimentB, 2, false);
        bytes memory gasJson = _json(labs.tokenURI(gasId));
        vm.parseJson(string(gasJson));
        assertEq(vm.parseJsonString(string(gasJson), ".attributes[0].value"), "Dream");
    }

    function testBucketEdges() public view {
        assertEq(traits.reelLength(11), "Short");
        assertEq(traits.reelLength(12), "Medium");
        assertEq(traits.reelLength(19), "Medium");
        assertEq(traits.reelLength(20), "Long");
        assertEq(traits.reelLength(27), "Long");
        assertEq(traits.reelLength(28), "Epic");

        assertEq(traits.tempo(400), "Real-time");
        assertEq(traits.tempo(401), "Smooth");
        assertEq(traits.tempo(1_000), "Smooth");
        assertEq(traits.tempo(1_001), "Steady");
        assertEq(traits.tempo(5_000), "Steady");
        assertEq(traits.tempo(5_001), "Slow");

        assertEq(traits.validatorMix(1), "Single");
        assertEq(traits.validatorMix(2), "Few");
        assertEq(traits.validatorMix(4), "Few");
        assertEq(traits.validatorMix(5), "Many");

        assertEq(traits.crowd(1), "Solo");
        assertEq(traits.crowd(2), "Duo");
        assertEq(traits.crowd(9), "Group");
        assertEq(traits.crowd(10), "Crowd");
        assertEq(traits.activity(0), "Untouched");
        assertEq(traits.activity(1), "Light");
        assertEq(traits.activity(9), "Light");
        assertEq(traits.activity(10), "Worked");
        assertEq(traits.activity(99), "Worked");
        assertEq(traits.activity(100), "Busy");

        assertEq(traits.palette(2), "Mono");
        assertEq(traits.palette(3), "Few");
        assertEq(traits.palette(5), "Few");
        assertEq(traits.palette(6), "Rich");
        assertEq(traits.palette(10), "Rich");
        assertEq(traits.palette(11), "Full");
        assertEq(traits.lineage(1), "Original");
        assertEq(traits.lineage(2), "Remix");
        assertEq(traits.lineage(3), "Deep remix");
    }

    function testGasLabsMint() public {
        uint256 before = gasleft();
        sourceA.mintTo(alice);
        uint256 used = before - gasleft();
        console.log("GAS Labs mint", used);
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
