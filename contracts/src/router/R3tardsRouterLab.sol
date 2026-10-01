// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPropAMMRouter} from "./IPropAMMRouter.sol";

interface IWrappedNative {
    function deposit() external payable;
    function approve(address spender, uint256 value) external returns (bool);
}

interface IERC20Balance {
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice Stateless MRC-17 routing diagnostics. It never executes a persistent swap.
contract R3tardsRouterLab {
    uint256 public constant MAX_VENUES = 8;
    uint256 public constant MIN_GAS_PER_FRAME = 50_000;
    uint256 public constant MAX_GAS_PER_FRAME = 5_000_000;
    uint256 public constant FRAME_OVERHEAD = 60_000;
    uint256 public constant MAX_REVERT_COPY = 512;
    uint256 public constant MAX_SUCCESS_RETURN = 4_096 + 96;
    string public constant INTERFACE = "MRC-17 DRAFT (MIPs#91 6e4f8633)";

    uint8 private constant DECODE_OK = 0;
    uint8 private constant DECODE_ZERO = 1;
    uint8 private constant DECODE_MALFORMED = 2;
    uint8 private constant DECODE_OVERSIZED = 3;
    uint8 private constant DECODE_REVERTED = 4;

    enum Status {
        OK,
        ZERO_OUTPUT,
        MALFORMED,
        OVERSIZED,
        REVERTED,
        REVERTED_AT_GAS_CAP,
        NO_CODE,
        FRAME_ERROR
    }

    enum StaticProbe {
        NOT_RUN,
        STATIC_OK,
        STATIC_FAILED
    }

    struct Venue {
        address adapter;
        bytes quoteData;
    }

    struct QuoteReport {
        address adapter;
        Status status;
        uint256 amountOut;
        uint256 gasUsed;
        uint256 returnSize;
        bytes4 revertSelector;
        bytes revertData;
        uint256 swapDataLength;
        bytes32 swapDataHash;
        StaticProbe staticProbe;
        uint256 staticGasUsed;
    }

    struct Comparison {
        uint256 blockNumber;
        uint256 timestamp;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 gasPerFrame;
        uint256 winner;
        QuoteReport[] reports;
    }

    struct SimReport {
        address adapter;
        Status quoteStatus;
        uint256 quoted;
        uint256 quoteGas;
        bool swapOk;
        uint256 delivered;
        uint256 swapGas;
        bytes4 swapRevertSelector;
    }

    error BadVenueCount(uint256 count);
    error BadGasCap(uint256 gasPerFrame);
    error BadAmount();
    error SameToken();
    error InsufficientGas(uint256 need, uint256 available);
    error OnlySelf();
    error QuoteFrame(
        bool ok,
        uint256 gasUsed,
        uint256 returnSize,
        uint8 decode,
        uint256 amountOut,
        uint256 swapDataLength,
        bytes32 swapDataHash,
        bytes4 revertSelector,
        bytes revertPrefix
    );
    error SimQuote(Status status, uint256 gasUsed, uint256 amountOut, bytes swapData, bytes4 revertSelector);
    error SimFrame(SimReport report);
    error Simulation(uint256 blockNumber, SimReport[] reports);

    function compare(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        Venue[] calldata venues,
        uint256 gasPerFrame,
        bool probeStatic
    ) external returns (Comparison memory out) {
        _validate(tokenIn, tokenOut, amountIn, venues.length, gasPerFrame);
        uint256 need = _compareBudget(venues.length, gasPerFrame, probeStatic);
        if (gasleft() < need) revert InsufficientGas(need, gasleft());

        QuoteReport[] memory reports = new QuoteReport[](venues.length);
        uint256 winner = type(uint256).max;
        uint256 highest;

        for (uint256 i; i < venues.length; ++i) {
            Venue calldata venue = venues[i];
            bytes memory callData = abi.encodeCall(
                IPropAMMRouter.getAmountOut,
                (tokenIn, tokenOut, amountIn, venue.quoteData)
            );
            QuoteReport memory report = _quoteOne(venue.adapter, callData, gasPerFrame);
            if (probeStatic && report.status == Status.OK) {
                (bool staticOk, uint256 staticUsed) = _staticProbe(venue.adapter, callData, gasPerFrame);
                report.staticProbe = staticOk ? StaticProbe.STATIC_OK : StaticProbe.STATIC_FAILED;
                report.staticGasUsed = staticUsed;
            }
            reports[i] = report;
            if (report.status == Status.OK && (winner == type(uint256).max || report.amountOut > highest)) {
                winner = i;
                highest = report.amountOut;
            }
        }

        out = Comparison({
            blockNumber: block.number,
            timestamp: block.timestamp,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            gasPerFrame: gasPerFrame,
            winner: winner,
            reports: reports
        });
    }

    /// @dev Self-only sandbox. It deliberately reverts so all adapter-side state changes are discarded.
    function quoteFrame(address adapter, bytes calldata callData, uint256 gasCap) external {
        if (msg.sender != address(this)) revert OnlySelf();

        // CALL reads its input from memory, so the calldata slice is copied before the gas is measured.
        bytes memory input = callData;
        uint256 startGas = gasleft();
        bool ok;
        assembly ("memory-safe") {
            ok := call(gasCap, adapter, 0, add(input, 32), mload(input), 0, 0)
        }
        uint256 used = startGas - gasleft();
        uint256 size;
        assembly ("memory-safe") {
            size := returndatasize()
        }

        if (!ok) {
            uint256 copySize = size > MAX_REVERT_COPY ? MAX_REVERT_COPY : size;
            bytes memory prefix = new bytes(copySize);
            if (copySize != 0) {
                assembly ("memory-safe") {
                    returndatacopy(add(prefix, 32), 0, copySize)
                }
            }
            bytes4 selector = copySize >= 4 ? _selector(prefix) : bytes4(0);
            revert QuoteFrame(false, used, size, DECODE_REVERTED, 0, 0, bytes32(0), selector, prefix);
        }

        if (size > MAX_SUCCESS_RETURN) {
            revert QuoteFrame(true, used, size, DECODE_OVERSIZED, 0, 0, bytes32(0), bytes4(0), "");
        }

        bytes memory returned = new bytes(size);
        if (size != 0) {
            assembly ("memory-safe") {
                returndatacopy(add(returned, 32), 0, size)
            }
        }
        (bool valid, uint256 amountOut, uint256 swapLength, bytes32 swapHash) = _decodeSuccess(returned);
        if (!valid) {
            revert QuoteFrame(true, used, size, DECODE_MALFORMED, 0, 0, bytes32(0), bytes4(0), "");
        }
        uint8 decode = amountOut == 0 ? DECODE_ZERO : DECODE_OK;
        revert QuoteFrame(true, used, size, decode, amountOut, swapLength, swapHash, bytes4(0), "");
    }

    /// @notice WMON-input execution preview for eth_call only. This function can never succeed.
    /// @dev The incoming MON, WMON deposit, approval and venue swap all unwind with Simulation.
    function simulateNativeIn(
        address wrappedNative,
        address tokenOut,
        Venue[] calldata venues,
        uint256 gasPerFrame
    ) external payable {
        _validate(wrappedNative, tokenOut, msg.value, venues.length, gasPerFrame);
        uint256 need = venues.length * (gasPerFrame * 2 + FRAME_OVERHEAD * 2) + 120_000;
        if (gasleft() < need) revert InsufficientGas(need, gasleft());

        SimReport[] memory reports = new SimReport[](venues.length);
        for (uint256 i; i < venues.length; ++i) {
            uint256 outerGas = gasPerFrame * 2 + FRAME_OVERHEAD * 2;
            try this.simFrame{gas: outerGas}(
                wrappedNative,
                tokenOut,
                // forge-lint: disable-next-line(msg-value-loop)
                msg.value,
                venues[i].adapter,
                venues[i].quoteData,
                gasPerFrame
            ) {
                reports[i] = SimReport({
                    adapter: venues[i].adapter,
                    quoteStatus: Status.FRAME_ERROR,
                    quoted: 0,
                    quoteGas: 0,
                    swapOk: false,
                    delivered: 0,
                    swapGas: 0,
                    swapRevertSelector: bytes4(0)
                });
            } catch (bytes memory reason) {
                (bool decoded, SimReport memory report) = _decodeSimFrame(reason);
                reports[i] = decoded
                    ? report
                    : SimReport({
                        adapter: venues[i].adapter,
                        quoteStatus: Status.FRAME_ERROR,
                        quoted: 0,
                        quoteGas: 0,
                        swapOk: false,
                        delivered: 0,
                        swapGas: 0,
                        swapRevertSelector: bytes4(0)
                    });
            }
        }
        revert Simulation(block.number, reports);
    }

    /// @dev Non-payable self-call. It spends the temporary balance already held by simulateNativeIn.
    function simFrame(
        // forge-lint: disable-next-line(missing-zero-check)
        address wrappedNative,
        address tokenOut,
        uint256 amountIn,
        address adapter,
        bytes calldata quoteData,
        uint256 gasPerFrame
    ) external {
        if (msg.sender != address(this)) revert OnlySelf();

        SimReport memory report;
        report.adapter = adapter;

        // forge-lint: disable-start(arbitrary-send-eth, return-bomb)
        (bool depositOk,) = wrappedNative.call{value: amountIn, gas: 120_000}(
            abi.encodeWithSelector(IWrappedNative.deposit.selector)
        );
        // forge-lint: disable-end(arbitrary-send-eth, return-bomb)
        if (!depositOk) {
            report.quoteStatus = Status.FRAME_ERROR;
            revert SimFrame(report);
        }

        (Status quoteStatus, uint256 quoted, uint256 quoteGas, bytes memory swapData,) =
            _simQuote(adapter, wrappedNative, tokenOut, amountIn, quoteData, gasPerFrame);
        report.quoteStatus = quoteStatus;
        report.quoted = quoted;
        report.quoteGas = quoteGas;
        if (quoteStatus != Status.OK) revert SimFrame(report);

        uint256 beforeBalance = _balanceOf(tokenOut, address(this));
        (bool approveOk, bytes4 approveSelector) = _approve(wrappedNative, adapter, amountIn);
        if (!approveOk) {
            report.swapRevertSelector = approveSelector;
            revert SimFrame(report);
        }

        bytes memory swapCall = abi.encodeCall(
            IPropAMMRouter.swap,
            (wrappedNative, tokenOut, address(this), amountIn, 1, block.timestamp, swapData)
        );
        (bool swapOk, uint256 swapGas, bytes4 swapSelector) = _boundedCall(adapter, swapCall, gasPerFrame);
        report.swapOk = swapOk;
        report.swapGas = swapGas;
        report.swapRevertSelector = swapSelector;
        if (swapOk) {
            uint256 afterBalance = _balanceOf(tokenOut, address(this));
            report.delivered = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        }
        revert SimFrame(report);
    }

    /// @dev Simulation-only quote sandbox that returns the bounded swapData through a deliberate revert.
    function simQuoteFrame(
        address adapter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes calldata quoteData,
        uint256 gasCap
    ) external {
        if (msg.sender != address(this)) revert OnlySelf();
        bytes memory callData = abi.encodeCall(
            IPropAMMRouter.getAmountOut,
            (tokenIn, tokenOut, amountIn, quoteData)
        );
        uint256 startGas = gasleft();
        bool callOk;
        assembly ("memory-safe") {
            callOk := call(gasCap, adapter, 0, add(callData, 32), mload(callData), 0, 0)
        }
        uint256 used = startGas - gasleft();
        uint256 size;
        assembly ("memory-safe") {
            size := returndatasize()
        }
        if (!callOk) {
            bytes4 selector;
            if (size >= 4) {
                assembly ("memory-safe") {
                    let ptr := mload(0x40)
                    returndatacopy(ptr, 0, 4)
                    selector := mload(ptr)
                }
            }
            bool atCap = size == 0 && used + 2_000 >= (gasCap * 63) / 64;
            revert SimQuote(atCap ? Status.REVERTED_AT_GAS_CAP : Status.REVERTED, used, 0, "", selector);
        }
        if (size > MAX_SUCCESS_RETURN) revert SimQuote(Status.OVERSIZED, used, 0, "", bytes4(0));
        bytes memory returned = new bytes(size);
        if (size != 0) {
            assembly ("memory-safe") {
                returndatacopy(add(returned, 32), 0, size)
            }
        }
        (bool valid, uint256 amountOut, uint256 swapLength,) = _decodeSuccess(returned);
        if (!valid) revert SimQuote(Status.MALFORMED, used, 0, "", bytes4(0));
        if (amountOut == 0) revert SimQuote(Status.ZERO_OUTPUT, used, 0, "", bytes4(0));
        bytes memory swapData = new bytes(swapLength);
        assembly ("memory-safe") {
            mcopy(add(swapData, 32), add(returned, 128), swapLength)
        }
        revert SimQuote(Status.OK, used, amountOut, swapData, bytes4(0));
    }

    function _simQuote(
        address adapter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes calldata quoteData,
        uint256 gasPerFrame
    ) private returns (Status status, uint256 amountOut, uint256 quoteGas, bytes memory swapData, bytes4 selector) {
        if (adapter.code.length == 0) return (Status.NO_CODE, 0, 0, bytes(""), bytes4(0));
        try this.simQuoteFrame{gas: gasPerFrame + FRAME_OVERHEAD}(
            adapter, tokenIn, tokenOut, amountIn, quoteData, gasPerFrame
        ) {
            return (Status.FRAME_ERROR, 0, 0, bytes(""), bytes4(0));
        } catch (bytes memory reason) {
            if (reason.length < 4 || _selector(reason) != SimQuote.selector) {
                return (Status.FRAME_ERROR, 0, 0, bytes(""), bytes4(0));
            }
            // SimQuote is (status, gasUsed, amountOut, swapData, selector); this function returns amountOut first.
            (status, quoteGas, amountOut, swapData, selector) =
                abi.decode(_stripSelector(reason), (Status, uint256, uint256, bytes, bytes4));
        }
    }

    function _quoteOne(address adapter, bytes memory callData, uint256 gasPerFrame)
        private
        returns (QuoteReport memory report)
    {
        report.adapter = adapter;
        report.staticProbe = StaticProbe.NOT_RUN;
        if (adapter.code.length == 0) {
            report.status = Status.NO_CODE;
            return report;
        }

        try this.quoteFrame{gas: gasPerFrame + FRAME_OVERHEAD}(adapter, callData, gasPerFrame) {
            report.status = Status.FRAME_ERROR;
        } catch (bytes memory reason) {
            if (reason.length < 4 || _selector(reason) != QuoteFrame.selector) {
                report.status = Status.FRAME_ERROR;
                return report;
            }
            bytes memory args = _stripSelector(reason);
            (
                bool ok,
                uint256 gasUsed,
                uint256 returnSize,
                uint8 decode,
                uint256 amountOut,
                uint256 swapDataLength,
                bytes32 swapDataHash,
                bytes4 revertSelector,
                bytes memory revertPrefix
            ) = abi.decode(args, (bool, uint256, uint256, uint8, uint256, uint256, bytes32, bytes4, bytes));
            report.gasUsed = gasUsed;
            report.returnSize = returnSize;
            report.amountOut = amountOut;
            report.swapDataLength = swapDataLength;
            report.swapDataHash = swapDataHash;
            report.revertSelector = revertSelector;
            report.revertData = revertPrefix;
            if (!ok || decode == DECODE_REVERTED) {
                bool atCap = returnSize == 0 && gasUsed + 2_000 >= (gasPerFrame * 63) / 64;
                report.status = atCap ? Status.REVERTED_AT_GAS_CAP : Status.REVERTED;
            } else if (decode == DECODE_OK) report.status = Status.OK;
            else if (decode == DECODE_ZERO) report.status = Status.ZERO_OUTPUT;
            else if (decode == DECODE_MALFORMED) report.status = Status.MALFORMED;
            else if (decode == DECODE_OVERSIZED) report.status = Status.OVERSIZED;
            else report.status = Status.FRAME_ERROR;
        }
    }

    function _staticProbe(address adapter, bytes memory callData, uint256 gasCap)
        private
        view
        returns (bool ok, uint256 gasUsed)
    {
        uint256 start = gasleft();
        assembly ("memory-safe") {
            ok := staticcall(gasCap, adapter, add(callData, 32), mload(callData), 0, 0)
        }
        gasUsed = start - gasleft();
    }

    function _decodeSuccess(bytes memory returned)
        private
        pure
        returns (bool valid, uint256 amountOut, uint256 swapLength, bytes32 swapHash)
    {
        if (returned.length < 96) return (false, 0, 0, bytes32(0));
        uint256 offset;
        assembly ("memory-safe") {
            amountOut := mload(add(returned, 32))
            offset := mload(add(returned, 64))
            swapLength := mload(add(returned, 96))
        }
        if (offset != 64) return (false, 0, 0, bytes32(0));
        if (swapLength > returned.length - 96) return (false, 0, 0, bytes32(0));
        uint256 padded = (swapLength + 31) & ~uint256(31);
        if (96 + padded != returned.length) return (false, 0, 0, bytes32(0));
        assembly ("memory-safe") {
            swapHash := keccak256(add(returned, 128), swapLength)
        }
        valid = true;
    }

    function _approve(address token, address spender, uint256 amount) private returns (bool ok, bytes4 selector) {
        bytes memory data = abi.encodeWithSelector(IWrappedNative.approve.selector, spender, amount);
        bytes memory result;
        // forge-lint: disable-next-line(return-bomb)
        (ok, result) = token.call{gas: 120_000}(data);
        if (!ok) return (false, result.length >= 4 ? _selector(result) : bytes4(0));
        if (result.length == 0) return (true, bytes4(0));
        if (result.length >= 32) {
            uint256 value;
            assembly ("memory-safe") {
                value := mload(add(result, 32))
            }
            return (value != 0, bytes4(0));
        }
        return (false, bytes4(0));
    }

    function _balanceOf(address token, address owner) private view returns (uint256 value) {
        // forge-lint: disable-start(return-bomb)
        (bool ok, bytes memory data) = token.staticcall{gas: 120_000}(
            abi.encodeWithSelector(IERC20Balance.balanceOf.selector, owner)
        );
        // forge-lint: disable-end(return-bomb)
        if (!ok || data.length < 32) return 0;
        value = abi.decode(data, (uint256));
    }

    function _boundedCall(address target, bytes memory callData, uint256 gasCap)
        private
        returns (bool ok, uint256 gasUsed, bytes4 revertSelector)
    {
        uint256 start = gasleft();
        assembly ("memory-safe") {
            ok := call(gasCap, target, 0, add(callData, 32), mload(callData), 0, 0)
        }
        gasUsed = start - gasleft();
        if (!ok) {
            uint256 size;
            assembly ("memory-safe") {
                size := returndatasize()
                if iszero(lt(size, 4)) {
                    let ptr := mload(0x40)
                    returndatacopy(ptr, 0, 4)
                    revertSelector := mload(ptr)
                }
            }
        }
    }

    function _decodeSimFrame(bytes memory reason) private pure returns (bool ok, SimReport memory report) {
        if (reason.length < 4 || _selector(reason) != SimFrame.selector) return (false, report);
        bytes memory args = _stripSelector(reason);
        report = abi.decode(args, (SimReport));
        ok = true;
    }

    function _validate(address tokenIn, address tokenOut, uint256 amountIn, uint256 count, uint256 gasPerFrame)
        private
        pure
    {
        if (count == 0 || count > MAX_VENUES) revert BadVenueCount(count);
        if (gasPerFrame < MIN_GAS_PER_FRAME || gasPerFrame > MAX_GAS_PER_FRAME) revert BadGasCap(gasPerFrame);
        if (amountIn == 0) revert BadAmount();
        if (tokenIn == tokenOut) revert SameToken();
    }

    function _compareBudget(uint256 count, uint256 gasPerFrame, bool probeStatic) private pure returns (uint256) {
        return count * (gasPerFrame * (probeStatic ? 2 : 1) + FRAME_OVERHEAD) + 100_000;
    }

    function _selector(bytes memory data) private pure returns (bytes4 value) {
        if (data.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            value := mload(add(data, 32))
        }
    }

    function _stripSelector(bytes memory data) private pure returns (bytes memory out) {
        if (data.length <= 4) return bytes("");
        uint256 length = data.length - 4;
        out = new bytes(length);
        assembly ("memory-safe") {
            mcopy(add(out, 32), add(data, 36), length)
        }
    }
}
