// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockVenueDirectory {
    address[] private _adapters;
    string[] private _labels;
    address public immutable TOKEN0;
    address public immutable TOKEN1;

    constructor(address[] memory adapters_, string[] memory labels_, address token0_, address token1_) {
        require(adapters_.length == labels_.length, "length");
        _adapters = adapters_;
        _labels = labels_;
        TOKEN0 = token0_;
        TOKEN1 = token1_;
    }

    function venues()
        external
        view
        returns (address[] memory adapters, string[] memory labels, address token0, address token1)
    {
        return (_adapters, _labels, TOKEN0, TOKEN1);
    }

    function tokens() external view returns (address wrappedNative, address usd) {
        return (TOKEN0, TOKEN1);
    }
}
