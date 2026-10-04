// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSFinaleAuction} from "../src/labs/R3OSFinaleAuction.sol";
import {MockR3tards} from "./MockR3tards.sol";


contract AuctionReenterer {
    R3OSFinaleAuction public immutable auction;
    uint256 public auctionId;
    bool public triedWithdraw;
    bool public withdrawReentered;
    bool public bidReentered;

    constructor(R3OSFinaleAuction auction_) { auction = auction_; }

    function place(uint256 id) external payable {
        auctionId = id;
        auction.bid{value: msg.value}(id);
    }

    function pull() external {
        auction.withdraw(auctionId);
    }

    receive() external payable {
        if (triedWithdraw) return;
        triedWithdraw = true;
        (withdrawReentered,) = address(auction).call(abi.encodeCall(auction.withdraw, (auctionId)));
        (bidReentered,) = address(auction).call{value: 1}(abi.encodeCall(auction.bid, (auctionId)));
    }
}

contract FinaleAuctionTest is Test {
    R3OSPaint paint;
    R3OSFinaleAuction auction;
    MockR3tards r3tards;
    address seller;
    address royalty;
    address alice;
    address bob;
    address carol;
    uint256 regularFrame;
    uint256 finale;

    function setUp() public {
        vm.roll(1_000_700);
        seller = makeAddr("seller");
        royalty = makeAddr("royalty");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);
        r3tards = new MockR3tards();
        paint = new R3OSPaint(
            address(r3tards), uint64(vm.getBlockTimestamp()), seller, royalty, 512, 0, 512, 16, 256
        );
        auction = new R3OSFinaleAuction(address(paint));
        (regularFrame, finale) = _makeFrameAndFinale();
    }

    function testListValidationAndEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.NotFinale.selector, regularFrame));
        vm.prank(seller);
        auction.list(regularFrame, 1 ether, 0);

        vm.expectRevert(R3OSFinaleAuction.NotTokenOwner.selector);
        vm.prank(alice);
        auction.list(finale, 1 ether, 0);

        vm.expectRevert(R3OSFinaleAuction.ZeroReserve.selector);
        vm.prank(seller);
        auction.list(finale, 0, 0);

        uint256 current = vm.getBlockNumber();
        uint256 maxStartDelay = auction.MAX_START_DELAY();
        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.BadStartBlock.selector, uint48(current - 1)));
        vm.prank(seller);
        auction.list(finale, 1 ether, uint48(current - 1));
        vm.expectRevert(
            abi.encodeWithSelector(
                R3OSFinaleAuction.BadStartBlock.selector,
                uint48(current + maxStartDelay + 1)
            )
        );
        vm.prank(seller);
        auction.list(finale, 1 ether, uint48(current + maxStartDelay + 1));

        _approveFinale();
        vm.prank(seller);
        uint256 id = auction.list(finale, 1 ether, 0);
        assertEq(id, 1);
        assertEq(paint.ownerOf(finale), address(auction));
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        assertEq(info.seller, seller);
        assertEq(info.reserve, 1 ether);
        assertEq(info.startBlock, current);
        assertEq(info.closeBlock, current + auction.BIDDING_BLOCKS() - 1);
        assertEq(info.candleStartBlock, info.closeBlock - auction.CANDLE_BLOCKS() + 1);
    }

    function testBidRulesTopupsAndRoundedMinimum() public {
        uint256 id = _list(100);
        uint48 futureStart = uint48(vm.getBlockNumber() + 10);
        // Use a fresh listing with a future start.
        _cancelAsSeller(id);
        _approveFinale();
        vm.prank(seller);
        id = auction.list(finale, 100, futureStart);
        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.NotStarted.selector, futureStart));
        vm.prank(alice);
        auction.bid{value: 100}(id);
        vm.roll(futureStart);

        vm.expectRevert(R3OSFinaleAuction.ZeroValue.selector);
        vm.prank(alice);
        auction.bid{value: 0}(id);
        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.BidTooLow.selector, 100));
        vm.prank(alice);
        auction.bid{value: 99}(id);

        vm.prank(alice);
        auction.bid{value: 100}(id);
        assertEq(auction.depositOf(id, alice), 100);
        assertEq(auction.minNextBid(id), 105);

        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.BidTooLow.selector, 105));
        vm.prank(alice);
        auction.bid{value: 4}(id);
        vm.prank(alice);
        auction.bid{value: 5}(id);
        assertEq(auction.depositOf(id, alice), 105);
        assertEq(auction.minNextBid(id), 111); // ceil(105 * 5%) = 6

        vm.prank(bob);
        auction.bid{value: 111}(id);
        (uint32 bidsPlaced,) = auction.bidderStats(alice);
        assertEq(bidsPlaced, 2);

        R3OSFinaleAuction.AuctionInfo memory live = auction.auctionInfo(id);
        vm.roll(uint256(live.closeBlock) + 1);
        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.BiddingClosed.selector, id));
        vm.prank(carol);
        auction.bid{value: 1 ether}(id);
    }

    function testBidTooLarge() public {
        uint256 id = _list(1);
        uint256 huge = uint256(type(uint128).max) + 1;
        vm.deal(alice, huge);
        vm.expectRevert(R3OSFinaleAuction.BidTooLarge.selector);
        vm.prank(alice);
        auction.bid{value: huge}(id);
    }

    function testCancelRules() public {
        uint256 id = _list(1 ether);
        vm.expectRevert(R3OSFinaleAuction.NotSeller.selector);
        vm.prank(alice);
        auction.cancel(id);
        vm.prank(seller);
        auction.cancel(id);
        assertEq(paint.ownerOf(finale), seller);
        (bool known, uint256 endBlock) = auction.previewEndBlock(id);
        assertFalse(known);
        assertEq(endBlock, 0);
        assertEq(auction.auctionInfo(id).state, 3);

        // New season/finale for a bid-cancel rejection.
        uint256 finale2 = _nextFinale();
        vm.prank(seller);
        paint.approve(address(auction), finale2);
        vm.prank(seller);
        uint256 id2 = auction.list(finale2, 1 ether, 0);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id2);
        vm.expectRevert(R3OSFinaleAuction.HasBids.selector);
        vm.prank(seller);
        auction.cancel(id2);
    }

    function testSec_SettleInsideWindowUsesRandomCandle() public {
        uint256 id = _list(1 ether);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        vm.roll(uint256(info.closeBlock));
        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.StillBidding.selector, info.closeBlock));
        auction.settle(id);

        bytes32 closeHash = keccak256("close block");
        vm.roll(uint256(info.closeBlock) + 1);
        vm.setBlockhash(info.closeBlock, closeHash);
        uint256 expected = uint256(info.closeBlock)
            - (uint256(keccak256(abi.encode(closeHash, id))) % auction.CANDLE_BLOCKS());
        (bool known, uint256 preview) = auction.previewEndBlock(id);
        assertTrue(known);
        assertEq(preview, expected);
        uint256 gasBefore = gasleft();
        auction.settle(id);
        uint256 gasUsed = gasBefore - gasleft();
        console.log("GAS Auction settle history available", gasUsed);
        R3OSFinaleAuction.AuctionInfo memory settled = auction.auctionInfo(id);
        assertEq(settled.endBlock, expected);
        assertFalse(settled.usedFallback);
        vm.expectRevert(R3OSFinaleAuction.AlreadySettled.selector);
        auction.settle(id);
    }

    function testSec_Eip2935ExtendsAuctionHistoryWindow() public {
        uint256 id = _list(1 ether);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);

        bytes32 historicalHash = keccak256("historical close block");
        vm.roll(uint256(info.closeBlock) + auction.REVEAL_WINDOW() + 1);
        vm.mockCall(
            auction.HISTORY_STORAGE_ADDRESS(),
            abi.encode(uint256(info.closeBlock)),
            abi.encode(historicalHash)
        );
        uint256 expected = uint256(info.closeBlock)
            - (uint256(keccak256(abi.encode(historicalHash, id))) % auction.CANDLE_BLOCKS());

        (bool known, uint256 preview) = auction.previewEndBlock(id);
        assertTrue(known);
        assertEq(preview, expected);
        auction.settle(id);
        R3OSFinaleAuction.AuctionInfo memory settled = auction.auctionInfo(id);
        assertEq(settled.endBlock, expected);
        assertFalse(settled.usedFallback);
    }

    function testSec_AuctionFallbackAfterHistoryWindow() public {
        uint256 id = _list(1 ether);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.roll(uint256(info.closeBlock) + auction.HISTORY_WINDOW() + 1);
        (bool known, uint256 preview) = auction.previewEndBlock(id);
        assertTrue(known);
        assertEq(preview, info.candleStartBlock);
        uint256 gasBefore = gasleft();
        auction.settle(id);
        uint256 gasUsed = gasBefore - gasleft();
        console.log("GAS Auction settle history expired", gasUsed);
        R3OSFinaleAuction.AuctionInfo memory settled = auction.auctionInfo(id);
        assertEq(settled.endBlock, info.candleStartBlock);
        assertTrue(settled.usedFallback);
    }

    function testSec_FallbackCandleStartRejectsLateBidAndLateBidderWithdraws() public {
        uint256 id = _list(1 ether);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);

        vm.roll(info.candleStartBlock);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        vm.roll(uint256(info.candleStartBlock) + 1);
        vm.prank(bob);
        auction.bid{value: 1.05 ether}(id);

        vm.roll(uint256(info.closeBlock) + auction.HISTORY_WINDOW() + 1);
        auction.settle(id);
        R3OSFinaleAuction.AuctionInfo memory settled = auction.auctionInfo(id);
        assertEq(settled.endBlock, info.candleStartBlock);
        assertEq(settled.winner, alice);
        assertEq(auction.depositOf(id, bob), 1.05 ether);

        uint256 before = bob.balance;
        vm.prank(bob);
        auction.withdraw(id);
        assertEq(bob.balance, before + 1.05 ether);
    }

    function testCandleIgnoresLateBidAndRefundsLateTopup() public {
        uint256 id = _list(1 ether);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        uint256 candleStart = info.candleStartBlock;
        vm.roll(candleStart);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        vm.roll(candleStart + 1);
        vm.prank(bob);
        auction.bid{value: 1.05 ether}(id);
        vm.roll(candleStart + 2);
        vm.prank(alice);
        auction.bid{value: 0.1025 ether}(id); // alice total 1.1025, exactly +5% over 1.05

        // Find a close hash whose candle ends at candleStart or candleStart+1, so alice's final top-up is late.
        bytes32 h;
        uint256 end;
        for (uint256 n = 1; n < 20_000; ++n) {
            h = bytes32(n);
            end = uint256(info.closeBlock) - (uint256(keccak256(abi.encode(h, id))) % auction.CANDLE_BLOCKS());
            if (end <= candleStart + 1) break;
        }
        assertLe(end, candleStart + 1);
        vm.roll(uint256(info.closeBlock) + 1);
        vm.setBlockhash(info.closeBlock, h);
        auction.settle(id);
        R3OSFinaleAuction.AuctionInfo memory settled = auction.auctionInfo(id);
        address expectedWinner = end == candleStart ? alice : bob;
        assertEq(settled.winner, expectedWinner);
        if (expectedWinner == alice) assertEq(auction.depositOf(id, alice), 0.1025 ether);
        else assertEq(auction.depositOf(id, alice), 1.1025 ether);
    }

    function testNoBidBeforeCandleReturnsTokenAndDepositsRemainWithdrawable() public {
        uint256 id = _list(1 ether);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.roll(uint256(info.candleStartBlock) + 5);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        // Force candle to an earlier block than the first bid.
        bytes32 h;
        uint256 end;
        for (uint256 n = 1; n < 30_000; ++n) {
            h = keccak256(abi.encode(n));
            end = uint256(info.closeBlock) - (uint256(keccak256(abi.encode(h, id))) % auction.CANDLE_BLOCKS());
            if (end < info.candleStartBlock + 5) break;
        }
        assertLt(end, uint256(info.candleStartBlock) + 5);
        vm.roll(uint256(info.closeBlock) + 1);
        vm.setBlockhash(info.closeBlock, h);
        auction.settle(id);
        assertEq(paint.ownerOf(finale), seller);
        assertEq(auction.depositOf(id, alice), 1 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        auction.withdraw(id);
        assertEq(alice.balance, before + 1 ether);
    }

    function testSameBlockLastBidWinsAndRoyaltyCredits() public {
        uint256 id = _list(1 ether);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        vm.prank(bob);
        auction.bid{value: 1.05 ether}(id);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.roll(uint256(info.closeBlock) + auction.HISTORY_WINDOW() + 1); // fallback includes both
        auction.settle(id);
        R3OSFinaleAuction.AuctionInfo memory settled = auction.auctionInfo(id);
        assertEq(settled.winner, bob);
        assertEq(settled.price, 1.05 ether);
        assertEq(settled.royalty, 0.0525 ether);
        assertEq(auction.credits(royalty), 0.0525 ether);
        assertEq(auction.credits(seller), 0.9975 ether);
        assertEq(paint.ownerOf(finale), bob);
        (, uint32 wins) = auction.bidderStats(bob);
        assertEq(wins, 1);
    }

    function testRoyaltyZeroWhenSellerIsReceiver() public {
        MockR3tards otherR3tards = new MockR3tards();
        R3OSPaint otherPaint = new R3OSPaint(
            address(otherR3tards), uint64(vm.getBlockTimestamp()), seller, seller, 512, 0, 512, 16, 256
        );
        vm.prank(seller);
        otherPaint.paint(hex"c8c8d704", new uint256[](0));
        vm.warp(otherPaint.seasonEndTime(0));
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(seller);
        uint256 otherFinale = otherPaint.mintSeasonFinale(0);
        R3OSFinaleAuction otherAuction = new R3OSFinaleAuction(address(otherPaint));
        vm.prank(seller);
        otherPaint.approve(address(otherAuction), otherFinale);
        vm.prank(seller);
        uint256 id = otherAuction.list(otherFinale, 100, 0);
        vm.prank(alice);
        otherAuction.bid{value: 100}(id);
        R3OSFinaleAuction.AuctionInfo memory info = otherAuction.auctionInfo(id);
        vm.roll(uint256(info.closeBlock) + otherAuction.HISTORY_WINDOW() + 1);
        otherAuction.settle(id);
        assertEq(otherAuction.auctionInfo(id).royalty, 0);
        assertEq(otherAuction.credits(seller), 100);
    }

    function testWithdrawAndCreditsOnlyOnce() public {
        uint256 id = _list(1 ether);
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        vm.prank(bob);
        auction.bid{value: 1.05 ether}(id);
        vm.expectRevert(abi.encodeWithSelector(R3OSFinaleAuction.NotSettled.selector, id));
        vm.prank(alice);
        auction.withdraw(id);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.roll(uint256(info.closeBlock) + auction.HISTORY_WINDOW() + 1);
        auction.settle(id);

        vm.prank(alice);
        auction.withdraw(id);
        vm.expectRevert(R3OSFinaleAuction.NothingToWithdraw.selector);
        vm.prank(alice);
        auction.withdraw(id);

        vm.prank(seller);
        auction.withdrawCredits();
        vm.expectRevert(R3OSFinaleAuction.NothingToWithdraw.selector);
        vm.prank(seller);
        auction.withdrawCredits();
        vm.prank(royalty);
        auction.withdrawCredits();
    }

    function testWithdrawReentrancyAndBidReentrancyFail() public {
        uint256 id = _list(1 ether);
        AuctionReenterer attacker = new AuctionReenterer(auction);
        vm.deal(address(this), 2 ether);
        attacker.place{value: 1 ether}(id);
        vm.prank(bob);
        auction.bid{value: 1.05 ether}(id);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.roll(uint256(info.closeBlock) + auction.HISTORY_WINDOW() + 1);
        auction.settle(id);
        attacker.pull();
        assertTrue(attacker.triedWithdraw());
        assertFalse(attacker.withdrawReentered());
        assertFalse(attacker.bidReentered());
        assertEq(auction.depositOf(id, address(attacker)), 0);
    }

    function testCandleVectors() public pure {
        uint256 close = 1_288_700;
        bytes32 h = keccak256("close block");
        assertEq(close - (uint256(keccak256(abi.encode(h, uint256(1)))) % 12_000), 1_286_197);
        assertEq(close - (uint256(keccak256(abi.encode(h, uint256(7)))) % 12_000), 1_277_420);
        assertEq(
            close - (uint256(keccak256(abi.encode(bytes32(uint256(0xdead)), uint256(1)))) % 12_000),
            1_277_551
        );
    }

    function testGasTargets() public {
        _approveFinale();
        uint256 beforeGas = gasleft();
        vm.prank(seller);
        uint256 id = auction.list(finale, 1 ether, 0);
        uint256 used = beforeGas - gasleft();
        console.log("GAS FinaleAuction list", used);
        assertLt(used, 300_000);

        beforeGas = gasleft();
        vm.prank(alice);
        auction.bid{value: 1 ether}(id);
        used = beforeGas - gasleft();
        console.log("GAS FinaleAuction first bid", used);
        assertLt(used, 250_000);

        beforeGas = gasleft();
        vm.prank(bob);
        auction.bid{value: 1.05 ether}(id);
        used = beforeGas - gasleft();
        console.log("GAS FinaleAuction new bidder", used);
        assertLt(used, 250_000);

        beforeGas = gasleft();
        vm.prank(bob);
        auction.bid{value: 0.0525 ether}(id);
        used = beforeGas - gasleft();
        console.log("GAS FinaleAuction top-up", used);
        assertLt(used, 250_000);

        // Add 40 more valid bids from distinct funded addresses.
        for (uint256 i; i < 40; ++i) {
            address bidder = vm.addr(10_000 + i);
            uint256 minBid = auction.minNextBid(id);
            vm.deal(bidder, minBid);
            vm.prank(bidder);
            auction.bid{value: minBid}(id);
        }
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        vm.roll(uint256(info.closeBlock) + auction.HISTORY_WINDOW() + 1);
        beforeGas = gasleft();
        auction.settle(id);
        used = beforeGas - gasleft();
        console.log("GAS FinaleAuction settle 43 bids", used);
        assertLt(used, 350_000);

        beforeGas = gasleft();
        vm.prank(alice);
        auction.withdraw(id);
        used = beforeGas - gasleft();
        console.log("GAS FinaleAuction withdraw", used);
        assertLt(used, 100_000);
    }

    function testFuzzWinnerMatchesBruteForce(uint256 seed) public {
        uint256 id = _list(100);
        R3OSFinaleAuction.AuctionInfo memory info = auction.auctionInfo(id);
        uint256 bidCount = 1 + (seed % 16);
        address[] memory bidders = new address[](bidCount);
        uint48[] memory blocks_ = new uint48[](bidCount);
        uint128[] memory totals = new uint128[](bidCount);
        uint256 current = uint256(info.candleStartBlock) - 20;
        for (uint256 i; i < bidCount; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            current += seed % 1_000;
            if (current > info.closeBlock) current = info.closeBlock;
            vm.roll(current);
            address bidder = vm.addr(50_000 + i);
            uint256 minimum = auction.minNextBid(id);
            vm.deal(bidder, minimum);
            vm.prank(bidder);
            auction.bid{value: minimum}(id);
            bidders[i] = bidder;
            blocks_[i] = uint48(current);
            totals[i] = uint128(minimum);
        }
        bytes32 h = keccak256(abi.encode(seed, "fuzz close"));
        vm.roll(uint256(info.closeBlock) + 1);
        vm.setBlockhash(info.closeBlock, h);
        uint256 end = uint256(info.closeBlock) - (uint256(keccak256(abi.encode(h, id))) % auction.CANDLE_BLOCKS());
        address expected;
        uint128 expectedPrice;
        for (uint256 i; i < bidCount; ++i) {
            if (blocks_[i] <= end) {
                expected = bidders[i];
                expectedPrice = totals[i];
            }
        }
        auction.settle(id);
        R3OSFinaleAuction.AuctionInfo memory settled = auction.auctionInfo(id);
        assertEq(settled.winner, expected);
        assertEq(settled.price, expectedPrice);
        assertEq(paint.ownerOf(finale), expected == address(0) ? seller : expected);

        for (uint256 i; i < bidCount; ++i) {
            if (auction.depositOf(id, bidders[i]) == 0) continue;
            vm.prank(bidders[i]);
            auction.withdraw(id);
        }
        if (auction.credits(seller) != 0) {
            vm.prank(seller);
            auction.withdrawCredits();
        }
        if (auction.credits(royalty) != 0) {
            vm.prank(royalty);
            auction.withdrawCredits();
        }
        assertEq(address(auction).balance, 0);
    }

    function _makeFrameAndFinale() private returns (uint256 frame, uint256 finaleId) {
        vm.prank(seller);
        paint.paint(hex"c8c8d704", new uint256[](0));
        vm.prank(seller);
        frame = paint.mintFrame();
        vm.warp(paint.seasonEndTime(0));
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(seller);
        finaleId = paint.mintSeasonFinale(0);
    }

    function _nextFinale() private returns (uint256 finaleId) {
        uint256 season = paint.currentSeason();
        vm.prank(seller);
        paint.paint(hex"c9c9d704", new uint256[](0));
        vm.warp(paint.seasonEndTime(season));
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(seller);
        finaleId = paint.mintSeasonFinale(season);
    }

    function _approveFinale() private {
        vm.prank(seller);
        paint.approve(address(auction), finale);
    }

    function _list(uint128 reserve) private returns (uint256 id) {
        _approveFinale();
        vm.prank(seller);
        id = auction.list(finale, reserve, 0);
    }

    function _cancelAsSeller(uint256 id) private {
        vm.prank(seller);
        auction.cancel(id);
    }
}
