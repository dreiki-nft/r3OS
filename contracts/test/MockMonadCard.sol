// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Local/testnet-only stand-in for the official mainnet Monad Card.
contract MockMonadCard is ERC721 {
    uint256 private _nextId = 1;
    mapping(address => bool) public claimed;

    error Soulbound();
    error AlreadyClaimed();

    event Locked(uint256 tokenId);

    constructor() ERC721("Mock Monad Card", "MOCKCARD") {}

    function claim() external returns (uint256 id) {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        claimed[msg.sender] = true;
        id = _nextId++;
        _mint(msg.sender, id);
        emit Locked(id);
    }

    function mintTo(address to, uint256 id) external {
        _mint(to, id);
        emit Locked(id);
        if (id >= _nextId && id != type(uint256).max) _nextId = id + 1;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert Soulbound();
    }


    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert Soulbound();
    }
}
