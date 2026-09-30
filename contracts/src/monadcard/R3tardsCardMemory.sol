// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IStampSource} from "../interfaces/IStampSource.sol";

interface IMonadCard721 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice CARD.DRV: one raw MIP-8-sized 4 KiB EEPROM page per Monad Card id.
/// @dev No admin, upgrade, payable, approval or signature path. Writes are authorized only by ownerOf(cardId).
contract R3tardsCardMemory is IStampSource {
    address public constant OFFICIAL_MONAD_CARD = 0x0000CA12D5c07085022eBC74867157449919Fd67;

    uint256 public constant PAGE_WORDS = 128;
    uint256 public constant PAGE_BYTES = 4096;
    uint256 public constant FORMAT_VERSION = 1;

    uint256 public constant LABEL_WORD = 1;
    uint256 public constant ICON_WORD = 2;
    uint256 public constant ICON_WORDS = 16;
    uint256 public constant MESSAGE_WORD = 18;
    uint256 public constant MESSAGE_WORDS = 4;
    uint256 public constant FLAGS_WORD = 22;
    uint256 public constant BUS_WORD = 24;
    uint256 public constant BUS_WORDS = 4;
    uint256 public constant USER_WORD = 32;

    uint32 private constant MAGIC = 0x43415244; // "CARD"
    uint256 private constant SENTINEL = uint256(keccak256("r3tards.card.drv.read.sentinel"));

    address public immutable MONAD_CARD;

    struct CardIndex {
        uint256 cardId;
        bool set;
    }

    struct CardInfo {
        address owner;
        bool exists;
        uint256 pageBaseSlot;
        uint256 pageIndex;
        bool formatted;
        uint8 version;
        uint32 writes;
        uint48 firstWriteBlock;
        uint48 lastWriteBlock;
    }

    mapping(address => CardIndex) private _cardIndex;

    error ZeroAddress();
    error NotAContract(address target);
    error WrongMainnetCard(address target);
    error HeaderReadOnly();
    error BadRange(uint256 wordOffset, uint256 length);
    error CardNotFound(uint256 cardId);
    error NotCardOwner(uint256 cardId, address owner);
    error SentinelHit();

    event CardWritten(
        uint256 indexed cardId,
        address indexed owner,
        uint256 wordOffset,
        uint32 writes,
        bytes32[] words
    );

    constructor(address monadCard) {
        if (monadCard == address(0)) revert ZeroAddress();
        if (monadCard.code.length == 0) revert NotAContract(monadCard);
        if (block.chainid == 143 && monadCard != OFFICIAL_MONAD_CARD) revert WrongMainnetCard(monadCard);
        MONAD_CARD = monadCard;
    }

    function write(uint256 cardId, uint256 wordOffset, bytes32[] calldata words) external {
        uint256 length = words.length;
        if (wordOffset == 0) revert HeaderReadOnly();
        if (wordOffset >= PAGE_WORDS || length == 0 || length > PAGE_WORDS - wordOffset) {
            revert BadRange(wordOffset, length);
        }

        address owner = _ownerOf(cardId);
        if (msg.sender != owner) revert NotCardOwner(cardId, owner);

        uint256 base = pageBaseSlot(cardId);
        for (uint256 i; i < length; ++i) _sstore(base + wordOffset + i, uint256(words[i]));

        uint256 oldHeader = _sload(base);
        (bool formatted,, uint32 writes, uint48 firstWriteBlock,) = _header(oldHeader);
        if (!formatted) firstWriteBlock = uint48(block.number);
        writes += 1;
        uint256 nextHeader = _packHeader(writes, firstWriteBlock, uint48(block.number));
        _sstore(base, nextHeader);

        CardIndex storage index = _cardIndex[msg.sender];
        if (!index.set || index.cardId != cardId) {
            index.cardId = cardId;
            index.set = true;
        }

        emit CardWritten(cardId, msg.sender, wordOffset, writes, words);
    }

    function pageBaseSlot(uint256 cardId) public pure returns (uint256) {
        return uint256(keccak256(abi.encode("r3tards.card.drv.v1", cardId))) & ~uint256(127);
    }

    function pageIndexOf(uint256 cardId) external pure returns (uint256) {
        return pageBaseSlot(cardId) >> 7;
    }

    function cardOwner(uint256 cardId) public view returns (address owner, bool exists) {
        return _tryOwnerOf(cardId);
    }

    function cardInfo(uint256 cardId) external view returns (CardInfo memory info) {
        (address owner, bool exists) = _tryOwnerOf(cardId);
        uint256 base = pageBaseSlot(cardId);
        (bool formatted, uint8 version, uint32 writes, uint48 firstWriteBlock, uint48 lastWriteBlock) =
            _header(_sload(base));
        info = CardInfo({
            owner: owner,
            exists: exists,
            pageBaseSlot: base,
            pageIndex: base >> 7,
            formatted: formatted,
            version: version,
            writes: writes,
            firstWriteBlock: firstWriteBlock,
            lastWriteBlock: lastWriteBlock
        });
    }

    function readPage(uint256 cardId) public view returns (bytes32[128] memory words) {
        uint256 base = pageBaseSlot(cardId);
        for (uint256 i; i < PAGE_WORDS; ++i) words[i] = bytes32(_sload(base + i));
    }

    function readWords(uint256 cardId, uint256 offset, uint256 count) external view returns (bytes32[] memory words) {
        if (offset >= PAGE_WORDS || count > PAGE_WORDS - offset) revert BadRange(offset, count);
        words = new bytes32[](count);
        uint256 base = pageBaseSlot(cardId);
        for (uint256 i; i < count; ++i) words[i] = bytes32(_sload(base + offset + i));
    }

    function pageHash(uint256 cardId) public view returns (bytes32) {
        bytes32[128] memory words = readPage(cardId);
        return keccak256(abi.encode(words));
    }

    function cardOf(address owner) external view returns (bool found, uint256 cardId) {
        CardIndex memory index = _cardIndex[owner];
        if (!index.set) return (false, 0);
        (address current, bool exists) = _tryOwnerOf(index.cardId);
        if (!exists || current != owner) return (false, index.cardId);
        return (true, index.cardId);
    }

    function readCost(uint256 cardId) external view returns (uint256 gasUsed) {
        uint256 base = pageBaseSlot(cardId);
        uint256 beforeGas = gasleft();
        uint256 acc;
        for (uint256 i; i < PAGE_WORDS; ++i) acc ^= _sload(base + i);
        if (acc == SENTINEL) revert SentinelHit();
        gasUsed = beforeGas - gasleft();
    }

    function stamp(address painter) external view returns (string memory name, bool earned) {
        name = "MONAD CARD";
        // Low-level so a revert *or* malformed return data both read as "not earned".
        (bool ok, bytes memory data) = MONAD_CARD.staticcall(
            abi.encodeWithSelector(IMonadCard721.balanceOf.selector, painter)
        );
        earned = ok && data.length >= 32 && abi.decode(data, (uint256)) > 0;
    }

    function _ownerOf(uint256 cardId) private view returns (address owner) {
        bool exists;
        (owner, exists) = _tryOwnerOf(cardId);
        if (!exists) revert CardNotFound(cardId);
    }

    function _tryOwnerOf(uint256 cardId) private view returns (address owner, bool exists) {
        (bool ok, bytes memory data) = MONAD_CARD.staticcall(
            abi.encodeWithSelector(IMonadCard721.ownerOf.selector, cardId)
        );
        if (!ok || data.length < 32) return (address(0), false);
        uint256 raw = abi.decode(data, (uint256));
        if (raw >> 160 != 0) return (address(0), false);
        owner = address(uint160(raw));
        exists = owner != address(0);
    }

    function _header(uint256 value)
        private
        pure
        returns (bool formatted, uint8 version, uint32 writes, uint48 firstWriteBlock, uint48 lastWriteBlock)
    {
        if (value == 0) return (false, 0, 0, 0, 0);
        formatted = uint32(value >> 224) == MAGIC;
        version = uint8(value >> 216);
        writes = uint32(value >> 176);
        firstWriteBlock = uint48(value >> 128);
        lastWriteBlock = uint48(value >> 80);
    }

    function _packHeader(uint32 writes, uint48 firstWriteBlock, uint48 lastWriteBlock)
        private
        pure
        returns (uint256)
    {
        return (uint256(MAGIC) << 224) | (uint256(FORMAT_VERSION) << 216) | (uint256(writes) << 176)
            | (uint256(firstWriteBlock) << 128) | (uint256(lastWriteBlock) << 80);
    }

    function _sload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") { sstore(slot, value) }
    }
}
