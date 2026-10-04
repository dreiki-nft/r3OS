// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {DiffRenderer} from "../src/renderers/DiffRenderer.sol";
import {SeasonTimelapseRenderer} from "../src/renderers/SeasonTimelapseRenderer.sol";
import {IFrameRenderer} from "../src/interfaces/IFrameRenderer.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract RevertingRenderer is IFrameRenderer {
    function tokenURI(address, uint256) external pure returns (string memory) { revert("nope"); }
}

contract GasBombRenderer is IFrameRenderer {
    function tokenURI(address, uint256) external view returns (string memory) {
        assembly ("memory-safe") { for { } 1 { } { pop(gas()) } }
        return "";
    }
}

contract RenderersLabOwnershipTest is Test {
    R3OSPaint paint;
    MockR3tards r;
    address owner = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        paint = new R3OSPaint(address(r), uint64(vm.getBlockTimestamp()), owner, owner, 512, 0, 512, 16, 256);
    }

    function testOwnable2Step() public {
        vm.prank(owner);
        paint.transferOwnership(bob);
        assertEq(paint.owner(), owner);
        assertEq(paint.pendingOwner(), bob);
        vm.prank(bob);
        paint.acceptOwnership();
        assertEq(paint.owner(), bob);
    }

    function testHolderOptInResetFreezeAndFallback() public {
        RevertingRenderer bad = new RevertingRenderer();
        vm.prank(owner);
        uint256 id = paint.addRenderer(address(bad), "bad");
        vm.prank(owner);
        paint.transferFrom(owner, bob, 0);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(R3OSPaint.NotTokenHolder.selector, 0));
        paint.setTokenRenderer(0, id);
        vm.prank(bob);
        paint.setTokenRenderer(0, id);
        string memory fallbackUri = paint.tokenURI(0);
        string memory builtinUri = paint.builtinTokenURI(0);
        assertEq(keccak256(bytes(fallbackUri)), keccak256(bytes(builtinUri)));
        GasBombRenderer bomb = new GasBombRenderer();
        vm.prank(owner);
        uint256 bombId = paint.addRenderer(address(bomb), "bomb");
        vm.prank(bob);
        paint.setTokenRenderer(0, bombId);
        string memory gasFallback = paint.tokenURI(0);
        assertEq(keccak256(bytes(gasFallback)), keccak256(bytes(builtinUri)));
        vm.prank(bob);
        paint.setTokenRenderer(0, 0);

        vm.prank(owner);
        paint.freezeRenderers();
        vm.prank(owner);
        vm.expectRevert(R3OSPaint.RendererFrozen.selector);
        paint.addRenderer(address(bad), "again");
    }

    function testDiffAndTimelapseUseSeasonFrames() public {
        DiffRenderer diff = new DiffRenderer();
        SeasonTimelapseRenderer time = new SeasonTimelapseRenderer();
        vm.startPrank(owner);
        uint256 diffId = paint.addRenderer(address(diff), "diff");
        uint256 timeId = paint.addRenderer(address(time), "season timelapse");

        for (uint8 i; i < 6; ++i) {
            bytes memory runs = abi.encodePacked(uint8(i), uint8(0), uint8(3), uint8(4 + (i % 3)));
            paint.paint(runs, new uint256[](0));
            uint256 frameId = paint.mintFrame();
            if (i == 0) {
                uint256 diffBefore = gasleft();
                string memory directDiff = diff.tokenURI(address(paint), frameId);
                uint256 diffGas = diffBefore - gasleft();
                console.log("GAS diff renderer", diffGas);
                assertLt(diffGas, 11_000_000);
                paint.setTokenRenderer(frameId, diffId);
                assertEq(keccak256(bytes(paint.tokenURI(frameId))), keccak256(bytes(directDiff)));
            }
            vm.roll(vm.getBlockNumber() + paint.FRAME_COOLDOWN_BLOCKS() + 1);
        }
        vm.stopPrank();

        vm.warp(paint.seasonEndTime(0) + 1);
        vm.prank(paint.ownerOf(0));
        uint256 finale = paint.mintSeasonFinale(0);

        uint256 before = gasleft();
        string memory directUri = time.tokenURI(address(paint), finale);
        uint256 rendererGas = before - gasleft();
        console.log("GAS timelapse renderer", rendererGas);
        console.log("BYTES timelapse tokenURI", bytes(directUri).length);
        assertLt(rendererGas, 13_000_000);
        assertLt(bytes(directUri).length, 200_000);

        vm.prank(owner);
        paint.setTokenRenderer(finale, timeId);
        (bool ok, bytes memory raw) = address(paint).staticcall{gas: 30_000_000}(
            abi.encodeWithSelector(R3OSPaint.tokenURI.selector, finale)
        );
        assertTrue(ok, "tokenURI exceeded 30M or reverted");
        string memory routed = abi.decode(raw, (string));
        assertEq(keccak256(bytes(routed)), keccak256(bytes(directUri)), "timelapse fell back to renderer 0");
    }

    function testLabRegistryGrantsNothing() public {
        vm.prank(owner);
        uint256 id = paint.addExperiment(bob, "weird lab", "ipfs://example");
        R3OSPaint.ExperimentData memory data = paint.experimentInfo(id);
        assertEq(data.experiment, bob);
        vm.prank(bob);
        vm.expectRevert();
        paint.setSeasonOutline(1, hex"", "bob");
        vm.prank(owner);
        paint.retireExperiment(id);
        assertTrue(paint.experimentInfo(id).retired);
    }
}
