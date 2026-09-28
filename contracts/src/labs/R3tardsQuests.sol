// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IR3tardsPaintData} from "../interfaces/IR3tardsPaintData.sol";
import {IStampSource} from "../interfaces/IStampSource.sol";

/// @notice Append-only display quests whose claims become one cheap Painter Pass stamp.
/// @dev Quests grant no permissions. Conditions are gas-capped staticcalls that copy only one requested return word.
contract R3tardsQuests is Ownable2Step, IStampSource {
    using Strings for uint256;

    struct Condition {
        address target;
        bytes4 selector;
        uint8 word;
        uint8 op; // 0 >= threshold, 1 <= threshold
        uint256 threshold;
    }

    struct Quest {
        string name;
        uint48 startBlock;
        uint48 endBlock;
        Condition[] conditions;
    }

    uint256 public constant MAX_QUESTS = 256;
    uint256 public constant MAX_CONDITIONS = 4;
    uint256 public constant CONDITION_GAS = 150_000;

    error ZeroAddress();
    error NotOpenYet();
    error BadName();
    error BadConditions();
    error BadCondition(uint256 index);
    error BadWindow();
    error TooManyQuests();
    error NoQuest(uint256 questId);
    error QuestNotActive(uint256 questId);
    error AlreadyCompleted(uint256 questId);
    error ConditionNotMet(uint256 questId, uint256 index, uint256 value, uint256 threshold);

    event QuestAdded(uint256 indexed questId, string name, uint48 startBlock, uint48 endBlock);
    event QuestCompleted(address indexed owner, address indexed sender, uint256 indexed questId, uint32 count);

    IR3tardsPaintData public immutable PAINT;
    uint64 public immutable OPEN_TIME;
    Quest[] private _quests;
    mapping(address => uint256) public completedMask;
    mapping(address => uint32) public completedCount;

    constructor(address paintCore, uint64 openTime, address initialOwner) Ownable(initialOwner) {
        if (paintCore == address(0)) revert ZeroAddress();
        PAINT = IR3tardsPaintData(paintCore);
        OPEN_TIME = openTime;
    }

    function addQuest(string calldata name, uint48 startBlock, uint48 endBlock, Condition[] calldata conditions)
        external
        onlyOwner
        returns (uint256 questId)
    {
        if (!_validName(bytes(name))) revert BadName();
        uint256 count = conditions.length;
        if (count == 0 || count > MAX_CONDITIONS) revert BadConditions();
        if (endBlock != 0 && endBlock < startBlock) revert BadWindow();
        if (_quests.length >= MAX_QUESTS) revert TooManyQuests();
        for (uint256 i; i < count; ++i) {
            Condition calldata c = conditions[i];
            if (c.target.code.length == 0 || c.word >= 32 || c.op > 1) revert BadCondition(i);
        }

        questId = _quests.length;
        _quests.push();
        Quest storage q = _quests[questId];
        q.name = name;
        q.startBlock = startBlock;
        q.endBlock = endBlock;
        for (uint256 i; i < count; ++i) q.conditions.push(conditions[i]);
        emit QuestAdded(questId, name, startBlock, endBlock);
    }

    function claim(uint256 questId) external {
        if (block.timestamp < OPEN_TIME) revert NotOpenYet();
        Quest storage q = _quest(questId);
        address owner = _resolveOwner(msg.sender);
        uint256 currentBlock = block.number;
        if (currentBlock < q.startBlock || (q.endBlock != 0 && currentBlock > q.endBlock)) {
            revert QuestNotActive(questId);
        }
        uint256 bit = uint256(1) << questId;
        if ((completedMask[owner] & bit) != 0) revert AlreadyCompleted(questId);

        for (uint256 i; i < q.conditions.length; ++i) {
            Condition memory c = q.conditions[i];
            (bool ok, uint256 value) = _read(c, owner);
            bool passes = ok && (c.op == 0 ? value >= c.threshold : value <= c.threshold);
            if (!passes) revert ConditionNotMet(questId, i, value, c.threshold);
        }

        completedMask[owner] |= bit;
        uint32 count = completedCount[owner] + 1;
        completedCount[owner] = count;
        emit QuestCompleted(owner, msg.sender, questId, count);
    }

    function questCount() external view returns (uint256) {
        return _quests.length;
    }

    function questInfo(uint256 questId)
        external
        view
        returns (string memory name, uint48 startBlock, uint48 endBlock, Condition[] memory conditions)
    {
        Quest storage q = _quest(questId);
        name = q.name;
        startBlock = q.startBlock;
        endBlock = q.endBlock;
        conditions = q.conditions;
    }

    function progress(address painter, uint256 questId)
        external
        view
        returns (uint256[] memory values, bool[] memory passing)
    {
        Quest storage q = _quest(questId);
        uint256 n = q.conditions.length;
        values = new uint256[](n);
        passing = new bool[](n);
        for (uint256 i; i < n; ++i) {
            Condition memory c = q.conditions[i];
            (bool ok, uint256 value) = _read(c, painter);
            values[i] = value;
            passing[i] = ok && (c.op == 0 ? value >= c.threshold : value <= c.threshold);
        }
    }

    function claimable(address painter) external view returns (uint256 mask) {
        uint256 done = completedMask[painter];
        uint256 currentBlock = block.number;
        for (uint256 questId; questId < _quests.length; ++questId) {
            uint256 bit = uint256(1) << questId;
            if ((done & bit) != 0) continue;
            Quest storage q = _quests[questId];
            if (currentBlock < q.startBlock || (q.endBlock != 0 && currentBlock > q.endBlock)) continue;
            bool allPassing = true;
            for (uint256 i; i < q.conditions.length; ++i) {
                Condition memory c = q.conditions[i];
                (bool ok, uint256 value) = _read(c, painter);
                if (!ok || (c.op == 0 ? value < c.threshold : value > c.threshold)) {
                    allPassing = false;
                    break;
                }
            }
            if (allPassing) mask |= bit;
        }
    }

    function stamp(address painter) external view returns (string memory name, bool earned) {
        uint32 count = completedCount[painter];
        return (string.concat("QUESTS ", uint256(count).toString()), count >= 1);
    }

    function _read(Condition memory c, address painter) internal view returns (bool ok, uint256 value) {
        bytes memory data = abi.encodeWithSelector(c.selector, painter);
        address target = c.target;
        uint256 w = c.word;
        assembly ("memory-safe") {
            ok := staticcall(CONDITION_GAS, target, add(data, 0x20), mload(data), 0, 0)
            if ok {
                if lt(returndatasize(), mul(add(w, 1), 32)) { ok := 0 }
                if ok {
                    returndatacopy(0, mul(w, 32), 32)
                    value := mload(0)
                }
            }
        }
    }

    function _resolveOwner(address sender) private view returns (address owner) {
        (address sessionOwner,,,,, bool active) = PAINT.sessionInfo(sender);
        owner = active ? sessionOwner : sender;
    }

    function _quest(uint256 questId) private view returns (Quest storage q) {
        if (questId >= _quests.length) revert NoQuest(questId);
        return _quests[questId];
    }

    function _validName(bytes memory name) private pure returns (bool) {
        if (name.length == 0 || name.length > 20) return false;
        for (uint256 i; i < name.length; ++i) {
            uint8 c = uint8(name[i]);
            if (c < 0x20 || c > 0x7e || c == 0x22 || c == 0x5c || c == 0x3c || c == 0x3e || c == 0x26) {
                return false;
            }
        }
        return true;
    }
}
