// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {R3tardsRouterLab} from "../src/router/R3tardsRouterLab.sol";
import {
    MockWrappedNative,
    MockUSD,
    ViewVenue,
    StatefulVenue,
    RevertBubbleVenue,
    UnavailableVenue,
    PairVenue,
    MalformedVenue,
    ZeroVenue,
    GasBurnerVenue,
    GiantRevertVenue,
    OversizedVenue,
    TieVenue,
    UnderDeliveringVenue,
    OpaqueSwapDataVenue,
    ReentrantVenue
} from "./RouterMocks.sol";

contract RouterLabTest is Test {
    R3tardsRouterLab lab;
    MockWrappedNative wrapped;
    MockUSD usd;

    ViewVenue viewVenue;
    StatefulVenue stateful;
    RevertBubbleVenue bubble;
    UnavailableVenue unavailable;
    PairVenue pairVenue;
    MalformedVenue malformed;
    ZeroVenue zero;
    GasBurnerVenue gasBurner;
    GiantRevertVenue giant;
    OversizedVenue oversized;
    TieVenue tie;
    UnderDeliveringVenue under;
    OpaqueSwapDataVenue opaque;
    ReentrantVenue reentrant;

    uint256 constant RATE_30 = 30e6;
    uint256 constant RATE_31 = 31e6;

    function setUp() public {
        lab = new R3tardsRouterLab();
        wrapped = new MockWrappedNative();
        usd = new MockUSD();
        viewVenue = new ViewVenue(RATE_30);
        stateful = new StatefulVenue(RATE_31);
        bubble = new RevertBubbleVenue(29e6);
        unavailable = new UnavailableVenue();
        pairVenue = new PairVenue(RATE_30, address(wrapped), address(usd));
        malformed = new MalformedVenue();
        zero = new ZeroVenue();
        gasBurner = new GasBurnerVenue();
        giant = new GiantRevertVenue();
        oversized = new OversizedVenue();
        tie = new TieVenue(RATE_30);
        under = new UnderDeliveringVenue(RATE_30, 9_000);
        opaque = new OpaqueSwapDataVenue(RATE_30);
        reentrant = new ReentrantVenue(RATE_30, lab);
        vm.deal(address(this), 100 ether);
    }

    function testStatefulQuoteIsRolledBack() public {
        R3tardsRouterLab.Venue[] memory venues = _venues(address(stateful));
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, venues, 500_000, true
        );
        assertEq(uint256(result.reports[0].status), uint256(R3tardsRouterLab.Status.OK));
        assertEq(uint256(result.reports[0].staticProbe), uint256(R3tardsRouterLab.StaticProbe.STATIC_FAILED));
        assertEq(stateful.counter(), 0);
        assertEq(stateful.transientValue(), 0);
        _assertLabStorageZero();
    }

    function testRevertBubbleVenueQuotes() public {
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, _venues(address(bubble)), 500_000, false
        );
        assertEq(uint256(result.reports[0].status), uint256(R3tardsRouterLab.Status.OK));
        assertEq(result.reports[0].amountOut, 29e6);
    }


    function testPairVenueReportsUnsupportedDirectionAsRevert() public {
        address other = makeAddr("other-token");
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), other, 1 ether, _venues(address(pairVenue)), 500_000, false
        );
        _assertStatus(result, 0, R3tardsRouterLab.Status.REVERTED);
        assertEq(result.reports[0].revertSelector, PairVenue.InvalidTokenPair.selector);
    }

    function testClassifiesIndependentVenues() public {
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](8);
        venues[0] = _venue(address(viewVenue));
        venues[1] = _venue(address(unavailable));
        venues[2] = _venue(address(malformed));
        venues[3] = _venue(address(zero));
        venues[4] = _venue(address(oversized));
        venues[5] = _venue(address(0xBEEF));
        venues[6] = _venue(address(stateful));
        venues[7] = _venue(address(reentrant));

        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, venues, 1_000_000, true
        );
        _assertStatus(result, 0, R3tardsRouterLab.Status.OK);
        _assertStatus(result, 1, R3tardsRouterLab.Status.REVERTED);
        _assertStatus(result, 2, R3tardsRouterLab.Status.MALFORMED);
        _assertStatus(result, 3, R3tardsRouterLab.Status.ZERO_OUTPUT);
        _assertStatus(result, 4, R3tardsRouterLab.Status.OVERSIZED);
        _assertStatus(result, 5, R3tardsRouterLab.Status.NO_CODE);
        _assertStatus(result, 6, R3tardsRouterLab.Status.OK);
        _assertStatus(result, 7, R3tardsRouterLab.Status.OK);
        assertEq(stateful.counter(), 0);
        _assertLabStorageZero();
    }

    function testGasBurnerDoesNotHideLaterVenue() public {
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](3);
        venues[0] = _venue(address(viewVenue));
        venues[1] = _venue(address(gasBurner));
        venues[2] = _venue(address(stateful));
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, venues, 200_000, false
        );
        _assertStatus(result, 0, R3tardsRouterLab.Status.OK);
        _assertStatus(result, 1, R3tardsRouterLab.Status.REVERTED_AT_GAS_CAP);
        _assertStatus(result, 2, R3tardsRouterLab.Status.OK);
        assertEq(result.reports.length, 3);
    }

    function testGiantRevertIsCappedButReportsFullSize() public {
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, _venues(address(giant)), 5_000_000, false
        );
        _assertStatus(result, 0, R3tardsRouterLab.Status.REVERTED);
        assertEq(result.reports[0].returnSize, 1_048_576);
        assertEq(result.reports[0].revertData.length, lab.MAX_REVERT_COPY());
    }

    /// @dev Eight hostile venues at the largest frame: four burn their whole quote frame, return the largest
    /// accepted payload and then burn the whole STATICCALL probe; four revert with 1 MiB. The preflight budget
    /// alone must be enough for every row to come back.
    function testWorstCaseVenuesFitPreflightBudget() public {
        WorstCaseOkVenue worst = new WorstCaseOkVenue();
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](8);
        for (uint256 i; i < 8; ++i) {
            venues[i] = _venue(i % 2 == 0 ? address(worst) : address(giant));
        }
        uint256 gasPerFrame = lab.MAX_GAS_PER_FRAME();
        uint256 need = 8 * (gasPerFrame * 2 + lab.FRAME_OVERHEAD()) + 100_000;
        R3tardsRouterLab.Comparison memory result = lab.compare{gas: need + 20_000}(
            address(wrapped), address(usd), 1 ether, venues, gasPerFrame, true
        );
        assertEq(result.reports.length, 8);
        for (uint256 i; i < 8; i += 2) {
            _assertStatus(result, i, R3tardsRouterLab.Status.OK);
            assertEq(result.reports[i].swapDataLength, 4_096);
            assertEq(uint256(result.reports[i].staticProbe), uint256(R3tardsRouterLab.StaticProbe.STATIC_FAILED));
            _assertStatus(result, i + 1, R3tardsRouterLab.Status.REVERTED);
            assertEq(result.reports[i + 1].revertData.length, lab.MAX_REVERT_COPY());
        }
        assertEq(worst.sink(), 0);
    }

    function testWinnerAndTieRule() public {
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](3);
        venues[0] = _venue(address(viewVenue));
        venues[1] = _venue(address(tie));
        venues[2] = _venue(address(stateful));
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, venues, 500_000, false
        );
        assertEq(result.winner, 2);

        R3tardsRouterLab.Venue[] memory ties = new R3tardsRouterLab.Venue[](2);
        ties[0] = _venue(address(viewVenue));
        ties[1] = _venue(address(tie));
        result = lab.compare(address(wrapped), address(usd), 1 ether, ties, 500_000, false);
        assertEq(result.winner, 0);
    }

    function testNoOkReportUsesMaxWinner() public {
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](2);
        venues[0] = _venue(address(unavailable));
        venues[1] = _venue(address(zero));
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, venues, 500_000, false
        );
        assertEq(result.winner, type(uint256).max);
    }

    function testStaticProbeDistinguishesStatefulPath() public {
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](2);
        venues[0] = _venue(address(viewVenue));
        venues[1] = _venue(address(stateful));
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), 1 ether, venues, 500_000, true
        );
        assertEq(uint256(result.reports[0].staticProbe), uint256(R3tardsRouterLab.StaticProbe.STATIC_OK));
        assertEq(uint256(result.reports[1].staticProbe), uint256(R3tardsRouterLab.StaticProbe.STATIC_FAILED));
    }

    function testBoundsAndSelfOnlyFrame() public {
        R3tardsRouterLab.Venue[] memory none = new R3tardsRouterLab.Venue[](0);
        vm.expectRevert(abi.encodeWithSelector(R3tardsRouterLab.BadVenueCount.selector, 0));
        lab.compare(address(wrapped), address(usd), 1 ether, none, 500_000, false);

        R3tardsRouterLab.Venue[] memory nine = new R3tardsRouterLab.Venue[](9);
        vm.expectRevert(abi.encodeWithSelector(R3tardsRouterLab.BadVenueCount.selector, 9));
        lab.compare(address(wrapped), address(usd), 1 ether, nine, 500_000, false);

        vm.expectRevert(abi.encodeWithSelector(R3tardsRouterLab.BadGasCap.selector, 49_999));
        lab.compare(address(wrapped), address(usd), 1 ether, _venues(address(viewVenue)), 49_999, false);

        vm.expectRevert(R3tardsRouterLab.OnlySelf.selector);
        lab.quoteFrame(address(viewVenue), bytes(""), 50_000);
    }

    function testInsufficientGasFailsBeforeVenueLoop() public {
        bytes memory callData = abi.encodeCall(
            R3tardsRouterLab.compare,
            (address(wrapped), address(usd), 1 ether, _venues(address(viewVenue)), 50_000, false)
        );
        (bool ok, bytes memory reason) = address(lab).call{gas: 150_000}(callData);
        assertFalse(ok);
        assertEq(_selector(reason), R3tardsRouterLab.InsufficientGas.selector);
    }

    function testSimulationAlwaysRevertsAndUnwinds() public {
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](4);
        venues[0] = _venue(address(viewVenue));
        venues[1] = _venue(address(under));
        venues[2] = _venue(address(opaque));
        venues[3] = _venue(address(stateful));
        uint256 beforeNative = address(this).balance;

        try lab.simulateNativeIn{value: 1 ether}(address(wrapped), address(usd), venues, 1_000_000) {
            fail("simulation returned");
        } catch (bytes memory reason) {
            (uint256 simulatedBlock, R3tardsRouterLab.SimReport[] memory reports) = _decodeSimulation(reason);
            assertEq(simulatedBlock, block.number);
            assertEq(reports.length, 4);
            assertEq(uint256(reports[0].quoteStatus), uint256(R3tardsRouterLab.Status.OK));
            assertTrue(reports[0].swapOk);
            assertEq(reports[0].quoted, RATE_30);
            assertEq(reports[0].delivered, RATE_30);
            assertTrue(reports[1].swapOk);
            assertEq(reports[1].quoted, RATE_30);
            assertEq(reports[1].delivered, RATE_30 * 9_000 / 10_000);
            assertTrue(reports[2].swapOk);
            assertEq(reports[2].quoted, RATE_30);
            assertEq(reports[2].delivered, RATE_30);
            assertTrue(reports[3].swapOk);
            assertEq(reports[3].quoted, RATE_31);
            assertEq(reports[3].delivered, RATE_31);
        }

        assertEq(stateful.counter(), 0);
        assertEq(stateful.transientValue(), 0);
        assertEq(address(this).balance, beforeNative);
        assertEq(address(lab).balance, 0);
        assertEq(wrapped.balanceOf(address(lab)), 0);
        assertEq(usd.balanceOf(address(lab)), 0);
        assertEq(wrapped.allowance(address(lab), address(viewVenue)), 0);
        assertEq(wrapped.allowance(address(lab), address(under)), 0);
        assertEq(wrapped.allowance(address(lab), address(opaque)), 0);
        assertEq(wrapped.allowance(address(lab), address(stateful)), 0);
        assertEq(wrapped.balanceOf(address(viewVenue)), 0);
        assertEq(wrapped.balanceOf(address(under)), 0);
        assertEq(wrapped.balanceOf(address(opaque)), 0);
        assertEq(wrapped.balanceOf(address(stateful)), 0);
        _assertLabStorageZero();
    }

    function testRealValueTransactionCannotKeepFunds() public {
        uint256 beforeNative = address(this).balance;
        (bool ok,) = address(lab).call{value: 1 ether}(
            abi.encodeCall(
                R3tardsRouterLab.simulateNativeIn,
                (address(wrapped), address(usd), _venues(address(viewVenue)), 500_000)
            )
        );
        assertFalse(ok);
        assertEq(address(this).balance, beforeNative);
        assertEq(address(lab).balance, 0);
    }

    function testFuzzReportsLengthAndNoPersistence(uint96 rawAmount, uint32 rawGas) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000 ether);
        uint256 gasCap = bound(uint256(rawGas), 50_000, 1_000_000);
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](2);
        venues[0] = _venue(address(viewVenue));
        venues[1] = _venue(address(stateful));
        R3tardsRouterLab.Comparison memory result = lab.compare(
            address(wrapped), address(usd), amount, venues, gasCap, false
        );
        assertEq(result.reports.length, venues.length);
        assertEq(stateful.counter(), 0);
        _assertLabStorageZero();
    }

    function testGasCompareFiveMocks() public {
        R3tardsRouterLab.Venue[] memory venues = new R3tardsRouterLab.Venue[](5);
        venues[0] = _venue(address(viewVenue));
        venues[1] = _venue(address(stateful));
        venues[2] = _venue(address(bubble));
        venues[3] = _venue(address(unavailable));
        venues[4] = _venue(address(opaque));

        uint256 start = gasleft();
        lab.compare(address(wrapped), address(usd), 1 ether, venues, 500_000, false);
        console2.log("router compare 5, no static probe", start - gasleft());

        start = gasleft();
        lab.compare(address(wrapped), address(usd), 1 ether, venues, 500_000, true);
        console2.log("router compare 5, static probe", start - gasleft());
    }

    function _venue(address adapter) private pure returns (R3tardsRouterLab.Venue memory) {
        return R3tardsRouterLab.Venue({adapter: adapter, quoteData: bytes("")});
    }

    function _venues(address adapter) private pure returns (R3tardsRouterLab.Venue[] memory venues) {
        venues = new R3tardsRouterLab.Venue[](1);
        venues[0] = _venue(adapter);
    }

    function _assertStatus(
        R3tardsRouterLab.Comparison memory result,
        uint256 index,
        R3tardsRouterLab.Status expected
    ) private pure {
        assertEq(uint256(result.reports[index].status), uint256(expected));
    }

    function _assertLabStorageZero() private view {
        for (uint256 slot; slot < 16; ++slot) assertEq(vm.load(address(lab), bytes32(slot)), bytes32(0));
    }

    function _decodeSimulation(bytes memory reason)
        private
        pure
        returns (uint256 simulatedBlock, R3tardsRouterLab.SimReport[] memory reports)
    {
        assertEq(_selector(reason), R3tardsRouterLab.Simulation.selector);
        bytes memory body = _stripSelector(reason);
        return abi.decode(body, (uint256, R3tardsRouterLab.SimReport[]));
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(data, 32))
        }
    }

    function _stripSelector(bytes memory data) private pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i; i < out.length; ++i) out[i] = data[i + 4];
    }
}

/// @dev Uses (almost) its whole frame, returns the largest payload the lab accepts and writes storage, so the
/// STATICCALL probe halts after burning its whole cap too.
contract WorstCaseOkVenue {
    uint256 public sink;

    function getAmountOut(address, address, uint256, bytes calldata) external returns (uint256, bytes memory data) {
        data = new bytes(4_096);
        while (gasleft() > 60_000) {}
        sink = 1;
        return (1, data);
    }
}
