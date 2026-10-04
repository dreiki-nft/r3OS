// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Standardized, adminless observations of r3OS usage.
/// @dev Live facts are read from existing contracts. Storage records only first observation blocks and observed seasons.
contract R3OSOperatorRecord {
    uint256 public constant SUBSYSTEM_COUNT = 16;
    uint256 public constant IDENTITY_MASK = uint256(1) << 15;
    uint256 public constant SOURCE_GAS = 100_000;
    uint256 public constant PAGE_GAS = 250_000;

    uint32 private constant MAGIC = 0x4f505231; // "OPR1"
    uint256 private constant PAGE_WORDS = 128;

    // v1 protocol ids are immutable history. Discontinued ids remain reserved rather than being reused.
    // Fresh mainnet passes address(0) for those Sources fields, so their predicates remain unanswered forever.
    uint256 public constant PAINT_ID = 0;
    uint256 public constant FRAMES_ID = 1;
    uint256 public constant PASS_ID = 2;
    uint256 public constant QUESTS_ID = 3;
    uint256 public constant FLIPBOOK_ID = 4;
    uint256 public constant WEEDS_ID = 5;
    uint256 public constant FORKS_ID = 6;
    uint256 public constant BLOCK_DNA_ID = 7;
    uint256 public constant AUCTION_ID = 8;
    uint256 public constant SLEEPWALKER_ID = 9;
    uint256 public constant RECYCLE_BIN_ID = 10;
    uint256 public constant BLOCK_CAMERA_ID = 11;
    uint256 public constant KERNEL_DEBUGGER_ID = 12;
    uint256 public constant PAGE_EXE_ID = 13;
    uint256 public constant CARD_DRV_ID = 14;
    uint256 public constant MONAD_CARD_ID = 15;

    bytes4 private constant PAINTER_STATS = bytes4(keccak256("painterStats(address)"));
    bytes4 private constant DAYS_PAINTED = bytes4(keccak256("daysPainted(address)"));
    bytes4 private constant HAS_CLAIMED = bytes4(keccak256("hasClaimed(address)"));
    bytes4 private constant COMPLETED_COUNT = bytes4(keccak256("completedCount(address)"));
    bytes4 private constant PAINTER_INFO = bytes4(keccak256("painterInfo(address)"));
    bytes4 private constant GARDENER_INFO = bytes4(keccak256("gardenerInfo(address)"));
    bytes4 private constant BOX = bytes4(keccak256("box(address)"));
    bytes4 private constant BIDDER_STATS = bytes4(keccak256("bidderStats(address)"));
    bytes4 private constant DREAMING_DAYS = bytes4(keccak256("dreamingDays(address)"));
    bytes4 private constant BURNED_BY = bytes4(keccak256("burnedBy(address)"));
    bytes4 private constant LAST_BURN_BLOCK = bytes4(keccak256("lastBurnBlock(address)"));
    bytes4 private constant LAST_CAPTURE_BLOCK = bytes4(keccak256("lastCaptureBlock(address)"));
    bytes4 private constant PROCESS_COUNT = bytes4(keccak256("processCount(address)"));
    bytes4 private constant LAST_RUN_BLOCK = bytes4(keccak256("lastRunBlock(address)"));
    bytes4 private constant READ_PAGE = bytes4(keccak256("readPage(address)"));
    bytes4 private constant CARD_OF = bytes4(keccak256("cardOf(address)"));
    bytes4 private constant CARD_INFO = bytes4(keccak256("cardInfo(uint256)"));
    bytes4 private constant MONAD_CARD_GETTER = bytes4(keccak256("MONAD_CARD()"));
    bytes4 private constant BALANCE_OF = bytes4(keccak256("balanceOf(address)"));
    bytes4 private constant CURRENT_SEASON = bytes4(keccak256("currentSeason()"));

    // Sources keeps the original v1 tuple layout for compatibility with the fixed record schema.
    // Discontinued source fields are expected to be zero on fresh-mainnet deployments.
    struct Sources {
        address paint;
        address pass;
        address quests;
        address flipbook;
        address weeds;
        address forks;
        address brushes;
        address auction;
        address sleepwalker;
        address recycleBin;
        address blockCamera;
        address kernelDebugger;
        address pageExe;
        address cardMemory;
    }

    struct Facts {
        uint32 activeDays;
        uint32 daysPainted;
        uint96 totalPixels;
        uint48 framesMinted;
        uint48 firstPaintBlock;
        uint48 lastPaintBlock;
        bool passClaimed;
        uint32 questsCompleted;
        uint32 flipbookFrames;
        uint48 flipbookLastBlock;
        uint32 weedsPlants;
        uint32 weedsTicks;
        uint48 weedsLastBlock;
        uint32 forksPainted;
        uint48 lastForkBlock;
        uint32 dnaCatches;
        uint32 dnaVerified;
        uint48 dnaLastBlock;
        uint32 bidsPlaced;
        uint32 auctionsWon;
        uint256 dreamingDays;
        uint256 recycled;
        uint256 lastRecycleBlock;
        uint48 lastCaptureBlock;
        uint256 kernelRuns;
        uint256 lastKernelBlock;
        bool pageNonEmpty;
        bool cardFound;
        uint256 cardId;
        bool cardFormatted;
        uint32 cardWrites;
        uint48 cardFirstWriteBlock;
        uint48 cardLastWriteBlock;
        uint256 monadCardBalance;
        uint256 answeredMask;
    }

    address public immutable PAINT;
    address public immutable PASS;
    address public immutable QUESTS;
    address public immutable FLIPBOOK;
    address public immutable WEEDS;
    address public immutable FORKS;
    address public immutable BRUSHES;
    address public immutable AUCTION;
    address public immutable SLEEPWALKER;
    address public immutable RECYCLE_BIN;
    address public immutable BLOCK_CAMERA;
    address public immutable KERNEL_DEBUGGER;
    address public immutable PAGE_EXE;
    address public immutable CARD_MEMORY;
    address public immutable MONAD_CARD;

    mapping(uint256 => uint48) public seasonFirstRecordBlock;

    error ZeroAddress();
    error NotAContract(address target);
    error BadSubsystem(uint256 subsystem);
    error TooMany();
    error SlotOutOfBounds(uint256 word);

    event OperatorRecorded(
        address indexed operator,
        address indexed recorder,
        uint256 addedMask,
        uint256 observedMask,
        uint256 season,
        bool seasonAdded
    );

    constructor(Sources memory sources) {
        if (sources.paint == address(0)) revert ZeroAddress();
        if (sources.paint.code.length == 0) revert NotAContract(sources.paint);

        PAINT = sources.paint;
        PASS = sources.pass;
        QUESTS = sources.quests;
        FLIPBOOK = sources.flipbook;
        WEEDS = sources.weeds;
        FORKS = sources.forks;
        BRUSHES = sources.brushes;
        AUCTION = sources.auction;
        SLEEPWALKER = sources.sleepwalker;
        RECYCLE_BIN = sources.recycleBin;
        BLOCK_CAMERA = sources.blockCamera;
        KERNEL_DEBUGGER = sources.kernelDebugger;
        PAGE_EXE = sources.pageExe;
        CARD_MEMORY = sources.cardMemory;

        address monadCard;
        if (sources.cardMemory != address(0)) {
            (bool ok, uint256 value) =
                _word(sources.cardMemory, abi.encodeWithSelector(MONAD_CARD_GETTER), 0, SOURCE_GAS);
            if (ok && value >> 160 == 0) monadCard = address(uint160(value));
        }
        MONAD_CARD = monadCard;
    }

    function facts(address operator) external view returns (Facts memory f) {
        return _facts(operator);
    }

    function usedMask(address operator) public view returns (uint256 mask, uint256 answeredMask) {
        Facts memory f = _facts(operator);
        return (_maskFromFacts(f), f.answeredMask);
    }

    function record(address operator) external returns (uint256 addedMask, bool seasonAdded) {
        return _record(operator);
    }

    function recordMany(address[] calldata operators) external {
        if (operators.length > 32) revert TooMany();
        for (uint256 i; i < operators.length; ++i) _record(operators[i]);
    }

    function recordBaseSlot(address operator) public pure returns (uint256) {
        return uint256(keccak256(abi.encode("r3tards.operator.record.v1", operator))) & ~uint256(127);
    }

    function recordOf(address operator)
        public
        view
        returns (
            uint48 firstRecordBlock,
            uint48 lastRecordBlock,
            uint256 observedMask,
            uint256 seasonsObserved,
            uint48[16] memory firstObserved
        )
    {
        uint256 base = recordBaseSlot(operator);
        (firstRecordBlock, lastRecordBlock, observedMask) = _header(_sload(base));
        seasonsObserved = _sload(base + 1);
        for (uint256 i; i < SUBSYSTEM_COUNT; ++i) {
            firstObserved[i] = uint48(_sload(base + 16 + i));
        }
    }

    function firstObservedBlock(address operator, uint256 subsystem) external view returns (uint48) {
        if (subsystem >= SUBSYSTEM_COUNT) revert BadSubsystem(subsystem);
        return uint48(_sload(recordBaseSlot(operator) + 16 + subsystem));
    }

    function usedBefore(address operator, uint256 subsystem, uint256 blockNumber)
        external
        view
        returns (bool proven, bool exact)
    {
        if (subsystem >= SUBSYSTEM_COUNT) revert BadSubsystem(subsystem);

        if (subsystem == PAINT_ID) {
            (bool ok, uint256 value) =
                _word(PAINT, abi.encodeWithSelector(PAINTER_STATS, operator), 4, SOURCE_GAS);
            if (ok && value != 0 && value <= blockNumber) return (true, true);
        } else if (subsystem == CARD_DRV_ID && CARD_MEMORY != address(0)) {
            (bool found, uint256 cardId, bool indexAnswered) = _cardOf(operator);
            if (indexAnswered && found) {
                (bool infoOk, bool formatted,, uint48 firstWriteBlock,) = _cardInfo(cardId);
                if (infoOk && formatted && firstWriteBlock != 0 && firstWriteBlock <= blockNumber) {
                    return (true, true);
                }
            }
        }

        uint48 observed = uint48(_sload(recordBaseSlot(operator) + 16 + subsystem));
        return (observed != 0 && observed <= blockNumber, false);
    }

    function firstSeenBlock(address operator) external view returns (uint256 first) {
        Facts memory f = _facts(operator);
        if (f.firstPaintBlock != 0) first = f.firstPaintBlock;
        if (f.cardFound && f.cardFormatted && f.cardFirstWriteBlock != 0) {
            first = _minNonZero(first, f.cardFirstWriteBlock);
        }

        // MONAD CARD is identity, not r3OS use, so it never sets "first seen".
        uint256 base = recordBaseSlot(operator);
        for (uint256 i; i < SUBSYSTEM_COUNT; ++i) {
            if (i == MONAD_CARD_ID) continue;
            first = _minNonZero(first, _sload(base + 16 + i));
        }
    }

    function observedSubsystemCount(address operator) external view returns (uint256 count) {
        (,, uint256 mask,,) = recordOf(operator);
        mask &= ~IDENTITY_MASK;
        while (mask != 0) {
            count += mask & 1;
            mask >>= 1;
        }
    }

    function _record(address operator) private returns (uint256 addedMask, bool seasonAdded) {
        // Every external read happens before any storage write.
        Facts memory f = _facts(operator);
        uint256 liveMask = _maskFromFacts(f);
        (bool seasonOk, uint256 season) = _word(PAINT, abi.encodeWithSelector(CURRENT_SEASON), 0, SOURCE_GAS);

        uint256 base = recordBaseSlot(operator);
        (uint48 firstRecordBlock,, uint256 observedMask) = _header(_sload(base));
        uint256 seasonsObserved = _sload(base + 1);

        addedMask = liveMask & ~observedMask;

        uint48 seasonStartRecord;
        if (seasonOk) seasonStartRecord = seasonFirstRecordBlock[season];
        uint48 effectiveSeasonStart = seasonStartRecord == 0 ? uint48(block.number) : seasonStartRecord;
        if (
            seasonOk && season < 256 && f.lastPaintBlock != 0 && f.lastPaintBlock >= effectiveSeasonStart
                && (seasonsObserved & (uint256(1) << season)) == 0
        ) {
            seasonAdded = true;
            seasonsObserved |= uint256(1) << season;
        }

        if (seasonOk && seasonStartRecord == 0) seasonFirstRecordBlock[season] = uint48(block.number);

        uint256 newObservedMask = observedMask | addedMask;
        for (uint256 i; i < SUBSYSTEM_COUNT; ++i) {
            uint256 bit = uint256(1) << i;
            if (addedMask & bit != 0) _storeWord(base, 16 + i, block.number);
        }

        if (seasonAdded) _storeWord(base, 1, seasonsObserved);
        if (firstRecordBlock == 0) firstRecordBlock = uint48(block.number);
        _storeWord(base, 0, _packHeader(firstRecordBlock, uint48(block.number), uint16(newObservedMask)));

        if (addedMask != 0 || seasonAdded) {
            emit OperatorRecorded(
                operator,
                msg.sender,
                addedMask,
                newObservedMask,
                seasonOk ? season : type(uint256).max,
                seasonAdded
            );
        }
    }

    function _facts(address operator) private view returns (Facts memory f) {
        // One staticcall per source view; individual words are then read from the returned bytes.
        {
            (bool ok, bytes memory r) = _call(PAINT, abi.encodeWithSelector(PAINTER_STATS, operator), SOURCE_GAS);
            (bool okDays, uint256 daysPainted_) =
                _word(PAINT, abi.encodeWithSelector(DAYS_PAINTED, operator), 0, SOURCE_GAS);
            bool full = ok && r.length >= 6 * 32;
            if (full) {
                f.activeDays = uint32(_at(r, 0));
                f.totalPixels = uint96(_at(r, 2));
                f.framesMinted = uint48(_at(r, 3));
                f.firstPaintBlock = uint48(_at(r, 4));
                f.lastPaintBlock = uint48(_at(r, 5));
                f.answeredMask |= uint256(1) << FRAMES_ID;
            }
            f.daysPainted = uint32(daysPainted_);
            if (full && okDays) f.answeredMask |= uint256(1) << PAINT_ID;
        }

        {
            (bool ok, uint256 value) =
                _word(PASS, abi.encodeWithSelector(HAS_CLAIMED, operator), 0, SOURCE_GAS);
            f.passClaimed = value != 0;
            if (ok) f.answeredMask |= uint256(1) << PASS_ID;
        }

        {
            (bool ok, uint256 value) =
                _word(QUESTS, abi.encodeWithSelector(COMPLETED_COUNT, operator), 0, SOURCE_GAS);
            f.questsCompleted = uint32(value);
            if (ok) f.answeredMask |= uint256(1) << QUESTS_ID;
        }

        {
            (bool ok, bytes memory r) = _call(FLIPBOOK, abi.encodeWithSelector(PAINTER_INFO, operator), SOURCE_GAS);
            if (ok && r.length >= 5 * 32) {
                f.flipbookLastBlock = uint48(_at(r, 0));
                f.flipbookFrames = uint32(_at(r, 4));
                f.answeredMask |= uint256(1) << FLIPBOOK_ID;
            }
        }

        {
            (bool ok, bytes memory r) = _call(WEEDS, abi.encodeWithSelector(GARDENER_INFO, operator), SOURCE_GAS);
            if (ok && r.length >= 3 * 32) {
                f.weedsLastBlock = uint48(_at(r, 0));
                f.weedsPlants = uint32(_at(r, 1));
                f.weedsTicks = uint32(_at(r, 2));
                f.answeredMask |= uint256(1) << WEEDS_ID;
            }
        }

        {
            (bool ok, bytes memory r) = _call(FORKS, abi.encodeWithSelector(PAINTER_INFO, operator), SOURCE_GAS);
            if (ok && r.length >= 2 * 32) {
                f.forksPainted = uint32(_at(r, 0));
                f.lastForkBlock = uint48(_at(r, 1));
                f.answeredMask |= uint256(1) << FORKS_ID;
            }
        }

        {
            (bool ok, bytes memory r) = _call(BRUSHES, abi.encodeWithSelector(BOX, operator), SOURCE_GAS);
            if (ok && r.length >= 13 * 32) {
                f.dnaCatches = uint32(_at(r, 10));
                f.dnaVerified = uint32(_at(r, 11));
                f.dnaLastBlock = uint48(_at(r, 12));
                f.answeredMask |= uint256(1) << BLOCK_DNA_ID;
            }
        }

        {
            (bool ok, bytes memory r) = _call(AUCTION, abi.encodeWithSelector(BIDDER_STATS, operator), SOURCE_GAS);
            if (ok && r.length >= 2 * 32) {
                f.bidsPlaced = uint32(_at(r, 0));
                f.auctionsWon = uint32(_at(r, 1));
                f.answeredMask |= uint256(1) << AUCTION_ID;
            }
        }

        {
            (bool ok, uint256 value) =
                _word(SLEEPWALKER, abi.encodeWithSelector(DREAMING_DAYS, operator), 0, SOURCE_GAS);
            f.dreamingDays = value;
            if (ok) f.answeredMask |= uint256(1) << SLEEPWALKER_ID;
        }

        {
            (bool okBurned, uint256 burned) =
                _word(RECYCLE_BIN, abi.encodeWithSelector(BURNED_BY, operator), 0, SOURCE_GAS);
            (bool okLast, uint256 lastBlock) =
                _word(RECYCLE_BIN, abi.encodeWithSelector(LAST_BURN_BLOCK, operator), 0, SOURCE_GAS);
            f.recycled = burned;
            f.lastRecycleBlock = lastBlock;
            if (okBurned && okLast) f.answeredMask |= uint256(1) << RECYCLE_BIN_ID;
        }

        {
            (bool ok, uint256 value) =
                _word(BLOCK_CAMERA, abi.encodeWithSelector(LAST_CAPTURE_BLOCK, operator), 0, SOURCE_GAS);
            f.lastCaptureBlock = uint48(value);
            if (ok) f.answeredMask |= uint256(1) << BLOCK_CAMERA_ID;
        }

        {
            (bool okRuns, uint256 runs) =
                _word(KERNEL_DEBUGGER, abi.encodeWithSelector(PROCESS_COUNT, operator), 0, SOURCE_GAS);
            (bool okLast, uint256 lastBlock) =
                _word(KERNEL_DEBUGGER, abi.encodeWithSelector(LAST_RUN_BLOCK, operator), 0, SOURCE_GAS);
            f.kernelRuns = runs;
            f.lastKernelBlock = lastBlock;
            if (okRuns && okLast) f.answeredMask |= uint256(1) << KERNEL_DEBUGGER_ID;
        }

        {
            (bool ok, bool nonEmpty) = _pageNonEmpty(operator);
            f.pageNonEmpty = nonEmpty;
            if (ok) f.answeredMask |= uint256(1) << PAGE_EXE_ID;
        }

        {
            (bool found, uint256 cardId, bool indexAnswered) = _cardOf(operator);
            f.cardFound = found;
            f.cardId = cardId;
            if (indexAnswered) {
                if (!found) {
                    f.answeredMask |= uint256(1) << CARD_DRV_ID;
                } else {
                    (bool infoOk, bool formatted, uint32 writes, uint48 firstWriteBlock, uint48 lastWriteBlock) =
                        _cardInfo(cardId);
                    f.cardFormatted = formatted;
                    f.cardWrites = writes;
                    f.cardFirstWriteBlock = firstWriteBlock;
                    f.cardLastWriteBlock = lastWriteBlock;
                    if (infoOk) f.answeredMask |= uint256(1) << CARD_DRV_ID;
                }
            }
        }

        {
            (bool ok, uint256 value) =
                _word(MONAD_CARD, abi.encodeWithSelector(BALANCE_OF, operator), 0, SOURCE_GAS);
            f.monadCardBalance = value;
            if (ok) f.answeredMask |= uint256(1) << MONAD_CARD_ID;
        }
    }

    function _maskFromFacts(Facts memory f) private pure returns (uint256 mask) {
        if (f.firstPaintBlock != 0) mask |= uint256(1) << PAINT_ID;
        if (f.framesMinted != 0) mask |= uint256(1) << FRAMES_ID;
        if (f.passClaimed) mask |= uint256(1) << PASS_ID;
        if (f.questsCompleted != 0) mask |= uint256(1) << QUESTS_ID;
        if (f.flipbookFrames != 0) mask |= uint256(1) << FLIPBOOK_ID;
        if (f.weedsPlants != 0 || f.weedsTicks != 0) mask |= uint256(1) << WEEDS_ID;
        if (f.forksPainted != 0 || f.lastForkBlock != 0) mask |= uint256(1) << FORKS_ID;
        if (f.dnaCatches != 0) mask |= uint256(1) << BLOCK_DNA_ID;
        if (f.bidsPlaced != 0) mask |= uint256(1) << AUCTION_ID;
        if (f.dreamingDays != 0) mask |= uint256(1) << SLEEPWALKER_ID;
        if (f.recycled != 0) mask |= uint256(1) << RECYCLE_BIN_ID;
        if (f.lastCaptureBlock != 0) mask |= uint256(1) << BLOCK_CAMERA_ID;
        if (f.kernelRuns != 0) mask |= uint256(1) << KERNEL_DEBUGGER_ID;
        if (f.pageNonEmpty) mask |= uint256(1) << PAGE_EXE_ID;
        if (f.cardFound && f.cardFormatted) mask |= uint256(1) << CARD_DRV_ID;
        if (f.monadCardBalance != 0) mask |= uint256(1) << MONAD_CARD_ID;
    }

    function _cardOf(address operator) private view returns (bool found, uint256 cardId, bool answered) {
        if (CARD_MEMORY == address(0)) return (false, 0, false);
        (bool ok, bytes memory r) = _call(CARD_MEMORY, abi.encodeWithSelector(CARD_OF, operator), SOURCE_GAS);
        answered = ok && r.length >= 2 * 32;
        if (!answered) return (false, 0, false);
        found = _at(r, 0) != 0;
        cardId = _at(r, 1);
    }

    function _cardInfo(uint256 cardId)
        private
        view
        returns (bool ok, bool formatted, uint32 writes, uint48 firstWriteBlock, uint48 lastWriteBlock)
    {
        (bool success, bytes memory r) = _call(CARD_MEMORY, abi.encodeWithSelector(CARD_INFO, cardId), SOURCE_GAS);
        if (!success || r.length < 9 * 32) return (false, false, 0, 0, 0);
        ok = true;
        formatted = _at(r, 4) != 0;
        writes = uint32(_at(r, 6));
        firstWriteBlock = uint48(_at(r, 7));
        lastWriteBlock = uint48(_at(r, 8));
    }

    function _pageNonEmpty(address operator) private view returns (bool ok, bool nonEmpty) {
        if (PAGE_EXE == address(0) || PAGE_EXE.code.length == 0) return (false, false);
        (bool success, bytes memory data) =
            // forge-lint: disable-next-line(return-bomb)
            PAGE_EXE.staticcall{gas: PAGE_GAS}(abi.encodeWithSelector(READ_PAGE, operator));
        if (!success || data.length < PAGE_WORDS * 32) return (false, false);
        ok = true;
        for (uint256 i; i < PAGE_WORDS; ++i) {
            uint256 value;
            assembly ("memory-safe") { value := mload(add(add(data, 32), mul(i, 32))) }
            if (value != 0) return (true, true);
        }
    }

    /// @dev Gas-capped staticcall; a missing target, revert or out-of-gas returns ok = false.
    function _call(address target, bytes memory data, uint256 gasCap) private view returns (bool ok, bytes memory r) {
        if (target == address(0) || target.code.length == 0) return (false, r);
        // forge-lint: disable-next-line(return-bomb)
        (ok, r) = target.staticcall{gas: gasCap}(data);
    }

    /// @dev Caller checks r.length covers the word first.
    function _at(bytes memory r, uint256 wordIndex) private pure returns (uint256 value) {
        assembly ("memory-safe") { value := mload(add(add(r, 32), mul(wordIndex, 32))) }
    }

    function _word(address target, bytes memory data, uint256 wordIndex, uint256 gasCap)
        private
        view
        returns (bool ok, uint256 value)
    {
        if (target == address(0) || target.code.length == 0) return (false, 0);
        // forge-lint: disable-next-line(return-bomb)
        (bool success, bytes memory result) = target.staticcall{gas: gasCap}(data);
        uint256 offset = wordIndex * 32;
        if (!success || result.length < offset + 32) return (false, 0);
        assembly ("memory-safe") { value := mload(add(add(result, 32), offset)) }
        ok = true;
    }

    function _header(uint256 value)
        private
        pure
        returns (uint48 firstRecordBlock, uint48 lastRecordBlock, uint256 observedMask)
    {
        if (value == 0 || uint32(value >> 224) != MAGIC) return (0, 0, 0);
        firstRecordBlock = uint48(value >> 176);
        lastRecordBlock = uint48(value >> 128);
        observedMask = uint16(value >> 112);
    }

    function _packHeader(uint48 firstRecordBlock, uint48 lastRecordBlock, uint16 observedMask)
        private
        pure
        returns (uint256)
    {
        return (uint256(MAGIC) << 224) | (uint256(firstRecordBlock) << 176) | (uint256(lastRecordBlock) << 128)
            | (uint256(observedMask) << 112);
    }

    function _storeWord(uint256 base, uint256 word, uint256 value) private {
        if (word >= PAGE_WORDS) revert SlotOutOfBounds(word);
        _sstore(base + word, value);
    }

    function _sload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") { value := sload(slot) }
    }

    function _sstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") { sstore(slot, value) }
    }

    function _minNonZero(uint256 a, uint256 b) private pure returns (uint256) {
        if (a == 0) return b;
        if (b == 0) return a;
        return a < b ? a : b;
    }
}
