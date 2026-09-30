// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {R3tardsLabs} from "../src/R3tardsLabs.sol";
import {R3tardsPageExe} from "../src/monadhw/R3tardsPageExe.sol";
import {R3tardsBlockCamera} from "../src/monadhw/R3tardsBlockCamera.sol";
import {R3tardsKernelDebugger} from "../src/monadhw/R3tardsKernelDebugger.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract ReserveBalanceMock {
    function dippedIntoReserve() external returns (bool) {
        return tx.origin.balance < 1 ether;
    }
}

contract RejectRefund {
    R3tardsKernelDebugger immutable KERNEL;

    constructor(R3tardsKernelDebugger kernel) {
        KERNEL = kernel;
    }

    function run() external payable {
        KERNEL.run{value: msg.value}(true, false);
    }

    receive() external payable {
        revert("no refund");
    }
}

contract ReenterWithdraw {
    R3tardsKernelDebugger immutable KERNEL;
    bool public attempted;

    constructor(R3tardsKernelDebugger kernel) {
        KERNEL = kernel;
    }

    function deposit() external payable {
        KERNEL.run{value: msg.value}(false, false);
    }

    function withdraw() external {
        KERNEL.withdraw();
    }

    receive() external payable {
        attempted = true;
        // The nested call must fail under nonReentrant, but the outer withdrawal can complete.
        (bool ok,) = address(KERNEL).call(abi.encodeWithSelector(KERNEL.withdraw.selector));
        ok;
    }
}

