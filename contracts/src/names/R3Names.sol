// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title R3Names — `.r3` names for r3OS
/// @notice One plain name per wallet (`dreiki` → shown as `dreiki.r3`). The owner can assign names; once the
///         owner opens registration, any wallet can claim a free name for itself, first come first served.
///         r3OS shows a `.r3` name before a `.nad` name.
/// @dev Add-on contract; it never touches the r3OS core. Names are lowercase a-z, 0-9, `-`, `_`, 1-32 bytes,
///      so nobody can impersonate someone with look-alike Unicode.
contract R3Names is Ownable2Step {
    uint256 public constant MAX_NAME_BYTES = 32;

    bool public registrationOpen;
    mapping(address wallet => string) private _names;
    mapping(bytes32 nameHash => address) private _holders;

    event NameSet(address indexed wallet, string name, bool assignedByOwner);
    event NameCleared(address indexed wallet, string name);
    event RegistrationOpen(bool open);

    error BadName(string name);
    error NameTaken(string name, address holder);
    error LengthMismatch();
    error RegistrationClosed();
    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice The wallet's name without the `.r3` suffix, or "" if it has none.
    function nameOf(address wallet) external view returns (string memory) {
        return _names[wallet];
    }

    /// @notice The wallet holding `name`, or address(0).
    function resolve(string calldata name) external view returns (address) {
        return _holders[keccak256(bytes(name))];
    }

    /// @notice Owner assigns names. Replaces a wallet's previous name.
    function assign(address[] calldata wallets, string[] calldata names) external onlyOwner {
        if (wallets.length != names.length) revert LengthMismatch();
        for (uint256 i; i < wallets.length; ++i) _set(wallets[i], names[i], true);
    }

    /// @notice Open or close self-registration.
    function setRegistrationOpen(bool open) external onlyOwner {
        registrationOpen = open;
        emit RegistrationOpen(open);
    }

    /// @notice Claim a free name for your own wallet (when registration is open). Replaces your previous one.
    function register(string calldata name) external {
        if (!registrationOpen) revert RegistrationClosed();
        _set(msg.sender, name, false);
    }

    /// @notice Give up your own name.
    function release() external {
        _clear(msg.sender);
    }

    /// @notice Moderation: remove a wallet's name.
    function clear(address wallet) external onlyOwner {
        _clear(wallet);
    }

    function validName(string calldata name) public pure returns (bool) {
        bytes calldata b = bytes(name);
        if (b.length == 0 || b.length > MAX_NAME_BYTES) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d || c == 0x5f;
            if (!ok) return false;
        }
        return true;
    }

    function _set(address wallet, string calldata name, bool byOwner) internal {
        if (wallet == address(0)) revert ZeroAddress();
        if (!validName(name)) revert BadName(name);
        bytes32 h = keccak256(bytes(name));
        address holder = _holders[h];
        if (holder == wallet) return;
        if (holder != address(0)) revert NameTaken(name, holder);
        _clear(wallet);
        _names[wallet] = name;
        _holders[h] = wallet;
        emit NameSet(wallet, name, byOwner);
    }

    function _clear(address wallet) internal {
        string memory old = _names[wallet];
        if (bytes(old).length == 0) return;
        delete _holders[keccak256(bytes(old))];
        delete _names[wallet];
        emit NameCleared(wallet, old);
    }
}
