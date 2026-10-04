// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IR3OSPaintData} from "../interfaces/IR3OSPaintData.sol";

/// @notice Permissionless candle auctions for immutable r3OS season finales.
/// @dev No owner or admin. Bids use pull-payment escrow; settlement uses the close block hash when still available.
contract R3OSFinaleAuction is ReentrancyGuard {
    uint256 public constant BIDDING_BLOCKS = 288_000;
    uint256 public constant CANDLE_BLOCKS = 12_000;
    uint256 public constant REVEAL_WINDOW = 256;
    uint256 public constant HISTORY_WINDOW = 8_191;
    address public constant HISTORY_STORAGE_ADDRESS = 0x0000F90827F1C53a10cb7A02335B175320002935;
    uint256 public constant MIN_RAISE_BPS = 500;
    uint256 public constant MAX_START_DELAY = 2_016_000;

    error ZeroAddress();
    error NotFinale(uint256 tokenId);
    error NotTokenOwner();
    error ZeroReserve();
    error BadStartBlock(uint48 startBlock);
    error NoAuction(uint256 auctionId);
    error NotStarted(uint256 startBlock);
    error BiddingClosed(uint256 auctionId);
    error ZeroValue();
    error BidTooLow(uint256 minimum);
    error BidTooLarge();
    error NotSeller();
    error HasBids();
    error AlreadySettled();
    error StillBidding(uint256 closeBlock);
    error NotSettled(uint256 auctionId);
    error NothingToWithdraw();
    error TransferFailed();

    event Listed(
        uint256 indexed auctionId,
        uint256 indexed tokenId,
        address indexed seller,
        uint128 reserve,
        uint48 startBlock,
        uint48 closeBlock
    );
    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint128 total,
        uint48 blockNumber,
        uint256 bidIndex
    );
    event Cancelled(uint256 indexed auctionId);
    event CandleOut(uint256 indexed auctionId, uint48 endBlock, bool usedFallback);
    event Settled(
        uint256 indexed auctionId,
        address indexed winner,
        uint128 price,
        uint128 royalty,
        uint48 endBlock
    );
    event Withdrawn(uint256 indexed auctionId, address indexed account, uint256 amount);
    event CreditsWithdrawn(address indexed account, uint256 amount);

    struct Bid {
        address bidder;
        uint48 blockNumber;
        uint128 total;
    }

    struct Auction {
        address seller;
        uint256 tokenId;
        uint128 reserve;
        uint48 startBlock;
        uint8 state; // 1 live, 2 settled, 3 cancelled
        uint128 highest;
        uint48 endBlock;
        address winner;
        uint128 price;
        uint128 royalty;
        bool usedFallback;
    }

    struct AuctionInfo {
        address seller;
        uint256 tokenId;
        uint128 reserve;
        uint48 startBlock;
        uint48 closeBlock;
        uint48 candleStartBlock;
        uint8 state;
        uint128 highest;
        uint256 bidCount;
        uint48 endBlock;
        address winner;
        uint128 price;
        uint128 royalty;
        bool usedFallback;
    }

    struct BidderStats {
        uint32 bidsPlaced;
        uint32 auctionsWon;
    }

    IR3OSPaintData public immutable PAINT;
    address public immutable CORE;

    uint256 public auctionCount;
    mapping(uint256 => Auction) private _auctions;
    mapping(uint256 => Bid[]) private _bids;
    mapping(uint256 => mapping(address => uint256)) private _deposits;
    mapping(address => uint256) public credits;
    mapping(address => BidderStats) public bidderStats;

    constructor(address paintCore) {
        if (paintCore == address(0)) revert ZeroAddress();
        PAINT = IR3OSPaintData(paintCore);
        CORE = paintCore;
    }

    function list(uint256 tokenId, uint128 reserve, uint48 startBlock) external returns (uint256 auctionId) {
        IR3OSPaintData.FrameInfoData memory info = PAINT.frameInfo(tokenId);
        if (!info.finale) revert NotFinale(tokenId);
        if (IERC721(CORE).ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (reserve == 0) revert ZeroReserve();

        uint256 currentBlock = block.number;
        uint48 resolvedStart;
        if (startBlock == 0) {
            resolvedStart = uint48(currentBlock);
        } else {
            if (uint256(startBlock) < currentBlock || uint256(startBlock) > currentBlock + MAX_START_DELAY) {
                revert BadStartBlock(startBlock);
            }
            resolvedStart = startBlock;
        }

        IERC721(CORE).transferFrom(msg.sender, address(this), tokenId);
        auctionId = ++auctionCount;
        _auctions[auctionId] = Auction({
            seller: msg.sender,
            tokenId: tokenId,
            reserve: reserve,
            startBlock: resolvedStart,
            state: 1,
            highest: 0,
            endBlock: 0,
            winner: address(0),
            price: 0,
            royalty: 0,
            usedFallback: false
        });
        uint48 closeBlock = uint48(uint256(resolvedStart) + BIDDING_BLOCKS - 1);
        emit Listed(auctionId, tokenId, msg.sender, reserve, resolvedStart, closeBlock);
    }

    function bid(uint256 auctionId) external payable nonReentrant {
        Auction storage a = _liveAuction(auctionId);
        uint256 currentBlock = block.number;
        if (currentBlock < a.startBlock) revert NotStarted(a.startBlock);
        uint256 closeBlock = uint256(a.startBlock) + BIDDING_BLOCKS - 1;
        if (currentBlock > closeBlock) revert BiddingClosed(auctionId);
        if (msg.value == 0) revert ZeroValue();

        uint256 previousDeposit = _deposits[auctionId][msg.sender];
        if (msg.value > uint256(type(uint128).max) - previousDeposit) revert BidTooLarge();
        uint256 total = previousDeposit + msg.value;
        uint256 minimum = _minNextBid(a, _bids[auctionId].length != 0);
        if (total < minimum) revert BidTooLow(minimum);

        _deposits[auctionId][msg.sender] = total;
        a.highest = uint128(total);
        Bid[] storage bids = _bids[auctionId];
        uint256 bidIndex = bids.length;
        bids.push(Bid(msg.sender, uint48(currentBlock), uint128(total)));
        unchecked { ++bidderStats[msg.sender].bidsPlaced; }
        emit BidPlaced(auctionId, msg.sender, uint128(total), uint48(currentBlock), bidIndex);
    }

    function cancel(uint256 auctionId) external {
        Auction storage a = _liveAuction(auctionId);
        if (msg.sender != a.seller) revert NotSeller();
        if (_bids[auctionId].length != 0) revert HasBids();
        a.state = 3;
        IERC721(CORE).transferFrom(address(this), a.seller, a.tokenId);
        emit Cancelled(auctionId);
    }

    function settle(uint256 auctionId) external nonReentrant {
        Auction storage a = _requireAuction(auctionId);
        if (a.state == 2) revert AlreadySettled();
        if (a.state != 1) revert NoAuction(auctionId);

        uint256 close = uint256(a.startBlock) + BIDDING_BLOCKS - 1;
        if (block.number <= close) revert StillBidding(close);

        uint256 candleStart = close - CANDLE_BLOCKS + 1;
        uint256 drawnEndBlock = candleStart;
        bool fallbackUsed = true;
        bytes32 h = _historicalBlockHash(close);
        if (h != bytes32(0)) {
            drawnEndBlock = close - (uint256(keccak256(abi.encode(h, auctionId))) % CANDLE_BLOCKS);
            fallbackUsed = false;
        }

        Bid[] storage bids = _bids[auctionId];
        uint256 lo;
        uint256 hi = bids.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (bids[mid].blockNumber <= drawnEndBlock) lo = mid + 1;
            else hi = mid;
        }

        address winningBidder;
        uint128 winningPrice;
        uint128 royaltyAmount;
        if (lo == 0) {
            // forge-lint: disable-next-line(reentrancy-no-eth)
            IERC721(CORE).transferFrom(address(this), a.seller, a.tokenId);
        } else {
            Bid storage winningBid = bids[lo - 1];
            winningBidder = winningBid.bidder;
            winningPrice = winningBid.total;
            _deposits[auctionId][winningBidder] -= winningPrice;

            (address receiver, uint256 royaltyValue) = IERC2981(CORE).royaltyInfo(a.tokenId, winningPrice);
            if (receiver == address(0) || receiver == a.seller) royaltyValue = 0;
            require(royaltyValue <= winningPrice && royaltyValue <= type(uint128).max, "bad royalty");
            royaltyAmount = uint128(royaltyValue);
            if (royaltyAmount != 0) credits[receiver] += royaltyAmount;
            credits[a.seller] += uint256(winningPrice) - royaltyAmount;
            unchecked { ++bidderStats[winningBidder].auctionsWon; }
            // forge-lint: disable-next-line(reentrancy-no-eth)
            IERC721(CORE).transferFrom(address(this), winningBidder, a.tokenId);
        }

        a.state = 2;
        a.endBlock = uint48(drawnEndBlock);
        a.winner = winningBidder;
        a.price = winningPrice;
        a.royalty = royaltyAmount;
        a.usedFallback = fallbackUsed;
        emit CandleOut(auctionId, uint48(drawnEndBlock), fallbackUsed);
        emit Settled(auctionId, winningBidder, winningPrice, royaltyAmount, uint48(drawnEndBlock));
    }

    function withdraw(uint256 auctionId) external nonReentrant {
        Auction storage a = _requireAuction(auctionId);
        if (a.state != 2) revert NotSettled(auctionId);
        uint256 amount = _deposits[auctionId][msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        _deposits[auctionId][msg.sender] = 0;
        // forge-lint: disable-next-line(reentrancy-eth)
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(auctionId, msg.sender, amount);
    }

    function withdrawCredits() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        // forge-lint: disable-next-line(reentrancy-eth)
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CreditsWithdrawn(msg.sender, amount);
    }

    function auctionInfo(uint256 auctionId) external view returns (AuctionInfo memory info) {
        Auction storage a = _requireAuction(auctionId);
        uint48 closeBlock = uint48(uint256(a.startBlock) + BIDDING_BLOCKS - 1);
        info = AuctionInfo({
            seller: a.seller,
            tokenId: a.tokenId,
            reserve: a.reserve,
            startBlock: a.startBlock,
            closeBlock: closeBlock,
            candleStartBlock: uint48(uint256(closeBlock) - CANDLE_BLOCKS + 1),
            state: a.state,
            highest: a.highest,
            bidCount: _bids[auctionId].length,
            endBlock: a.endBlock,
            winner: a.winner,
            price: a.price,
            royalty: a.royalty,
            usedFallback: a.usedFallback
        });
    }

    function minNextBid(uint256 auctionId) external view returns (uint256) {
        Auction storage a = _requireAuction(auctionId);
        return _minNextBid(a, _bids[auctionId].length != 0);
    }

    function bidAt(uint256 auctionId, uint256 index)
        external
        view
        returns (address bidder, uint48 blockNumber, uint128 total)
    {
        _requireAuction(auctionId);
        Bid storage b = _bids[auctionId][index];
        return (b.bidder, b.blockNumber, b.total);
    }

    function depositOf(uint256 auctionId, address bidder) external view returns (uint256) {
        _requireAuction(auctionId);
        return _deposits[auctionId][bidder];
    }

    function previewEndBlock(uint256 auctionId) external view returns (bool known, uint256 endBlock) {
        Auction storage a = _requireAuction(auctionId);
        uint256 close = uint256(a.startBlock) + BIDDING_BLOCKS - 1;
        if (a.state == 2) return (true, a.endBlock);
        if (a.state == 3) return (false, 0);
        if (block.number <= close) return (false, 0);
        bytes32 h = _historicalBlockHash(close);
        if (h == bytes32(0)) return (true, close - CANDLE_BLOCKS + 1);
        return (true, close - (uint256(keccak256(abi.encode(h, auctionId))) % CANDLE_BLOCKS));
    }

    function _historicalBlockHash(uint256 blockNumber) private view returns (bytes32 h) {
        if (blockNumber >= block.number) return bytes32(0);
        uint256 age = block.number - blockNumber;
        if (age <= REVEAL_WINDOW) return blockhash(blockNumber);
        if (age > HISTORY_WINDOW) return bytes32(0);

        (bool ok, bytes memory data) = HISTORY_STORAGE_ADDRESS.staticcall(abi.encode(blockNumber));
        if (!ok || data.length != 32) return bytes32(0);
        assembly ("memory-safe") {
            h := mload(add(data, 0x20))
        }
    }

    function _minNextBid(Auction storage a, bool hasBids) private view returns (uint256) {
        if (!hasBids) return a.reserve;
        uint256 highest = a.highest;
        uint256 raise = (highest * MIN_RAISE_BPS + 9_999) / 10_000;
        return highest + raise;
    }

    function _requireAuction(uint256 auctionId) private view returns (Auction storage a) {
        if (auctionId == 0 || auctionId > auctionCount) revert NoAuction(auctionId);
        return _auctions[auctionId];
    }

    function _liveAuction(uint256 auctionId) private view returns (Auction storage a) {
        a = _requireAuction(auctionId);
        if (a.state != 1) revert NoAuction(auctionId);
    }
}
