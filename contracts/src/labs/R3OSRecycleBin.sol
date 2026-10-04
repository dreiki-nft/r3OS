// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IR3OSPaintData} from "../interfaces/IR3OSPaintData.sol";
import {IStampSource} from "../interfaces/IStampSource.sol";

interface IR3OSRecycleCore is IR3OSPaintData {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function burn(uint256 tokenId) external;
}

/// @notice Permissionless frame graveyard. Owners explicitly approve or safe-transfer frames to burn them.
/// @dev No owner/admin, no payable entry points, and no custody survives a successful call.
contract R3OSRecycleBin is IERC721Receiver, IStampSource {
    uint256 public constant MAX_RECYCLE = 50;
    uint256 public constant RECYCLER_STAMP_BURNS = 100;

    IR3OSRecycleCore public immutable CORE;
    uint256 public experimentId = type(uint256).max;

    struct Tombstone {
        address minter;
        uint32 season;
        uint48 blockNumber;
        bool storm;
    }

    mapping(address => uint256) public burnedBy;
    uint256 public totalBurned;
    mapping(address => uint256) public lastBurnBlock;
    mapping(uint256 => Tombstone) public tombstone;

    address[10] private _topAddresses;
    uint256[10] private _topCounts;

    error ZeroAddress();
    error InvalidCount(uint256 count);
    error SessionKeyCannotRecycle();
    error NotFrameOwner(uint256 frameId, address owner);
    error BinNotApproved(uint256 frameId);
    error WrongCollection(address collection);
    error ExperimentAlreadyBound();
    error InvalidExperiment(uint256 id);

    event Recycled(address indexed owner, uint256 indexed frameId, uint256 season, uint256 blockNumber);

    constructor(address paintCore) {
        if (paintCore == address(0)) revert ZeroAddress();
        CORE = IR3OSRecycleCore(paintCore);
    }

    function bindExperimentId(uint256 id) external {
        if (experimentId != type(uint256).max) revert ExperimentAlreadyBound();
        IR3OSPaintData.ExperimentData memory info_ = CORE.experimentInfo(id);
        if (info_.experiment != address(this) || info_.retired) revert InvalidExperiment(id);
        experimentId = id;
    }

    function recycle(uint256[] calldata ids) external {
        if (CORE.isActiveSessionKey(msg.sender)) revert SessionKeyCannotRecycle();
        uint256 count = ids.length;
        if (count == 0 || count > MAX_RECYCLE) revert InvalidCount(count);

        for (uint256 i; i < count; ++i) {
            uint256 frameId = ids[i];
            address owner = CORE.ownerOf(frameId);
            if (owner != msg.sender) revert NotFrameOwner(frameId, owner);
            if (!CORE.isApprovedForAll(msg.sender, address(this)) && CORE.getApproved(frameId) != address(this)) {
                revert BinNotApproved(frameId);
            }
            _snapshotAndBurn(msg.sender, frameId);
        }
        _credit(msg.sender, count);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        if (msg.sender != address(CORE)) revert WrongCollection(msg.sender);
        if (CORE.isActiveSessionKey(operator) || CORE.isActiveSessionKey(from)) {
            revert SessionKeyCannotRecycle();
        }
        _snapshotAndBurn(from, tokenId);
        _credit(from, 1);
        return IERC721Receiver.onERC721Received.selector;
    }

    function topBurners() external view returns (address[10] memory burners, uint256[10] memory counts) {
        burners = _topAddresses;
        counts = _topCounts;
    }

    function stamp(address painter) external view returns (string memory name, bool earned) {
        return ("RECYCLER", burnedBy[painter] >= RECYCLER_STAMP_BURNS);
    }

    function _snapshotAndBurn(address creditedOwner, uint256 frameId) private {
        // token #0 has no FrameInfo record. Calling the core directly preserves its canonical NonBurnableToken error.
        if (frameId == 0) {
            CORE.burn(frameId);
            return;
        }

        IR3OSPaintData.FrameInfoData memory info = CORE.frameInfo(frameId);
        tombstone[frameId] = Tombstone({
            minter: info.minter,
            season: info.season,
            blockNumber: info.blockNumber,
            storm: CORE.isStorm(info.blockNumber)
        });
        CORE.burn(frameId);
        emit Recycled(creditedOwner, frameId, info.season, info.blockNumber);
    }

    function _credit(address owner, uint256 count) private {
        uint256 next = burnedBy[owner] + count;
        burnedBy[owner] = next;
        totalBurned += count;
        lastBurnBlock[owner] = block.number;
        _updateTop(owner, next);
    }

    function _updateTop(address owner, uint256 count) private {
        uint256 existing = 10;
        for (uint256 i; i < 10; ++i) {
            if (_topAddresses[i] == owner) {
                existing = i;
                break;
            }
        }

        if (existing < 10) {
            for (uint256 i = existing; i + 1 < 10; ++i) {
                _topAddresses[i] = _topAddresses[i + 1];
                _topCounts[i] = _topCounts[i + 1];
            }
            _topAddresses[9] = address(0);
            _topCounts[9] = 0;
        }

        uint256 insertAt = 10;
        for (uint256 i; i < 10; ++i) {
            if (_topAddresses[i] == address(0) || count > _topCounts[i]) {
                insertAt = i;
                break;
            }
        }
        if (insertAt == 10) return;

        for (uint256 i = 9; i > insertAt; --i) {
            _topAddresses[i] = _topAddresses[i - 1];
            _topCounts[i] = _topCounts[i - 1];
        }
        _topAddresses[insertAt] = owner;
        _topCounts[insertAt] = count;
    }
}
