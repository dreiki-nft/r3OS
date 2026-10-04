// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {R3OSRouterLab} from "../src/router/R3OSRouterLab.sol";

contract RouterLabForkTest is Test {
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    address constant POE = 0xa13FEdc8f6Ae3b197F0aF0eF34a3E6F08fd999E1;
    address constant CLOBER = 0x438e3C0F7C66e8B4d788C743559D5076226A96D2;
    address constant METRIC = 0x63f951E2C726215a719aC4d8F7Ad6B1cA9dcAd3B;
    address constant HANJI = 0xFAAE283A98274a6c788dcBb66760EC4B76c48EB6;
    address constant THOG = 0x7c87E2dFD32BDeEa11654866F5199E3aC9CC92eB;

    bytes32 constant POE_HASH = 0xa4372be09d0fe3ad470d5a9986841bf2ead48a3d7068c84297fae22716925148;
    bytes32 constant CLOBER_HASH = 0x90c7b5cf315562ba81ed40559e0391ce2efe07796205486ea70a0b3963d4c927;
    bytes32 constant METRIC_HASH = 0x9ca7cec898e31cf9ffc6d1bb88aa53409e7c5ccdde8a4bbf2e8af9f24bdef33b;
    bytes32 constant HANJI_HASH = 0x0b502bff967d1f4b0e7eca5f82bf007ba9a1027105ae3481c56761090d4cc497;
    bytes32 constant THOG_HASH = 0xdcb04f597fcd089b13ca2fe213defc963d776c4fde428af3e99092ddd900906f;

    function testMainnetAdapters() public {
        string memory rpc = vm.envOr("MONAD_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 143);

        _assertCodeHash(POE, POE_HASH, "poe");
        _assertCodeHash(CLOBER, CLOBER_HASH, "clober");
        _assertCodeHash(METRIC, METRIC_HASH, "metric");
        _assertCodeHash(HANJI, HANJI_HASH, "hanji");
        _assertCodeHash(THOG, THOG_HASH, "thog");

        R3OSRouterLab lab = new R3OSRouterLab();
        R3OSRouterLab.Venue[] memory venues = new R3OSRouterLab.Venue[](5);
        venues[0] = _venue(POE);
        venues[1] = _venue(CLOBER);
        venues[2] = _venue(METRIC);
        venues[3] = _venue(HANJI);
        venues[4] = _venue(THOG);

        R3OSRouterLab.Comparison memory result = lab.compare(WMON, USDC, 1 ether, venues, 5_000_000, true);
        bool anyOk;
        for (uint256 i; i < result.reports.length; ++i) {
            R3OSRouterLab.QuoteReport memory report = result.reports[i];
            console2.log("adapter", report.adapter);
            console2.log("status", uint256(report.status));
            console2.log("amountOut", report.amountOut);
            console2.log("quote gas", report.gasUsed);
            console2.log("static probe", uint256(report.staticProbe));
            console2.log("revert selector");
            console2.logBytes4(report.revertSelector);
            if (report.status == R3OSRouterLab.Status.OK) anyOk = true;
        }
        assertTrue(anyOk, "at least one WMON/USDC adapter should quote");
        if (result.reports[2].status == R3OSRouterLab.Status.OK) {
            assertEq(
                uint256(result.reports[2].staticProbe),
                uint256(R3OSRouterLab.StaticProbe.STATIC_FAILED),
                "Metric non-view quote should fail under STATICCALL"
            );
        } else {
            console2.log("Metric quote not OK; selector");
            console2.logBytes4(result.reports[2].revertSelector);
        }

        vm.deal(address(this), 2 ether);
        try lab.simulateNativeIn{value: 1 ether}(WMON, USDC, venues, 5_000_000) {
            fail("simulation must revert");
        } catch (bytes memory reason) {
            (uint256 simulatedBlock, R3OSRouterLab.SimReport[] memory reports) = _decodeSimulation(reason);
            console2.log("simulation block", simulatedBlock);
            for (uint256 i; i < reports.length; ++i) {
                console2.log("sim adapter", reports[i].adapter);
                console2.log("quoted", reports[i].quoted);
                console2.log("delivered", reports[i].delivered);
                console2.log("swap ok", reports[i].swapOk);
            }
        }
    }

    function _venue(address adapter) private pure returns (R3OSRouterLab.Venue memory) {
        return R3OSRouterLab.Venue({adapter: adapter, quoteData: bytes("")});
    }

    function _assertCodeHash(address adapter, bytes32 expected, string memory label) private view {
        bytes32 actual = keccak256(adapter.code);
        console2.log(label);
        console2.logBytes32(actual);
        assertEq(actual, expected, "adapter runtime code hash changed");
    }

    function _decodeSimulation(bytes memory reason)
        private
        pure
        returns (uint256 simulatedBlock, R3OSRouterLab.SimReport[] memory reports)
    {
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(reason, 32))
        }
        assertEq(selector, R3OSRouterLab.Simulation.selector);
        bytes memory body = new bytes(reason.length - 4);
        for (uint256 i; i < body.length; ++i) body[i] = reason[i + 4];
        return abi.decode(body, (uint256, R3OSRouterLab.SimReport[]));
    }
}
