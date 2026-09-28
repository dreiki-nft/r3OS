// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal SSTORE2-style frame storage.
/// @dev Runtime code is STOP (0x00) followed by immutable frame bytes.
library FrameStore {
    error WriteFailed();
    error InvalidPointer();
    error DataTooLarge();
    error InvalidInitCode();

    uint256 internal constant INIT_HEADER_LENGTH = 14;
    uint256 internal constant DATA_OFFSET = 15;

    /// @notice Allocates CREATE initcode whose runtime is STOP + `dataLength` bytes.
    /// @dev Callers write payload bytes directly at byte offset DATA_OFFSET, avoiding a second 32 KB copy.
    function allocateInit(uint256 dataLength) internal pure returns (bytes memory init) {
        uint256 runtimeSize = dataLength + 1;
        if (runtimeSize > type(uint16).max) revert DataTooLarge();

        init = new bytes(dataLength + DATA_OFFSET);
        init[0] = 0x61; // PUSH2 runtimeSize
        init[1] = bytes1(uint8(runtimeSize >> 8));
        init[2] = bytes1(uint8(runtimeSize));
        init[3] = 0x60; // PUSH1 0x0e (runtime starts at STOP byte)
        init[4] = bytes1(uint8(INIT_HEADER_LENGTH));
        init[5] = 0x60; // PUSH1 0
        init[6] = 0x00;
        init[7] = 0x39; // CODECOPY
        init[8] = 0x61; // PUSH2 runtimeSize
        init[9] = bytes1(uint8(runtimeSize >> 8));
        init[10] = bytes1(uint8(runtimeSize));
        init[11] = 0x60; // PUSH1 0
        init[12] = 0x00;
        init[13] = 0xf3; // RETURN
        init[14] = 0x00; // STOP prefix in runtime
    }

    function writePrepared(bytes memory init) internal returns (address pointer) {
        if (init.length <= DATA_OFFSET) revert InvalidInitCode();
        assembly ("memory-safe") {
            pointer := create(0, add(init, 0x20), mload(init))
        }
        if (pointer == address(0)) revert WriteFailed();
    }

    function read(address pointer) internal view returns (bytes memory data) {
        uint256 size;
        assembly ("memory-safe") {
            size := extcodesize(pointer)
        }
        if (size <= 1) revert InvalidPointer();
        unchecked {
            size -= 1;
        }
        data = new bytes(size);
        assembly ("memory-safe") {
            extcodecopy(pointer, add(data, 0x20), 1, size)
        }
    }
}

