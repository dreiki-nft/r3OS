// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockR3tards {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 id) external {
        require(ownerOf[id] == address(0), "already minted");
        ownerOf[id] = to;
        balanceOf[to]++;
    }

    function transfer(uint256 id, address to) external {
        address from = ownerOf[id];
        require(msg.sender == from, "not owner");
        ownerOf[id] = to;
        balanceOf[from]--;
        balanceOf[to]++;
    }
}

