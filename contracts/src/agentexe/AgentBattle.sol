// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AGENT.EXE war chest and battle record (r3OS season 2 opener)
/// @notice The AI's treasury pays the damage tax into this contract as plain MON transfers. After the battle the
///         owner pays the chest out to the humans (badge holders, pro rata to damage, after the bot review), using
///         the public scoreboard anyone can rebuild from Painted events. The contract also records which of the
///         three 24-hour windows each wallet fought in, so a Painter Pass quest can check `daysFought(wallet) >= 3`.
/// @dev Add-on contract: it never touches the r3OS core. No upgrade path, no token, no approvals.
contract AgentBattle {
    uint64 public immutable START;
    uint64 public immutable END;
    /// @notice After this time the owner may move whatever is left (unclaimable payouts) out of the contract.
    uint64 public immutable RESCUE_AFTER;

    address public owner;
    address public pendingOwner;

    uint256 public totalTaxed;
    uint256 public totalPaid;
    /// @notice Bit k set = the wallet fought in window k (24 h each from START).
    mapping(address wallet => uint8) public windowsFought;
    mapping(address wallet => uint256) public paidTo;

    event Taxed(address indexed from, uint256 amount, uint256 totalTaxed);
    event Fought(address indexed wallet, uint8 windows);
    event Paid(address indexed to, uint256 amount);
    event Rescued(address indexed to, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error BadWindows(address wallet, uint8 windows);
    error LengthMismatch();
    error BattleNotOver();
    error TooEarly();
    error TransferFailed(address to, uint256 amount);
    error ZeroAddress();
    error Reentrancy();

    uint256 private _lock = 1;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(uint64 start, uint64 battleSeconds, uint64 rescueDelaySeconds, address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        START = start;
        END = start + battleSeconds;
        RESCUE_AFTER = start + battleSeconds + rescueDelaySeconds;
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    /// @notice Damage tax arrives here as plain MON transfers from the AI's treasury.
    receive() external payable {
        totalTaxed += msg.value;
        emit Taxed(msg.sender, msg.value, totalTaxed);
    }

    /// @notice Record the windows wallets fought in (bits 0-2). Bits only ever get added.
    function recordFought(address[] calldata wallets, uint8[] calldata windows) external onlyOwner {
        if (wallets.length != windows.length) revert LengthMismatch();
        for (uint256 i; i < wallets.length; ++i) {
            if (windows[i] == 0 || windows[i] > 7) revert BadWindows(wallets[i], windows[i]);
            uint8 next = windowsFought[wallets[i]] | windows[i];
            windowsFought[wallets[i]] = next;
            emit Fought(wallets[i], next);
        }
    }

    /// @notice How many of the three windows a wallet fought in (0-3). Quest condition: >= 3.
    function daysFought(address wallet) external view returns (uint256 n) {
        uint8 w = windowsFought[wallet];
        n = (w & 1) + ((w >> 1) & 1) + ((w >> 2) & 1);
    }

    /// @notice Pay the war chest out after the battle. Can be called in several batches.
    function payout(address[] calldata to, uint256[] calldata amounts) external onlyOwner nonReentrant {
        if (block.timestamp < END) revert BattleNotOver();
        if (to.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < to.length; ++i) {
            if (to[i] == address(0)) revert ZeroAddress();
            totalPaid += amounts[i];
            paidTo[to[i]] += amounts[i];
            (bool ok,) = to[i].call{value: amounts[i]}("");
            if (!ok) revert TransferFailed(to[i], amounts[i]);
            emit Paid(to[i], amounts[i]);
        }
    }

    /// @notice Leftovers (a payout that could not be delivered, rounding dust) after RESCUE_AFTER.
    function rescue(address to) external onlyOwner nonReentrant {
        if (block.timestamp < RESCUE_AFTER) revert TooEarly();
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
        emit Rescued(to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
