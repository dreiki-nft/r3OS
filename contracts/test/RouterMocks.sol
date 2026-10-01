// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPropAMMRouter} from "../src/router/IPropAMMRouter.sol";
import {R3tardsRouterLab} from "../src/router/R3tardsRouterLab.sol";

interface IMintableToken {
    function mint(address to, uint256 amount) external;
}

contract MockWrappedNative is ERC20 {
    constructor() ERC20("Mock Wrapped MON", "WMOCK") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw");
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockUSD is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract MockVenueBase is IPropAMMRouter {
    uint256 public immutable RATE;

    constructor(uint256 rate) {
        RATE = rate;
    }

    function _quote(uint256 amountIn) internal view returns (uint256) {
        return amountIn * RATE / 1e18;
    }

    function swap(
        address tokenIn,
        address tokenOut,
        address to,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256,
        bytes calldata
    ) external virtual returns (uint256 amountOut) {
        amountOut = _quote(amountIn);
        require(amountOut >= amountOutMin, "min out");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IMintableToken(tokenOut).mint(to, amountOut);
        emit PropAMMSwap(msg.sender, to, tokenIn, tokenOut, amountIn, amountOut);
    }
}

contract ViewVenue is MockVenueBase {
    constructor(uint256 rate) MockVenueBase(rate) {}

    function getAmountOut(address, address, uint256 amountIn, bytes calldata)
        external
        view
        returns (uint256 amountOut, bytes memory swapData)
    {
        return (_quote(amountIn), bytes(""));
    }
}

contract StatefulVenue is MockVenueBase {
    uint256 public counter;
    bytes32 public constant TRANSIENT_SLOT = keccak256("router.mock.transient");

    constructor(uint256 rate) MockVenueBase(rate) {}

    function getAmountOut(address, address, uint256 amountIn, bytes calldata)
        external
        returns (uint256 amountOut, bytes memory swapData)
    {
        counter += 1;
        bytes32 slot = TRANSIENT_SLOT;
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
        return (_quote(amountIn), bytes(""));
    }

    function transientValue() external view returns (uint256 value) {
        bytes32 slot = TRANSIENT_SLOT;
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }
}

contract RevertBubbleVenue is MockVenueBase {
    error QuoteResult(uint256 amountOut);

    constructor(uint256 rate) MockVenueBase(rate) {}

    function _simulate(uint256 amountIn) external view {
        revert QuoteResult(_quote(amountIn));
    }

    function getAmountOut(address, address, uint256 amountIn, bytes calldata)
        external
        returns (uint256 amountOut, bytes memory swapData)
    {
        try this._simulate(amountIn) {
            revert("expected revert");
        } catch (bytes memory reason) {
            bytes4 selector;
            if (reason.length >= 4) {
                assembly ("memory-safe") {
                    selector := mload(add(reason, 32))
                }
            }
            require(reason.length == 36 && selector == QuoteResult.selector, "bad envelope");
            assembly ("memory-safe") {
                amountOut := mload(add(reason, 36))
            }
        }
        return (amountOut, bytes(""));
    }
}

contract UnavailableVenue is MockVenueBase {
    error InsufficientLiquidity();

    constructor() MockVenueBase(0) {}

    function getAmountOut(address, address, uint256, bytes calldata)
        external
        pure
        returns (uint256, bytes memory)
    {
        revert InsufficientLiquidity();
    }
}

contract PairVenue is MockVenueBase {
    error InvalidTokenPair();
    address public immutable TOKEN0;
    address public immutable TOKEN1;

    constructor(uint256 rate, address token0, address token1) MockVenueBase(rate) {
        TOKEN0 = token0;
        TOKEN1 = token1;
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata)
        external
        view
        returns (uint256, bytes memory)
    {
        bool served = (tokenIn == TOKEN0 && tokenOut == TOKEN1) || (tokenIn == TOKEN1 && tokenOut == TOKEN0);
        if (!served) revert InvalidTokenPair();
        return (_quote(amountIn), bytes(""));
    }
}

contract MalformedVenue is MockVenueBase {
    constructor() MockVenueBase(0) {}

    function getAmountOut(address, address, uint256, bytes calldata)
        external
        pure
        returns (uint256, bytes memory)
    {
        assembly ("memory-safe") {
            mstore(0, 0x01020304050607)
            return(25, 7)
        }
    }
}

contract ZeroVenue is MockVenueBase {
    constructor() MockVenueBase(0) {}

    function getAmountOut(address, address, uint256, bytes calldata)
        external
        pure
        returns (uint256, bytes memory)
    {
        return (0, bytes(""));
    }
}

contract GasBurnerVenue is MockVenueBase {
    constructor() MockVenueBase(0) {}

    function getAmountOut(address, address, uint256, bytes calldata)
        external
        pure
        returns (uint256, bytes memory)
    {
        assembly ("memory-safe") {
            for { } 1 { } { }
        }
    }
}

contract GiantRevertVenue is MockVenueBase {
    constructor() MockVenueBase(0) {}

    function getAmountOut(address, address, uint256, bytes calldata)
        external
        pure
        returns (uint256, bytes memory)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, 0x100000))
            revert(ptr, 0x100000)
        }
    }
}