contract MonadHWTest is Test {
    address constant STAKING = 0x0000000000000000000000000000000000001000;
    address constant RESERVE = 0x0000000000000000000000000000000000001001;

    R3tardsPageExe page;
    R3tardsBlockCamera camera;
    R3tardsKernelDebugger kernel;
    R3tardsPaint paint;
    R3tardsLabs labs;
    MockR3tards r3tards;

    address alice;
    address bob;
    address royalty;

    function setUp() public {
        vm.roll(10_000);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        royalty = makeAddr("royalty");
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        r3tards = new MockR3tards();
        paint = new R3tardsPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), alice, royalty, 512, 0, 512, 16, 256
        );
        labs = new R3tardsLabs(address(paint), royalty);
        page = new R3tardsPageExe();
        camera = new R3tardsBlockCamera(address(paint), address(labs), address(0));
        kernel = new R3tardsKernelDebugger();

        vm.prank(alice);
        uint256 cameraId = paint.addExperiment(address(camera), "block-camera", "");
        camera.bindExperimentId(cameraId);
    }

    // ---------------------------------------------------------------------
    // PAGE.EXE
    // ---------------------------------------------------------------------

    function testProbePageMeasuresColdWarmAndNextPage() public view {
        (uint256 cold, uint256 warm, uint256 nextPageCold,) = page.probePage();
        // MIP-8: first touch of a page is cold (~8,100), the neighbour slot is warm (~100),
        // and the first slot of the next page is cold again.
        assertGt(cold, 2_000);
        assertLt(warm, 1_000);
        assertGt(nextPageCold, 2_000);
        assertGt(cold, warm * 10);
    }

    function testPageAlignmentAndWalletPageMath() public view {
        uint256 a = page.pageBaseSlot(alice);
        uint256 b = page.pageBaseSlot(bob);
        assertEq(a & 127, 0);
        assertEq(b & 127, 0);
        assertEq(page.pageIndexOf(alice), a >> 7);
        assertEq(page.pageIndexOf(bob), b >> 7);
        assertTrue(a != b);
    }

    function testMIP8ContiguousReadsAreAtLeastTenTimesCheaperThanScatteredAt128() public view {
        (uint256 contiguous,) = page.benchRead(0, 128);
        (uint256 scattered,) = page.benchRead(1, 128);
        assertLt(contiguous * 10, scattered);
    }

    function testBenchWriteAlwaysRevertsAndLeavesStorageUnchanged() public {
        bytes32 slot = bytes32(page.BENCH_BASE());
        bytes32 beforeValue = vm.load(address(page), slot);
        vm.expectPartialRevert(R3tardsPageExe.BenchWriteResult.selector);
        page.benchWrite(0, 32);
        assertEq(vm.load(address(page), slot), beforeValue);
    }

    function testBenchWriteMeasuresRealStores() public {
        // 32 fresh zero->nonzero SSTOREs cannot cost less than 2,000 gas each on any EVM pricing.
        try page.benchWrite(0, 32) {
            fail();
        } catch (bytes memory data) {
            assertEq(bytes4(data), R3tardsPageExe.BenchWriteResult.selector);
            bytes memory args = new bytes(data.length - 4);
            for (uint256 i; i < args.length; ++i) args[i] = data[i + 4];
            (uint256 used,) = abi.decode(args, (uint256, uint256));
            assertGt(used, 32 * 2_000);
        }
    }

    function testWritePageBoundsOwnershipAndPayload() public {
        bytes32[] memory words = new bytes32[](2);
        words[0] = bytes32(uint256(0xAABB));
        words[1] = bytes32(uint256(0xCCDD));

        vm.expectEmit(true, false, false, true, address(page));
        emit R3tardsPageExe.PageWritten(alice, 7, words);
        vm.prank(alice);
        page.writePage(7, words);

        bytes32[128] memory alicePage = page.readPage(alice);
        bytes32[128] memory bobPage = page.readPage(bob);
        assertEq(alicePage[7], words[0]);
        assertEq(alicePage[8], words[1]);
        assertEq(bobPage[7], bytes32(0));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPageExe.PageWriteOutOfBounds.selector, 127, 2));
        page.writePage(127, words);
    }

    // ---------------------------------------------------------------------
    // Block Camera
    // ---------------------------------------------------------------------

    function _mockStaking(uint64 epoch_, bool delay_, uint64 proposer_) internal {
        vm.mockCall(
            STAKING,
            abi.encodeWithSelector(bytes4(keccak256("getEpoch()"))),
            abi.encode(epoch_, delay_)
        );
        vm.mockCall(
            STAKING,
            abi.encodeWithSelector(bytes4(keccak256("getProposerValId()"))),
            abi.encode(proposer_)
        );
    }

    function testBlockCameraMintsThroughBoundLabsExperiment() public {
        _mockStaking(123, false, 182);
        vm.prank(bob);
        uint256 id = camera.capture();
        assertEq(labs.ownerOf(id), bob);
        assertEq(labs.sourceOf(id), address(camera));
        R3tardsBlockCamera.Shot memory value = camera.shot(id);
        assertEq(value.epoch, 123);
        assertEq(value.proposerValId, 182);
        assertTrue(value.epochKnown);
        assertTrue(value.proposerKnown);
        assertEq(value.parentHash, blockhash(block.number - 1));
    }

    function testSameValidatorProducesSameGlyphAndDifferentValidatorChangesPortrait() public view {
        bytes32 parent = keccak256("parent");
        bytes memory a = camera.previewPortrait(100, parent, 7, false, true, 182, true, 0, alice);
        bytes memory b = camera.previewPortrait(100, parent, 7, false, true, 182, true, 0, alice);
        bytes memory c = camera.previewPortrait(100, parent, 7, false, true, 183, true, 0, alice);
        assertEq(keccak256(a), keccak256(b));
        assertTrue(keccak256(a) != keccak256(c));
    }

    function testUnknownStakingDeviceFallsBackWithoutReverting() public {
        vm.mockCallRevert(STAKING, bytes(""), bytes("missing"));
        vm.prank(bob);
        uint256 id = camera.capture();
        R3tardsBlockCamera.Shot memory value = camera.shot(id);
        assertFalse(value.epochKnown);
        assertFalse(value.proposerKnown);
        assertEq(value.epoch, 0);
        assertEq(value.proposerValId, 0);
        assertGt(camera.previewPortrait(value.blockNumber, value.parentHash, 0, false, false, 0, false, 0, bob).length, 0);
    }

    function testBarcodeMakesBlockNumberPartOfPortrait() public view {
        bytes32 parent = keccak256("same parent");
        bytes memory zero = camera.previewPortrait(0, parent, 0, false, false, 0, false, 0, alice);
        bytes memory highBit = camera.previewPortrait(1 << 31, parent, 0, false, false, 0, false, 0, alice);
        assertTrue(keccak256(zero) != keccak256(highBit));
    }

    function testOneCapturePerWalletPerBlock() public {
        _mockStaking(1, false, 2);
        vm.prank(bob);
        camera.capture();
        vm.prank(bob);
        vm.expectRevert(R3tardsBlockCamera.AlreadyCapturedThisBlock.selector);
        camera.capture();
        vm.roll(block.number + 1);
        vm.prank(bob);
        camera.capture();
    }

    function testBlockCameraTokenUriStaysUnderSixMillionGas() public {
        _mockStaking(77, true, 182);
        vm.prank(bob);
        uint256 id = camera.capture();
        uint256 beforeGas = gasleft();
        labs.tokenURI(id);
        uint256 used = beforeGas - gasleft();
        assertLt(used, 6_000_000);
    }

    // ---------------------------------------------------------------------
    // Kernel Debugger
    // ---------------------------------------------------------------------

    function testGracefulDippedRunRefundsAndClearsCondition() public {
        // Monad-mode forge refuses vm.etch on the reserve precompile, so script its answers in order:
        // dipped at entry, then clear after the refund.
        bytes[] memory answers = new bytes[](2);
        answers[0] = abi.encode(true);
        answers[1] = abi.encode(false);
        vm.mockCalls(RESERVE, abi.encodeWithSelector(bytes4(keccak256("dippedIntoReserve()"))), answers);
        vm.deal(alice, 1 ether);

        vm.prank(alice, alice);
        kernel.run{value: 0.2 ether}(true, false);

        assertEq(alice.balance, 1 ether);
        assertEq(kernel.credits(alice), 0);
        assertEq(kernel.processCount(alice), 1);
    }

    function testNotDippedCreditsValue() public {
        vm.mockCall(
            RESERVE,
            abi.encodeWithSelector(bytes4(keccak256("dippedIntoReserve()"))),
            abi.encode(false)
        );
        vm.prank(alice);
        kernel.run{value: 0.2 ether}(true, false);
        assertEq(kernel.credits(alice), 0.2 ether);
    }

    function testNaiveRunKeepsValueWhenProbeSaysDipped() public {
        vm.mockCall(
            RESERVE,
            abi.encodeWithSelector(bytes4(keccak256("dippedIntoReserve()"))),
            abi.encode(true)
        );
        vm.prank(alice);
        kernel.run{value: 0.2 ether}(false, false);
        assertEq(kernel.credits(alice), 0.2 ether);
    }

    function testOptionalFailurePreservesPrimaryStep() public {
        vm.mockCall(
            RESERVE,
            abi.encodeWithSelector(bytes4(keccak256("dippedIntoReserve()"))),
            abi.encode(false)
        );
        vm.prank(alice);
        kernel.run(false, true);
        assertEq(kernel.processCount(alice), 1);
        assertEq(kernel.lastRunBlock(alice), block.number);
        assertEq(kernel.lastNote(alice), 0);
    }

    function testRefundToRejectingContractReverts() public {
        vm.mockCall(
            RESERVE,
            abi.encodeWithSelector(bytes4(keccak256("dippedIntoReserve()"))),
            abi.encode(true)
        );
        RejectRefund rejector = new RejectRefund(kernel);
        vm.deal(address(rejector), 1 ether);
        vm.expectRevert(R3tardsKernelDebugger.RefundFailed.selector);
        rejector.run{value: 0.1 ether}();
    }

    function testOptionalStepOnlySelf() public {
        vm.prank(alice);
        vm.expectRevert(R3tardsKernelDebugger.OnlySelf.selector);
        kernel.optionalStep(alice, false);
    }

    function testWithdrawResistsReentrancy() public {
        vm.mockCall(
            RESERVE,
            abi.encodeWithSelector(bytes4(keccak256("dippedIntoReserve()"))),
            abi.encode(false)
        );
        ReenterWithdraw receiver = new ReenterWithdraw(kernel);
        vm.deal(address(receiver), 1 ether);
        receiver.deposit{value: 0.2 ether}();
        assertEq(kernel.credits(address(receiver)), 0.2 ether);
        receiver.withdraw();
        assertTrue(receiver.attempted());
        assertEq(kernel.credits(address(receiver)), 0);
    }
}
