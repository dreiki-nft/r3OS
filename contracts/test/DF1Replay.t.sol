// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {R3OSPaint} from "../src/R3OSPaint.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract DF1ReplayTest is Test {
    R3OSPaint p;
    MockR3tards r;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    bytes32 constant PAINTED_SIG = keccak256("Painted(uint256,address,address,bytes,bytes,uint32,uint16)");
    uint256 constant RATE = 9_919_410_150_891_633;
    uint256 constant DEN = 1e20;

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        r = new MockR3tards();
        p = new R3OSPaint(
            address(r), uint64(vm.getBlockTimestamp()), alice, alice, 20_000, 0, 20_000, 16, 256
        );
    }

    function testPressureCountsHandOffsNotRepeatedSameOwner() public {
        vm.prank(alice); p.paint(hex"00000004", new uint256[](0));
        vm.prank(alice); p.paint(hex"00010104", new uint256[](0));
        vm.prank(alice); p.paint(hex"00020204", new uint256[](0));

        (,,,,, uint256 pressure) = p.regionState(0, 0);
        assertEq(pressure, 0);
    }

    function testDf1AmountAndExactCorruptionStream() public {
        _fourHandoffs();

        bytes memory runs = hex"0000FF06"; // 256 actual writes, no outline on y=0
        // Alice has three successful paints before this call.
        bytes32 seed = keccak256(
            abi.encodePacked(
                blockhash(vm.getBlockNumber() - 1),
                vm.getBlockNumber(),
                alice,
                uint64(3),
                keccak256(runs)
            )
        );
        uint256 numerator = 256 * RATE * 100; // P=4 => AMOUNT 100
        uint256 expectedK = numerator / DEN;
        if (uint256(seed) % DEN < numerator % DEN) ++expectedK;
        if (expectedK > 32) expectedK = 32;

        vm.recordLogs();
        vm.prank(alice);
        p.paint(runs, new uint256[](0));
        bytes memory corruptions = _lastCorruptions(vm.getRecordedLogs());

        assertEq(corruptions.length, expectedK * 3);
        for (uint256 i; i < expectedK; ++i) {
            uint256 rnd = uint256(keccak256(abi.encodePacked(seed, i)));
            assertEq(uint8(corruptions[i * 3]), uint8(rnd % 256));
            assertEq(uint8(corruptions[i * 3 + 1]), 0);
            assertEq(uint8(corruptions[i * 3 + 2]), uint8(((rnd >> 128) % 15) + 1));
        }
    }


    function testStormCorruptionUsesAmount200AtBoundary() public {
        vm.roll(200_000);
        bytes memory runs = hex"0000FF06";
        bytes32 seed = keccak256(
            abi.encodePacked(
                blockhash(vm.getBlockNumber() - 1),
                vm.getBlockNumber(),
                alice,
                uint64(0),
                keccak256(runs)
            )
        );
        uint256 numerator = 256 * RATE * 200;
        uint256 expectedK = numerator / DEN;
        if (uint256(seed) % DEN < numerator % DEN) ++expectedK;
        if (expectedK > 32) expectedK = 32;

        vm.recordLogs();
        vm.prank(alice);
        p.paint(runs, new uint256[](0));
        bytes memory corruptions = _lastCorruptions(vm.getRecordedLogs());
        assertEq(corruptions.length, expectedK * 3);
    }

    function testStormBoundaryReplayRemainsBitExact() public {
        bytes memory model = new bytes(32_768);
        vm.roll(200_599);
        vm.recordLogs();
        vm.prank(alice); p.paint(hex"00001F04", new uint256[](0));
        vm.roll(200_600);
        vm.prank(bob); p.paint(hex"01001F05", new uint256[](0));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(p) || logs[i].topics.length == 0 || logs[i].topics[0] != PAINTED_SIG) continue;
            (bytes memory runs, bytes memory corruptions,,) = abi.decode(logs[i].data, (bytes, bytes, uint32, uint16));
            _applyRuns(model, runs);
            _applyCorruptions(model, corruptions);
        }
        assertEq(model, p.getBackgroundCanvas());
    }

    function testFrameRecordsDf1AmountNotRawPressure() public {
        _fourHandoffs();
        vm.prank(bob);
        p.paint(hex"000A1106", new uint256[](0)); // current handoff makes stored pressure 5 => amount 150 at frame time
        vm.prank(bob);
        uint256 id = p.mintFrame();
        R3OSPaint.FrameInfoData memory info = p.frameInfo(id);
        assertEq(info.df1Amount, 150);
    }

    function testDf1SeedMatchesV1Formula() public {
        vm.prank(alice);
        p.paint(hex"00000004", new uint256[](0));
        vm.prank(alice);
        uint256 id = p.mintFrame();
        R3OSPaint.FrameInfoData memory info = p.frameInfo(id);

        uint32 expected = uint32(uint256(keccak256(abi.encode("r3tards.df1.v1", id, uint256(info.blockNumber)))));
        assertEq(p.df1Seed(id), expected);

        uint32 expectedLive = uint32(
            uint256(keccak256(abi.encode("r3tards.df1.v1", p.currentSeason(), vm.getBlockNumber())))
        );
        assertEq(p.df1Seed(0), expectedLive);
    }

    function testEventReplayMatchesBackgroundCanvasBitForBit() public {
        bytes memory model = new bytes(32_768);
        vm.recordLogs();

        vm.prank(alice); p.paint(hex"00000004", new uint256[](0));
        vm.prank(bob); p.paint(hex"00010105", new uint256[](0));
        vm.prank(alice); p.paint(hex"00020206", new uint256[](0));
        vm.prank(bob); p.paint(hex"00030308", new uint256[](0));
        vm.prank(alice); p.paint(hex"0000FF06", new uint256[](0));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(p) || logs[i].topics.length == 0 || logs[i].topics[0] != PAINTED_SIG) {
                continue;
            }
            (bytes memory runs, bytes memory corruptions,,) =
                abi.decode(logs[i].data, (bytes, bytes, uint32, uint16));
            _applyRuns(model, runs);
            _applyCorruptions(model, corruptions);
        }
        assertEq(model, p.getBackgroundCanvas());
    }

    function _fourHandoffs() internal {
        vm.prank(alice); p.paint(hex"00000004", new uint256[](0)); // establishes previous painter, no handoff yet
        vm.prank(bob); p.paint(hex"00010104", new uint256[](0));   // 1
        vm.prank(alice); p.paint(hex"00020204", new uint256[](0)); // 2
        vm.prank(bob); p.paint(hex"00030304", new uint256[](0));   // 3
        vm.prank(alice); p.paint(hex"00040404", new uint256[](0)); // 4
        (,,,,, uint256 pressure) = p.regionState(0, 0);
        assertEq(pressure, 4);
    }

    function _lastCorruptions(Vm.Log[] memory logs) internal view returns (bytes memory c) {
        for (uint256 i = logs.length; i > 0; --i) {
            Vm.Log memory l = logs[i - 1];
            if (l.emitter == address(p) && l.topics.length != 0 && l.topics[0] == PAINTED_SIG) {
                (, c,,) = abi.decode(l.data, (bytes, bytes, uint32, uint16));
                return c;
            }
        }
        revert("Painted not found");
    }

    function _applyRuns(bytes memory model, bytes memory runs) internal pure {
        // This replay fixture only paints y=0, which has no genesis outline.
        for (uint256 o; o < runs.length; o += 4) {
            uint8 y = uint8(runs[o]);
            uint8 x0 = uint8(runs[o + 1]);
            uint8 x1 = uint8(runs[o + 2]);
            uint8 color = uint8(runs[o + 3]);
            for (uint256 x = x0; x <= x1; ++x) _set(model, uint8(x), y, color);
        }
    }

    function _applyCorruptions(bytes memory model, bytes memory c) internal pure {
        for (uint256 o; o < c.length; o += 3) {
            _set(model, uint8(c[o]), uint8(c[o + 1]), uint8(c[o + 2]));
        }
    }

    function _set(bytes memory model, uint8 x, uint8 y, uint8 color) internal pure {
        uint256 bi = uint256(y) * 128 + uint256(x) / 2;
        uint8 old = uint8(model[bi]);
        model[bi] = x % 2 == 0
            ? bytes1((color << 4) | (old & 0x0F))
            : bytes1((old & 0xF0) | color);
    }
}
