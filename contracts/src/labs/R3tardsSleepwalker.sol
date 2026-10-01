// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DynamicBufferLib} from "solady/utils/DynamicBufferLib.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {R3tardsLabs} from "../R3tardsLabs.sol";
import {IR3tardsSleepwalkerCore} from "../interfaces/IR3tardsSleepwalkerCore.sol";
import {ILabTokenSource} from "../interfaces/ILabTokenSource.sol";
import {IStampSource} from "../interfaces/IStampSource.sol";
import {FrameStore} from "../lib/FrameStore.sol";
import {LabTraits} from "../lib/LabTraits.sol";
import {SleepwalkerKey} from "./SleepwalkerKey.sol";

/// @notice A stencil that paints through the owner's own pre-signed core sessions while other players crank it.
contract R3tardsSleepwalker is ReentrancyGuard, ILabTokenSource, IStampSource {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;
    using Strings for uint256;

    uint256 public constant DREAM_RATIO = 2;
    uint256 public constant MAX_STENCIL_PIXELS = 4_096;
    uint256 public constant MAX_SESSIONS = 4;
    uint256 public constant STEP_MAX_PX = 64;
    uint256 public constant MIN_STEP_BLOCKS = 100;
    uint256 public constant MAX_SURVIVAL_SAMPLES = 128;
    uint256 private constant REFUND_GAS_LIMIT = 30_000;
    bytes4 private constant NO_CHANGE_SELECTOR = bytes4(keccak256("NoChange()"));

    IR3tardsSleepwalkerCore public immutable PAINT;
    R3tardsLabs public immutable LABS;
    address public immutable KEY_IMPLEMENTATION;
    uint256 public experimentId = type(uint256).max;

    enum StepCode {
        Painted,
        Complete,
        NoDream,
        NoSession,
        Stalled,
        NotPaintedToday,
        Allowance,
        Pace,
        Budget,
        CoreRejected,
        Skipped
    }

    struct StartSessionAuthorization {
        uint256 expiryBlock;
        uint256 maxUnits;
        uint256 nonce;
        uint256 deadline;
        bytes sig;
    }

    struct StoredSession {
        uint48 expiryBlock;
        uint96 maxUnits;
        uint256 nonce;
        uint256 deadline;
        bytes sig;
    }

    struct DreamState {
        address stencilPointer;
        uint32 cursor;
        uint32 totalPixels;
        uint32 runOffset;
        uint16 runSkip;
        uint128 deposit;
        uint128 tipPerStep;
        uint48 lastStepBlock;
        uint32 steps;
        uint32 pixelsDreamt;
        uint16 helpers;
        uint8 nextSession;
        uint32 sessionsUsed;
        uint64 dreamId;
        bool sleeping;
        bool stalled;
        bool complete;
        bool minted;
    }

    struct DreamDay {
        uint48 dayBucket;
        uint32 pixels;
    }

    struct DreamTokenData {
        address stencilPointer;
        uint32 totalStencilPixels;
        uint32 pixelsDreamt;
        uint32 steps;
        uint32 dreamingDays;
        uint16 helpers;
        uint16 survivalBps;
        uint128 mismatchMask;
        uint32 nights;
        uint8 sampleCount;
        uint8 dominantColour;
        uint8 coloursUsed;
        bool complete;
    }

    mapping(address => DreamState) private _dreams;
    mapping(address => StoredSession[]) private _sessions;
    mapping(address => uint256[]) private _holderIds;
    mapping(address => DreamDay) private _dreamDays;
    mapping(address => uint32) private _dreamingDays;
    mapping(address => uint48) private _lastDreamDay;
    mapping(address => uint64) private _dreamNonce;
    mapping(address => uint256) public refunds;
    mapping(address => mapping(address => uint64)) private _callerSeenDream;
    mapping(uint256 => DreamTokenData) private _dreamTokens;

    error ZeroAddress();
    error AlreadySleeping();
    error NoDream();
    error InvalidStencil();
    error TooManyStencilPixels(uint256 pixels);
    error InvalidSessionCount();
    error InvalidSessionNonce(uint256 index, uint256 expected, uint256 supplied);
    error InvalidSessionWindow(uint256 index);
    error InvalidSessionUnits(uint256 index);
    error InvalidTip();
    error ValueTooLarge();
    error RefundFailed();
    error TipTransferFailed();
    error ExperimentAlreadyBound();
    error InvalidExperiment(uint256 experimentId);
    error ExperimentNotBound();
    error DreamAlreadyMinted();
    error NotStalled();
    error NoRefund();

    event Slept(
        address indexed owner,
        address indexed key,
        address stencilPointer,
        uint256 totalPixels,
        uint256 sessions,
        uint256 tipPerStep,
        uint256 deposit
    );
    event SessionStarted(address indexed owner, address indexed key, uint256 indexed sessionIndex, uint256 nonce);
    event StepResult(address indexed owner, address indexed caller, StepCode code, bytes reason);
    event Dreamt(
        address indexed owner,
        uint256 cursorFrom,
        uint256 cursorTo,
        uint256 pixels,
        uint256 blockNumber
    );
    event DreamComplete(address indexed owner, uint256 pixelsDreamt, uint256 steps);
    event DreamStalled(address indexed owner, uint256 blockNumber);
    event DreamResumed(address indexed owner, uint256 sessions);
    event RefundCredited(address indexed owner, uint256 amount);
    event RefundWithdrawn(address indexed owner, uint256 amount);
    event Woke(address indexed owner, uint256 refund);
    event DreamMinted(address indexed owner, uint256 indexed tokenId, bool complete, uint256 survivalBps);

    constructor(address paintCore, address labs, address keyImplementation) {
        if (paintCore == address(0) || labs == address(0) || keyImplementation == address(0)) {
            revert ZeroAddress();
        }
        PAINT = IR3tardsSleepwalkerCore(paintCore);
        LABS = R3tardsLabs(labs);
        KEY_IMPLEMENTATION = keyImplementation;
    }

    function bindExperimentId(uint256 id) external {
        if (experimentId != type(uint256).max) revert ExperimentAlreadyBound();
        IR3tardsSleepwalkerCore.ExperimentData memory info_ = PAINT.experimentInfo(id);
        (address experiment, bool retired) = (info_.experiment, info_.retired);
        if (experiment != address(this) || retired) revert InvalidExperiment(id);
        experimentId = id;
    }

    function keyOf(address owner) public view returns (address) {
        return Clones.predictDeterministicAddress(KEY_IMPLEMENTATION, _keySalt(owner), address(this));
    }

    function sleep(
        bytes calldata stencilRuns,
        uint256[] calldata holderIds,
        StartSessionAuthorization[] calldata sessions,
        uint256 tipPerStep
    ) external payable nonReentrant {
        address owner = msg.sender;
        DreamState storage existing = _dreams[owner];
        if (existing.sleeping) revert AlreadySleeping();
        if (tipPerStep == 0) revert InvalidTip();
        if (tipPerStep > type(uint128).max || msg.value > type(uint128).max) revert ValueTooLarge();

        uint256 totalPixels = _validateStencil(stencilRuns);
        if (totalPixels == 0) revert InvalidStencil();
        if (totalPixels > MAX_STENCIL_PIXELS) revert TooManyStencilPixels(totalPixels);
        if (sessions.length == 0 || sessions.length > MAX_SESSIONS) revert InvalidSessionCount();

        // This reuses the core's owner/duplicate checks for the holder quota ids.
        PAINT.budgetOf(owner, holderIds);
        _validateSessions(owner, sessions);

        delete _sessions[owner];
        delete _holderIds[owner];
        delete _dreams[owner];

        for (uint256 i; i < holderIds.length; ++i) _holderIds[owner].push(holderIds[i]);
        _storeSessions(owner, sessions);

        uint64 dreamId = ++_dreamNonce[owner];
        address pointer = _writeStencil(stencilRuns);
        DreamState storage dream = _dreams[owner];
        dream.stencilPointer = pointer;
        dream.totalPixels = uint32(totalPixels);
        dream.deposit = uint128(msg.value);
        dream.tipPerStep = uint128(tipPerStep);
        dream.dreamId = dreamId;
        dream.sleeping = true;

        address key = _ensureKey(owner);
        StoredSession storage first = _sessions[owner][0];
        // forge-lint: disable-start(reentrancy-no-eth)
        SleepwalkerKey(key).start(
            owner,
            first.expiryBlock,
            first.maxUnits,
            first.nonce,
            first.deadline,
            first.sig
        );
        // forge-lint: disable-end(reentrancy-no-eth)
        dream.nextSession = 1;
        dream.sessionsUsed = 1;
        emit SessionStarted(owner, key, 0, first.nonce);
        emit Slept(owner, key, pointer, totalPixels, sessions.length, tipPerStep, msg.value);
    }

    function resume(StartSessionAuthorization[] calldata sessions) external nonReentrant {
        address owner = msg.sender;
        DreamState storage dream = _dreams[owner];
        if (!dream.sleeping) revert NotStalled();
        address key = keyOf(owner);
        if (key.code.length != 0) {
            (,,,,, bool active) = PAINT.sessionInfo(key);
            if (active) revert NotStalled();
        }
        if (sessions.length == 0 || sessions.length > MAX_SESSIONS) revert InvalidSessionCount();

        _validateSessions(owner, sessions);
        delete _sessions[owner];
        _storeSessions(owner, sessions);
        dream.nextSession = 0;
        dream.stalled = false;

        key = _ensureKey(owner);
        StoredSession storage first = _sessions[owner][0];
        // forge-lint: disable-start(reentrancy-no-eth)
        SleepwalkerKey(key).start(
            owner,
            first.expiryBlock,
            first.maxUnits,
            first.nonce,
            first.deadline,
            first.sig
        );
        // forge-lint: disable-end(reentrancy-no-eth)
        dream.nextSession = 1;
        ++dream.sessionsUsed;
        emit SessionStarted(owner, key, 0, first.nonce);
        emit DreamResumed(owner, sessions.length);
    }

    function withdrawRefund() external nonReentrant {
        _withdrawRefundTo(msg.sender, msg.sender);
    }

    function withdrawRefundTo(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _withdrawRefundTo(msg.sender, to);
    }

    function step(address owner) external nonReentrant returns (StepCode code, bytes memory reason) {
        DreamState storage dream = _dreams[owner];
        if (!dream.sleeping) {
            return _stepResult(owner, dream.complete ? StepCode.Complete : StepCode.NoDream, bytes(""));
        }
        if (dream.stalled) return _stepResult(owner, StepCode.Stalled, bytes(""));

        (bool sessionReady, uint256 sessionAvailable, bytes memory sessionReason) =
            _ensureActiveSession(owner, dream);
        if (!sessionReady) {
            return _stepResult(owner, dream.stalled ? StepCode.Stalled : StepCode.NoSession, sessionReason);
        }

        (,, uint256 allowance, bool dayPasses) = allowanceOf(owner);
        if (!dayPasses) return _stepResult(owner, StepCode.NotPaintedToday, bytes(""));
        if (allowance == 0) return _stepResult(owner, StepCode.Allowance, bytes(""));
        if (dream.lastStepBlock != 0 && block.number < uint256(dream.lastStepBlock) + MIN_STEP_BLOCKS) {
            return _stepResult(owner, StepCode.Pace, bytes(""));
        }

        uint256[] memory holderIds = _copyHolderIds(owner);
        uint256 totalAvailable;
        try PAINT.budgetOf(owner, holderIds) returns (
            uint256,
            uint256,
            uint256 available,
            uint256,
            uint32
        ) {
            totalAvailable = available;
        } catch (bytes memory budgetReason) {
            return _stepResult(owner, StepCode.Budget, budgetReason);
        }

        address key = keyOf(owner);
        uint256 limit = allowance;
        if (limit > STEP_MAX_PX) limit = STEP_MAX_PX;
        uint256 budgetPixels = totalAvailable / 2;
        if (limit > budgetPixels) limit = budgetPixels;
        uint256 sessionPixels = sessionAvailable / 2;
        if (limit > sessionPixels) limit = sessionPixels;
        if (limit == 0) return _stepResult(owner, StepCode.Budget, bytes(""));

        bytes memory stencil = FrameStore.read(dream.stencilPointer);
        (bytes memory chunk, uint32 nextRunOffset, uint16 nextRunSkip, uint32 requestedPixels) =
            _buildChunk(stencil, dream.runOffset, dream.runSkip, limit);
        if (requestedPixels == 0) return _stepResult(owner, StepCode.Complete, bytes(""));
        uint32 cursorTo = dream.cursor + requestedPixels;

        uint32 beforePixels = _pixelsToday(owner);
        // forge-lint: disable-next-line(reentrancy-no-eth)
        try SleepwalkerKey(key).paint(chunk, holderIds) {
            uint32 afterPixels = _pixelsToday(owner);
            uint32 painted = afterPixels >= beforePixels ? afterPixels - beforePixels : 0;
            uint32 cursorFrom = dream.cursor;
            dream.cursor = cursorTo;
            dream.runOffset = nextRunOffset;
            dream.runSkip = nextRunSkip;
            dream.lastStepBlock = uint48(block.number);
            ++dream.steps;
            _addDreamPixels(owner, painted);
            dream.pixelsDreamt += painted;
            _recordHelper(owner, dream);

            uint256 tip;
            if (dream.deposit >= dream.tipPerStep) {
                tip = dream.tipPerStep;
                dream.deposit -= dream.tipPerStep;
            }

            emit Dreamt(owner, cursorFrom, cursorTo, painted, block.number);
            bool completed = cursorTo >= dream.totalPixels;
            uint256 refund;
            if (completed) {
                dream.complete = true;
                dream.sleeping = false;
                refund = dream.deposit;
                dream.deposit = 0;
                delete _sessions[owner];
                delete _holderIds[owner];
                emit DreamComplete(owner, dream.pixelsDreamt, dream.steps);
            }

            if (tip != 0) _send(msg.sender, tip, false);
            if (refund != 0) _refundOrCredit(owner, refund);
            return _stepResult(owner, completed ? StepCode.Complete : StepCode.Painted, bytes(""));
        } catch (bytes memory paintReason) {
            if (_selector(paintReason) != NO_CHANGE_SELECTOR) {
                return _stepResult(owner, StepCode.CoreRejected, paintReason);
            }

            uint32 cursorFrom = dream.cursor;
            dream.cursor = cursorTo;
            dream.runOffset = nextRunOffset;
            dream.runSkip = nextRunSkip;
            dream.lastStepBlock = uint48(block.number);
            ++dream.steps;
            emit Dreamt(owner, cursorFrom, cursorTo, 0, block.number);

            if (cursorTo >= dream.totalPixels) {
                dream.complete = true;
                dream.sleeping = false;
                uint256 refund = dream.deposit;
                dream.deposit = 0;
                delete _sessions[owner];
                delete _holderIds[owner];
                emit DreamComplete(owner, dream.pixelsDreamt, dream.steps);
                if (refund != 0) _refundOrCredit(owner, refund);
            }
            return _stepResult(owner, StepCode.Skipped, bytes(""));
        }
    }

    function wake() external nonReentrant {
        address owner = msg.sender;
        DreamState storage dream = _dreams[owner];
        if (dream.stencilPointer == address(0)) revert NoDream();
        uint256 refund = dream.deposit;
        dream.deposit = 0;
        delete _sessions[owner];
        delete _holderIds[owner];
        delete _dreams[owner];
        emit Woke(owner, refund);
        if (refund != 0) _refundOrCredit(owner, refund);
    }

    function mintDream() external returns (uint256 tokenId) {
        address owner = msg.sender;
        DreamState storage dream = _dreams[owner];
        if (dream.stencilPointer == address(0)) revert NoDream();
        if (dream.minted) revert DreamAlreadyMinted();
        uint256 boundExperimentId = experimentId;
        if (boundExperimentId == type(uint256).max) revert ExperimentNotBound();

        bytes memory stencil = FrameStore.read(dream.stencilPointer);
        (uint16 survivalBps, uint8 sampleCount, uint128 mismatchMask) = _sampleSurvival(stencil, dream.totalPixels);
        (uint8 dominantColour, uint8 coloursUsed) = _colourStats(stencil);
        uint32 dreamPixels = dream.pixelsDreamt;

        tokenId = LABS.mint(owner, boundExperimentId);
        _dreamTokens[tokenId] = DreamTokenData({
            stencilPointer: dream.stencilPointer,
            totalStencilPixels: dream.totalPixels,
            pixelsDreamt: dreamPixels,
            steps: dream.steps,
            dreamingDays: _dreamingDays[owner],
            helpers: dream.helpers,
            survivalBps: survivalBps,
            mismatchMask: mismatchMask,
            nights: dream.sessionsUsed,
            sampleCount: sampleCount,
            dominantColour: dominantColour,
            coloursUsed: coloursUsed,
            complete: dream.complete
        });
        dream.minted = true;
        emit DreamMinted(owner, tokenId, dream.complete, survivalBps);
    }

    function dreamOf(address owner) external view returns (
        address stencilPointer,
        uint256 cursor,
        uint256 totalPixels,
        uint256 deposit,
        uint256 tip,
        uint256 sessionsLeft,
        uint256 nextStepBlock,
        bool stalled
    ) {
        DreamState storage dream = _dreams[owner];
        stencilPointer = dream.stencilPointer;
        cursor = dream.cursor;
        totalPixels = dream.totalPixels;
        deposit = dream.deposit;
        tip = dream.tipPerStep;
        uint256 count = _sessions[owner].length;
        sessionsLeft = dream.nextSession >= count ? 0 : count - dream.nextSession;
        nextStepBlock = dream.lastStepBlock == 0 ? block.number : uint256(dream.lastStepBlock) + MIN_STEP_BLOCKS;
        stalled = dream.stalled;
        if (!stalled && dream.sleeping) {
            (, bool wouldStall,) = _sessionPreview(owner, dream);
            stalled = wouldStall;
        }
    }

    function allowanceOf(address owner)
        public
        view
        returns (uint256 humanPixelsToday, uint256 dreamPixelsToday_, uint256 allowance, bool dayPasses)
    {
        uint32 pixelsToday = _pixelsToday(owner);
        dreamPixelsToday_ = _dreamPixelsToday(owner);
        humanPixelsToday = pixelsToday >= dreamPixelsToday_ ? pixelsToday - dreamPixelsToday_ : 0;
        uint256 minimum = PAINT.MIN_PIXELS_FOR_ACTIVE_DAY();
        dayPasses = humanPixelsToday >= minimum;
        if (!dayPasses) return (humanPixelsToday, dreamPixelsToday_, 0, false);
        uint256 earned = DREAM_RATIO * humanPixelsToday;
        allowance = earned > dreamPixelsToday_ ? earned - dreamPixelsToday_ : 0;
    }

    function dreamingDays(address owner) external view returns (uint256) {
        return _dreamingDays[owner];
    }

    function stepReady(address[] calldata owners) external view returns (bool[] memory ready) {
        ready = new bool[](owners.length);
        for (uint256 i; i < owners.length; ++i) ready[i] = _stepReady(owners[i]);
    }

    function stamp(address owner) external view returns (string memory name, bool earned) {
        uint256 days_ = _dreamingDays[owner];
        name = string.concat("DREAMING DAYS ", days_.toString());
        earned = days_ >= 1;
    }

    function labToken(uint256 tokenId) external view returns (
        string memory kind,
        string memory description,
        bytes memory imageSvg,
        string memory attributes,
        uint8 dominantColour,
        uint8 coloursUsed
    ) {
        DreamTokenData storage data = _dreamTokens[tokenId];
        if (data.stencilPointer == address(0)) revert NoDream();

        bytes memory stencil = FrameStore.read(data.stencilPointer);
        kind = "Dream";
        description = "a Sleepwalker stencil painted onto the shared r3tards canvas through its owner's signed sessions.";
        imageSvg = _dreamSvg(stencil, data.totalStencilPixels, data.sampleCount, data.mismatchMask);
        attributes = string(
            abi.encodePacked(
                ',{"trait_type":"Pixels dreamt","display_type":"number","value":',
                uint256(data.pixelsDreamt).toString(),
                '}',
                ',{"trait_type":"Size","value":"',
                LabTraits.dreamSize(data.pixelsDreamt),
                '"}',
                ',{"trait_type":"Nights","display_type":"number","value":',
                uint256(data.nights).toString(),
                '}',
                ',{"trait_type":"Steps","display_type":"number","value":',
                uint256(data.steps).toString(),
                '}',
                ',{"trait_type":"Helpers","display_type":"number","value":',
                uint256(data.helpers).toString(),
                '}',
                ',{"trait_type":"Night shift","value":"',
                LabTraits.nightShift(data.helpers),
                '"}',
                ',{"trait_type":"Complete","value":"',
                data.complete ? "yes" : "no",
                '"}',
                ',{"trait_type":"Dreaming days","display_type":"number","value":',
                uint256(data.dreamingDays).toString(),
                '}',
                ',{"trait_type":"Survived at mint","value":"',
                LabTraits.survival(data.survivalBps),
                '"}'
            )
        );
        dominantColour = data.dominantColour;
        coloursUsed = data.coloursUsed;
    }

    function canBurn(uint256 tokenId) external view returns (bool) {
        return _dreamTokens[tokenId].stencilPointer != address(0);
    }

    function dreamToken(uint256 tokenId) external view returns (DreamTokenData memory) {
        DreamTokenData memory data = _dreamTokens[tokenId];
        if (data.stencilPointer == address(0)) revert NoDream();
        return data;
    }

    function _storeSessions(address owner, StartSessionAuthorization[] calldata sessions) private {
        for (uint256 i; i < sessions.length; ++i) {
            StartSessionAuthorization calldata input = sessions[i];
            _sessions[owner].push();
            StoredSession storage stored = _sessions[owner][_sessions[owner].length - 1];
            stored.expiryBlock = uint48(input.expiryBlock);
            stored.maxUnits = uint96(input.maxUnits);
            stored.nonce = input.nonce;
            stored.deadline = input.deadline;
            stored.sig = input.sig;
        }
    }

    function _validateSessions(address owner, StartSessionAuthorization[] calldata sessions) private view {
        uint256 expectedNonce = PAINT.sessionNonces(owner);
        uint256 maxBlocks = PAINT.MAX_SESSION_BLOCKS();
        uint256 previousExpiry;
        for (uint256 i; i < sessions.length; ++i) {
            StartSessionAuthorization calldata session = sessions[i];
            if (session.nonce != expectedNonce + i) {
                revert InvalidSessionNonce(i, expectedNonce + i, session.nonce);
            }
            if (session.maxUnits == 0 || session.maxUnits > type(uint96).max) revert InvalidSessionUnits(i);
            if (session.expiryBlock > type(uint48).max || session.expiryBlock <= block.number) {
                revert InvalidSessionWindow(i);
            }
            if (i == 0) {
                if (session.expiryBlock > block.number + maxBlocks) revert InvalidSessionWindow(i);
            } else if (session.expiryBlock != previousExpiry + maxBlocks) {
                revert InvalidSessionWindow(i);
            }
            if (session.deadline < block.timestamp) revert InvalidSessionWindow(i);
            previousExpiry = session.expiryBlock;
        }
    }

    function _ensureKey(address owner) private returns (address key) {
        key = keyOf(owner);
        if (key.code.length == 0) {
            key = Clones.cloneDeterministic(KEY_IMPLEMENTATION, _keySalt(owner));
            // forge-lint: disable-next-line(reentrancy-no-eth)
            SleepwalkerKey(key).initialize(address(PAINT));
        }
    }

    function _ensureActiveSession(address owner, DreamState storage dream)
        private
        returns (bool ready, uint256 unitsAvailable, bytes memory reason)
    {
        address key = keyOf(owner);
        if (key.code.length == 0) return (false, 0, bytes("key not deployed"));
        (address sessionOwner,, uint256 maxUnits, uint256 unitsSpent,, bool active) = PAINT.sessionInfo(key);
        if (active) {
            if (sessionOwner != owner) return (false, 0, bytes("wrong owner"));
            unitsAvailable = maxUnits > unitsSpent ? maxUnits - unitsSpent : 0;
            return (true, unitsAvailable, bytes(""));
        }

        StoredSession[] storage sessions = _sessions[owner];
        uint256 currentNonce = PAINT.sessionNonces(owner);
        while (dream.nextSession < sessions.length) {
            uint256 index = dream.nextSession;
            StoredSession storage session = sessions[index];
            if (session.nonce < currentNonce) {
                ++dream.nextSession;
                continue;
            }
            if (session.nonce > currentNonce) {
                _markStalled(owner, dream);
                return (false, 0, bytes("nonce gap"));
            }
            if (session.expiryBlock <= block.number || session.deadline < block.timestamp) {
                ++dream.nextSession;
                _markStalled(owner, dream);
                return (false, 0, bytes("session window missed"));
            }
            if (session.expiryBlock > block.number + PAINT.MAX_SESSION_BLOCKS()) {
                return (false, 0, bytes("session window not open"));
            }

            try SleepwalkerKey(key).start(
                owner,
                session.expiryBlock,
                session.maxUnits,
                session.nonce,
                session.deadline,
                session.sig
            ) {
                ++dream.nextSession;
                ++dream.sessionsUsed;
                emit SessionStarted(owner, key, index, session.nonce);
                return (true, session.maxUnits, bytes(""));
            } catch (bytes memory startReason) {
                return (false, 0, startReason);
            }
        }
        _markStalled(owner, dream);
        return (false, 0, bytes("no sessions left"));
    }

    function _stepReady(address owner) private view returns (bool) {
        DreamState storage dream = _dreams[owner];
        if (!dream.sleeping || dream.stalled || dream.cursor >= dream.totalPixels) return false;
        if (dream.deposit < dream.tipPerStep) return false;

        (bool sessionReady, bool wouldStall, uint256 sessionAvailable) = _sessionPreview(owner, dream);
        if (!sessionReady || wouldStall || sessionAvailable < 2) return false;

        (,,, uint256 allowance, bool dayPasses) = _allowanceTuple(owner);
        if (!dayPasses || allowance == 0) return false;
        if (dream.lastStepBlock != 0 && block.number < uint256(dream.lastStepBlock) + MIN_STEP_BLOCKS) return false;

        uint256[] memory holderIds = _copyHolderIds(owner);
        try PAINT.budgetOf(owner, holderIds) returns (uint256, uint256, uint256 available, uint256, uint32) {
            uint256 limit = allowance;
            if (limit > STEP_MAX_PX) limit = STEP_MAX_PX;
            uint256 budgetPixels = available / 2;
            if (limit > budgetPixels) limit = budgetPixels;
            uint256 sessionPixels = sessionAvailable / 2;
            if (limit > sessionPixels) limit = sessionPixels;
            if (limit == 0) return false;

            bytes memory stencil = FrameStore.read(dream.stencilPointer);
            (bytes memory chunk,,, uint32 requestedPixels) =
                _buildChunk(stencil, dream.runOffset, dream.runSkip, limit);
            return requestedPixels != 0 && _chunkWouldChange(chunk);
        } catch {
            return false;
        }
    }

    function _allowanceTuple(address owner)
        private
        view
        returns (uint256 pixelsToday, uint256 dreamToday, uint256 human, uint256 allowance, bool dayPasses)
    {
        pixelsToday = _pixelsToday(owner);
        dreamToday = _dreamPixelsToday(owner);
        human = pixelsToday >= dreamToday ? pixelsToday - dreamToday : 0;
        dayPasses = human >= PAINT.MIN_PIXELS_FOR_ACTIVE_DAY();
        if (dayPasses) {
            uint256 earned = DREAM_RATIO * human;
            allowance = earned > dreamToday ? earned - dreamToday : 0;
        }
    }

    function _sessionPreview(address owner, DreamState storage dream)
        private
        view
        returns (bool ready, bool wouldStall, uint256 unitsAvailable)
    {
        address key = keyOf(owner);
        if (key.code.length == 0) return (false, false, 0);
        (address sessionOwner,, uint256 maxUnits, uint256 unitsSpent,, bool active) = PAINT.sessionInfo(key);
        if (active) {
            if (sessionOwner != owner) return (false, false, 0);
            return (true, false, maxUnits > unitsSpent ? maxUnits - unitsSpent : 0);
        }

        uint256 currentNonce = PAINT.sessionNonces(owner);
        StoredSession[] storage sessions = _sessions[owner];
        for (uint256 i = dream.nextSession; i < sessions.length; ++i) {
            StoredSession storage session = sessions[i];
            if (session.nonce < currentNonce) continue;
            if (session.nonce > currentNonce) return (false, true, 0);
            if (session.expiryBlock <= block.number || session.deadline < block.timestamp) {
                return (false, true, 0);
            }
            if (session.expiryBlock > block.number + PAINT.MAX_SESSION_BLOCKS()) {
                return (false, false, 0);
            }
            return (true, false, session.maxUnits);
        }
        return (false, true, 0);
    }

    function _markStalled(address owner, DreamState storage dream) private {
        if (dream.stalled) return;
        dream.stalled = true;
        emit DreamStalled(owner, block.number);
    }

    function _validateStencil(bytes calldata runs) private pure returns (uint256 rawPixels) {
        if (runs.length == 0 || (runs.length & 3) != 0) revert InvalidStencil();
        uint256 count = runs.length >> 2;
        for (uint256 i; i < count; ++i) {
            uint256 o = i << 2;
            uint256 y = uint8(runs[o]);
            uint256 x0 = uint8(runs[o + 1]);
            uint256 x1 = uint8(runs[o + 2]);
            uint256 colour = uint8(runs[o + 3]);
            if (x0 > x1 || y >= 256 || x1 >= 256 || colour >= 16) revert InvalidStencil();
            rawPixels += x1 - x0 + 1;
            if (rawPixels > MAX_STENCIL_PIXELS) revert TooManyStencilPixels(rawPixels);
        }
    }

    function _writeStencil(bytes calldata runs) private returns (address pointer) {
        bytes memory init = FrameStore.allocateInit(runs.length);
        uint256 offset = init.length - runs.length;
        for (uint256 i; i < runs.length; ++i) init[offset + i] = runs[i];
        pointer = FrameStore.writePrepared(init);
    }

    function _buildChunk(bytes memory stencil, uint32 runOffset, uint16 runSkip, uint256 limit)
        private
        pure
        returns (bytes memory chunk, uint32 nextRunOffset, uint16 nextRunSkip, uint32 rawPixels)
    {
        bytes memory out = new bytes(limit * 4);
        uint256 outLength;
        uint256 remaining = limit;
        uint256 o = runOffset;
        uint256 skip = runSkip;

        while (o < stencil.length && remaining != 0) {
            uint256 x0 = uint8(stencil[o + 1]);
            uint256 x1 = uint8(stencil[o + 2]);
            uint256 runLength = x1 - x0 + 1;
            if (skip >= runLength) {
                o += 4;
                skip = 0;
                continue;
            }

            uint256 available = runLength - skip;
            uint256 take = available < remaining ? available : remaining;
            out[outLength] = stencil[o];
            out[outLength + 1] = bytes1(uint8(x0 + skip));
            out[outLength + 2] = bytes1(uint8(x0 + skip + take - 1));
            out[outLength + 3] = stencil[o + 3];
            outLength += 4;
            rawPixels += uint32(take);
            remaining -= take;
            skip += take;
            if (skip == runLength) {
                o += 4;
                skip = 0;
            }
        }

        assembly ("memory-safe") {
            mstore(out, outLength)
        }
        chunk = out;
        nextRunOffset = uint32(o);
        nextRunSkip = uint16(skip);
    }

    function _pixelsToday(address owner) private view returns (uint32 pixelsToday) {
        (, pixelsToday,,,,,,,,) = PAINT.painterStats(owner);
    }

    function _dreamPixelsToday(address owner) private view returns (uint32) {
        DreamDay storage day = _dreamDays[owner];
        uint48 today = uint48(block.timestamp / 1 days);
        return day.dayBucket == today ? day.pixels : 0;
    }

    function _addDreamPixels(address owner, uint32 pixels) private {
        if (pixels == 0) return;
        uint48 today = uint48(block.timestamp / 1 days);
        DreamDay storage day = _dreamDays[owner];
        if (day.dayBucket != today) {
            day.dayBucket = today;
            day.pixels = 0;
        }
        day.pixels += pixels;
        uint48 todayMarker = today + 1;
        if (_lastDreamDay[owner] != todayMarker) {
            _lastDreamDay[owner] = todayMarker;
            ++_dreamingDays[owner];
        }
    }

    function _recordHelper(address owner, DreamState storage dream) private {
        if (_callerSeenDream[owner][msg.sender] != dream.dreamId) {
            _callerSeenDream[owner][msg.sender] = dream.dreamId;
            ++dream.helpers;
        }
    }

    function _copyHolderIds(address owner) private view returns (uint256[] memory ids) {
        uint256 length = _holderIds[owner].length;
        ids = new uint256[](length);
        for (uint256 i; i < length; ++i) ids[i] = _holderIds[owner][i];
    }

    struct SurvivalScan {
        uint256 count;
        uint256 total;
        uint256 survived;
        uint256 sampleIndex;
        uint256 ordinal;
        uint256 season;
        uint128 mismatchMask;
    }

    function _sampleSurvival(bytes memory stencil, uint32 totalPixels)
        private
        view
        returns (uint16 basisPoints, uint8 sampleCount, uint128 mismatchMask)
    {
        // State lives in memory so the optimizer can't run out of stack when this is inlined into mintDream.
        SurvivalScan memory scan;
        scan.count = totalPixels < MAX_SURVIVAL_SAMPLES ? totalPixels : MAX_SURVIVAL_SAMPLES;
        scan.total = totalPixels;
        scan.season = PAINT.currentSeason();
        sampleCount = uint8(scan.count);
        for (uint256 o; o < stencil.length && scan.sampleIndex < scan.count; o += 4) {
            _sampleRun(scan, uint8(stencil[o]), uint8(stencil[o + 1]), uint8(stencil[o + 2]), uint8(stencil[o + 3]));
        }
        mismatchMask = scan.mismatchMask;
        basisPoints = scan.count == 0 ? 0 : uint16((scan.survived * 10_000) / scan.count);
    }

    function _sampleRun(SurvivalScan memory scan, uint256 y, uint256 x0, uint256 x1, uint8 colour) private view {
        for (uint256 x = x0; x <= x1 && scan.sampleIndex < scan.count; ++x) {
            uint256 target = scan.count == 1 ? 0 : (scan.sampleIndex * (scan.total - 1)) / (scan.count - 1);
            if (scan.ordinal == target) {
                if (PAINT.pixelAt(scan.season, x, y) == colour) {
                    ++scan.survived;
                } else {
                    scan.mismatchMask |= uint128(uint256(1) << scan.sampleIndex); // sampleIndex < MAX_SURVIVAL_SAMPLES (128)
                }
                ++scan.sampleIndex;
            }
            ++scan.ordinal;
        }
    }

    function _colourStats(bytes memory stencil) private pure returns (uint8 dominantColour, uint8 coloursUsed) {
        uint32[16] memory counts;
        uint16 mask;
        for (uint256 o; o < stencil.length; o += 4) {
            uint256 length = uint256(uint8(stencil[o + 2])) - uint256(uint8(stencil[o + 1])) + 1;
            uint8 colour = uint8(stencil[o + 3]);
            counts[colour] += uint32(length);
            mask |= uint16(1) << colour;
        }
        uint32 best;
        for (uint8 colour; colour < 16; ++colour) {
            if ((mask & (uint16(1) << colour)) != 0) ++coloursUsed;
            if (colour != 0 && counts[colour] > best) {
                best = counts[colour];
                dominantColour = colour;
            }
        }
    }

    function _dreamSvg(bytes memory stencil, uint32 totalPixels, uint8 sampleCount, uint128 mismatchMask)
        private
        view
        returns (bytes memory)
    {
        (uint256 minX, uint256 minY, uint256 maxX, uint256 maxY) = _bounds(stencil);
        uint24[16] memory palette = PAINT.palette();
        DynamicBufferLib.DynamicBuffer memory out = DynamicBufferLib.p();
        out = out.reserve(64_000);
        out = out.p(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="'));
        out = out.p(bytes(minX.toString()), bytes(" "), bytes(minY.toString()));
        out = out.p(bytes(" "), bytes((maxX - minX + 1).toString()), bytes(" "));
        out = out.p(bytes((maxY - minY + 1).toString()), bytes('" shape-rendering="crispEdges">'));
        out = out.p(bytes('<rect x="'), bytes(minX.toString()), bytes('" y="'));
        out = out.p(bytes(minY.toString()), bytes('" width="'), bytes((maxX - minX + 1).toString()));
        out = out.p(bytes('" height="'), bytes((maxY - minY + 1).toString()), bytes('" fill="#0b0b0c"/>'));
        for (uint256 o; o < stencil.length; o += 4) {
            uint256 y = uint8(stencil[o]);
            uint256 x0 = uint8(stencil[o + 1]);
            uint256 x1 = uint8(stencil[o + 2]);
            uint8 colour = uint8(stencil[o + 3]);
            out = out.p(bytes('<rect x="'), bytes(x0.toString()), bytes('" y="'));
            out = out.p(bytes(y.toString()), bytes('" width="'), bytes((x1 - x0 + 1).toString()));
            out = out.p(bytes('" height="1" fill="'), _hexColour(palette[colour]), bytes('"/>'));
        }

        if (mismatchMask != 0 && sampleCount != 0) {
            uint256 sampleIndex;
            uint256 ordinal;
            uint256 count = sampleCount;
            for (uint256 o; o < stencil.length && sampleIndex < count; o += 4) {
                uint256 y = uint8(stencil[o]);
                uint256 x0 = uint8(stencil[o + 1]);
                uint256 x1 = uint8(stencil[o + 2]);
                for (uint256 x = x0; x <= x1 && sampleIndex < count; ++x) {
                    uint256 target = count == 1 ? 0 : (sampleIndex * (uint256(totalPixels) - 1)) / (count - 1);
                    if (ordinal == target) {
                        if ((uint256(mismatchMask) & (uint256(1) << sampleIndex)) != 0) {
                            out = out.p(bytes('<rect x="'), bytes(x.toString()), bytes('" y="'));
                            out = out.p(
                                bytes(y.toString()),
                                bytes('" width="1" height="1" fill="#5feddf" fill-opacity=".35"/>')
                            );
                        }
                        ++sampleIndex;
                    }
                    ++ordinal;
                }
            }
        }
        out = out.p(bytes("</svg>"));
        return out.data;
    }

    function _bounds(bytes memory stencil) private pure returns (uint256 minX, uint256 minY, uint256 maxX, uint256 maxY) {
        minX = 255;
        minY = 255;
        for (uint256 o; o < stencil.length; o += 4) {
            uint256 y = uint8(stencil[o]);
            uint256 x0 = uint8(stencil[o + 1]);
            uint256 x1 = uint8(stencil[o + 2]);
            if (x0 < minX) minX = x0;
            if (x1 > maxX) maxX = x1;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    function _hexColour(uint24 colour) private pure returns (bytes memory out) {
        bytes16 hexChars = "0123456789abcdef";
        out = new bytes(7);
        out[0] = 0x23;
        for (uint256 i; i < 6; ++i) {
            uint256 shift = (5 - i) * 4;
            out[i + 1] = hexChars[(uint256(colour) >> shift) & 0x0f];
        }
    }

    function _stepResult(address owner, StepCode code, bytes memory reason)
        private
        returns (StepCode, bytes memory)
    {
        emit StepResult(owner, msg.sender, code, reason);
        return (code, reason);
    }

    function _withdrawRefundTo(address owner, address to) private {
        uint256 amount = refunds[owner];
        if (amount == 0) revert NoRefund();
        refunds[owner] = 0;
        // forge-lint: disable-next-line(arbitrary-send-eth, reentrancy-eth)
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert RefundFailed();
        emit RefundWithdrawn(owner, amount);
    }

    function _selector(bytes memory reason) private pure returns (bytes4 selector_) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector_ := mload(add(reason, 0x20))
        }
    }

    function _chunkWouldChange(bytes memory chunk) private view returns (bool) {
        uint256 season = PAINT.currentSeason();
        bytes memory outline = PAINT.seasonOutlineRuns(season);
        uint256[256] memory outlineRows;
        for (uint256 o; o < outline.length; o += 3) {
            uint256 y = uint8(outline[o]);
            uint256 x0 = uint8(outline[o + 1]);
            uint256 x1 = uint8(outline[o + 2]);
            uint256 width = x1 - x0 + 1;
            uint256 mask = width == 256 ? type(uint256).max : ((uint256(1) << width) - 1) << x0;
            outlineRows[y] |= mask;
        }

        for (uint256 o; o < chunk.length; o += 4) {
            uint256 y = uint8(chunk[o]);
            uint256 x0 = uint8(chunk[o + 1]);
            uint256 x1 = uint8(chunk[o + 2]);
            uint8 colour = uint8(chunk[o + 3]);
            for (uint256 x = x0; x <= x1; ++x) {
                if ((outlineRows[y] & (uint256(1) << x)) != 0) continue;
                if (PAINT.pixelAt(season, x, y) != colour) return true;
            }
        }
        return false;
    }

    function _refundOrCredit(address owner, uint256 amount) private {
        // forge-lint: disable-next-line(arbitrary-send-eth, return-bomb)
        (bool ok,) = payable(owner).call{value: amount, gas: REFUND_GAS_LIMIT}("");
        if (!ok) {
            refunds[owner] += amount;
            emit RefundCredited(owner, amount);
        }
    }

    function _send(address to, uint256 amount, bool refund) private {
        // forge-lint: disable-next-line(arbitrary-send-eth)
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) {
            if (refund) revert RefundFailed();
            revert TipTransferFailed();
        }
    }

    function _keySalt(address owner) private pure returns (bytes32) {
        return bytes32(uint256(uint160(owner)));
    }
}
