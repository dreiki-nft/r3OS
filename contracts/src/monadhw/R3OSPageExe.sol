// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MonadHW} from "../lib/MonadHW.sol";

/// @notice MIP-8 storage-page benchmark plus one writable 4 KiB page per wallet.
contract R3OSPageExe {
    uint256 public constant BENCH_BASE = uint256(keccak256("r3tards.page.exe.bench")) & ~uint256(127);
    uint256 public constant USER_BASE =
        uint256(keccak256("r3tards.page.exe.users")) & ~uint256((uint256(1) << 167) - 1);

    uint8 public constant PATTERN_CONTIGUOUS = 0;
    uint8 public constant PATTERN_SCATTERED = 1;
    uint8 public constant PATTERN_MAPPING = 2;

    error InvalidPattern(uint8 pattern);
    error InvalidCount(uint256 n);
    error EmptyWrite();
    error PageWriteOutOfBounds(uint256 offset, uint256 length);
    error BenchWriteResult(uint256 gasUsed, uint256 overhead);
    error SentinelHit();

    uint256 private constant SENTINEL = uint256(keccak256("r3tards.page.exe.sentinel"));

    event PageWritten(address indexed owner, uint256 offset, bytes32[] words);

    function probePage() external view returns (uint256 cold, uint256 warm, uint256 nextPageCold, uint256 overhead) {
        overhead = _measureOverhead();
        cold = _measureSload(BENCH_BASE);
        warm = _measureSload(BENCH_BASE + 1);
        nextPageCold = _measureSload(BENCH_BASE + MonadHW.PAGE_SLOTS);
    }

    function benchRead(uint8 pattern, uint256 n) external view returns (uint256 gasUsed, uint256 overhead) {
        _validateBench(pattern, n);
        overhead = _measureOverhead();
        uint256 beforeGas = gasleft();
        uint256 sink;
        for (uint256 i; i < n; ++i) sink ^= _sload(_benchSlot(pattern, i));
        gasUsed = beforeGas - gasleft();
        // Keep the reads observable without changing the ABI or touching storage.
        if (sink == type(uint256).max) assembly ("memory-safe") { pop(gas()) }
    }

    function benchWrite(uint8 pattern, uint256 n) external {
        _validateBench(pattern, n);
        uint256 overhead = _measureOverhead();
        uint256 beforeGas = gasleft();
        for (uint256 i; i < n; ++i) _sstore(_benchSlot(pattern, i), i + 1);
        uint256 gasUsed = beforeGas - gasleft();
        // The revert must not be provably unconditional: stores followed by a certain revert are dead code,
        // and the optimizer deletes them (the benchmark then measured ~285 gas per "write"). gasUsed comes
        // from gasleft(), so the compiler cannot prove this branch; it always runs in practice.
        if (gasUsed != type(uint256).max) revert BenchWriteResult(gasUsed, overhead);
    }

    function writePage(uint256 offset, bytes32[] calldata words) external {
        uint256 length = words.length;
        if (length == 0) revert EmptyWrite();
        if (offset >= MonadHW.PAGE_SLOTS || offset + length > MonadHW.PAGE_SLOTS) {
            revert PageWriteOutOfBounds(offset, length);
        }
        uint256 base = pageBaseSlot(msg.sender);
        for (uint256 i; i < length; ++i) _sstore(base + offset + i, uint256(words[i]));
        emit PageWritten(msg.sender, offset, words);
    }

    function readPage(address owner) external view returns (bytes32[128] memory words) {
        uint256 base = pageBaseSlot(owner);
        for (uint256 i; i < MonadHW.PAGE_SLOTS; ++i) words[i] = bytes32(_sload(base + i));
    }

    function pageIndexOf(address owner) external pure returns (uint256) {
        return MonadHW.pageOf(pageBaseSlot(owner));
    }

    function pageBaseSlot(address owner) public pure returns (uint256) {
        return USER_BASE + (uint256(uint160(owner)) << 7);
    }

    function _validateBench(uint8 pattern, uint256 n) private pure {
        if (pattern > PATTERN_MAPPING) revert InvalidPattern(pattern);
        if (n == 0 || n > MonadHW.PAGE_SLOTS) revert InvalidCount(n);
    }

    function _benchSlot(uint8 pattern, uint256 i) private pure returns (uint256) {
        if (pattern == PATTERN_CONTIGUOUS) return BENCH_BASE + i;
        if (pattern == PATTERN_SCATTERED) return BENCH_BASE + MonadHW.PAGE_SLOTS * (i + 1);
        return uint256(keccak256(abi.encode(i, BENCH_BASE)));
    }

    function _measureSload(uint256 slot) private view returns (uint256 used) {
        uint256 beforeGas = gasleft();
        uint256 value = _sload(slot);
        // The branch makes the SLOAD observable *before* the second gasleft(). Without it the optimizer
        // deletes the unused load (probePage then measured 2 gas for everything). Bench slots are never
        // persistently written, so the sentinel can't match.
        if (value == SENTINEL) revert SentinelHit();
        used = beforeGas - gasleft();
    }

    function _measureOverhead() private view returns (uint256 used) {
        uint256 beforeGas = gasleft();
        uint256 afterGas = gasleft();
        used = beforeGas - afterGas;
    }

    function _sload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") { sstore(slot, value) }
    }
}