contract OversizedVenue is MockVenueBase {
    constructor() MockVenueBase(0) {}

    function getAmountOut(address, address, uint256, bytes calldata)
        external
        pure
        returns (uint256, bytes memory)
    {
        return (1, new bytes(65_536));
    }
}

contract TieVenue is ViewVenue {
    constructor(uint256 rate) ViewVenue(rate) {}
}

contract UnderDeliveringVenue is MockVenueBase {
    uint256 public immutable DELIVERY_BPS;

    constructor(uint256 rate, uint256 bps) MockVenueBase(rate) {
        DELIVERY_BPS = bps;
    }

    function getAmountOut(address, address, uint256 amountIn, bytes calldata)
        external
        view
        returns (uint256, bytes memory)
    {
        return (_quote(amountIn), bytes(""));
    }

    function swap(
        address tokenIn,
        address tokenOut,
        address to,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256,
        bytes calldata
    ) external override returns (uint256 amountOut) {
        uint256 quoted = _quote(amountIn);
        amountOut = quoted * DELIVERY_BPS / 10_000;
        require(amountOut >= amountOutMin, "min out");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IMintableToken(tokenOut).mint(to, amountOut);
        emit PropAMMSwap(msg.sender, to, tokenIn, tokenOut, amountIn, amountOut);
    }
}

contract OpaqueSwapDataVenue is MockVenueBase {
    string internal constant DATA_TEXT = "0123456789012345678901234567890123456";

    constructor(uint256 rate) MockVenueBase(rate) {}

    function _data() private pure returns (bytes memory) {
        return bytes(DATA_TEXT);
    }

    function getAmountOut(address, address, uint256 amountIn, bytes calldata)
        external
        view
        returns (uint256, bytes memory)
    {
        return (_quote(amountIn), _data());
    }

    function swap(
        address tokenIn,
        address tokenOut,
        address to,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256,
        bytes calldata swapData
    ) external override returns (uint256 amountOut) {
        require(keccak256(swapData) == keccak256(_data()), "wrong data");
        amountOut = _quote(amountIn);
        require(amountOut >= amountOutMin, "min out");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IMintableToken(tokenOut).mint(to, amountOut);
    }
}

contract ReentrantVenue is MockVenueBase {
    R3tardsRouterLab public immutable LAB;

    constructor(uint256 rate, R3tardsRouterLab lab) MockVenueBase(rate) {
        LAB = lab;
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata)
        external
        returns (uint256, bytes memory)
    {
        R3tardsRouterLab.Venue[] memory empty = new R3tardsRouterLab.Venue[](0);
        try LAB.compare(tokenIn, tokenOut, amountIn, empty, 50_000, false) {} catch {}
        try LAB.quoteFrame(address(this), bytes(""), 50_000) {} catch {}
        return (_quote(amountIn), bytes(""));
    }
}
