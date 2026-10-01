// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Small internal adapter for Monad execution and consensus devices.
/// @dev Monad precompiles used here require CALL. Do not make these helpers view or switch them to STATICCALL.
library MonadHW {
    address internal constant STAKING = 0x0000000000000000000000000000000000001000;
    address internal constant RESERVE = 0x0000000000000000000000000000000000001001;
    address internal constant P256 = 0x0000000000000000000000000000000000000100;
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;

    uint256 internal constant PAGE_SLOTS = 128;
    uint256 internal constant PAGE_BYTES = 4096;

    uint256 private constant PRECOMPILE_GAS = 20_000;

    function proposerValId() internal returns (uint64 id, bool ok) {
        // forge-lint: disable-start(return-bomb)
        (bool success, bytes memory data) = STAKING.call{gas: PRECOMPILE_GAS}(
            abi.encodeWithSelector(bytes4(keccak256("getProposerValId()")))
        );
        // forge-lint: disable-end(return-bomb)
        ok = success && data.length >= 32;
        if (ok) {
            uint256 word;
            assembly ("memory-safe") { word := mload(add(data, 0x20)) }
            id = uint64(word);
        }
    }

    function epoch() internal returns (uint64 epoch_, bool inDelay, bool ok) {
        // forge-lint: disable-start(return-bomb)
        (bool success, bytes memory data) = STAKING.call{gas: PRECOMPILE_GAS}(
            abi.encodeWithSelector(bytes4(keccak256("getEpoch()")))
        );
        // forge-lint: disable-end(return-bomb)
        ok = success && data.length >= 64;
        if (ok) {
            uint256 epochWord;
            uint256 delayWord;
            assembly ("memory-safe") {
                epochWord := mload(add(data, 0x20))
                delayWord := mload(add(data, 0x40))
            }
            epoch_ = uint64(epochWord);
            inDelay = delayWord != 0;
        }
    }

    function dippedIntoReserve() internal returns (bool dipped, bool ok) {
        // forge-lint: disable-start(return-bomb)
        (bool success, bytes memory data) = RESERVE.call{gas: PRECOMPILE_GAS}(
            abi.encodeWithSelector(bytes4(keccak256("dippedIntoReserve()")))
        );
        // forge-lint: disable-end(return-bomb)
        ok = success && data.length >= 32;
        if (ok) {
            uint256 word;
            assembly ("memory-safe") { word := mload(add(data, 0x20)) }
            dipped = word != 0;
        }
    }

    function pageOf(uint256 slot) internal pure returns (uint256) {
        return slot >> 7;
    }
}
