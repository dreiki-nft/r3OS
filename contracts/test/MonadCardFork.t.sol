// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {R3tardsCardMemory} from "../src/monadcard/R3tardsCardMemory.sol";

interface IOfficialMonadCard {
    function ownerOf(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
}

contract MonadCardForkTest is Test {
    address constant OFFICIAL = 0x0000CA12D5c07085022eBC74867157449919Fd67;

    function testOfficialMonadCardOnMainnetFork() public {
        string memory rpc = vm.envOr("MONAD_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }

        vm.createSelectFork(rpc);
        assertEq(block.chainid, 143);
        uint256 cardId = vm.envUint("CARD_ID");
        IOfficialMonadCard card = IOfficialMonadCard(OFFICIAL);
        address owner = card.ownerOf(cardId);
        assertTrue(owner != address(0));
        assertGe(card.balanceOf(owner), 1);

        R3tardsCardMemory memory_ = new R3tardsCardMemory(OFFICIAL);
        bytes32[] memory words = new bytes32[](1);
        words[0] = bytes32("fork test");
        vm.prank(owner);
        memory_.write(cardId, 1, words);
        assertEq(memory_.readPage(cardId)[1], words[0]);
        (, bool earned) = memory_.stamp(owner);
        assertTrue(earned);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(R3tardsCardMemory.NotCardOwner.selector, cardId, owner));
        memory_.write(cardId, 1, words);

        uint256 nonexistent = type(uint256).max;
        (bool ownerOk, bytes memory ownerData) = OFFICIAL.staticcall(
            abi.encodeWithSelector(IOfficialMonadCard.ownerOf.selector, nonexistent)
        );
        if (ownerOk && ownerData.length >= 32) {
            console2.log("nonexistent ownerOf returned", abi.decode(ownerData, (address)));
        } else {
            console2.log("nonexistent ownerOf reverted or returned short data");
        }

        (bool ifaceOk, bytes memory ifaceData) = OFFICIAL.staticcall(
            abi.encodeWithSignature("supportsInterface(bytes4)", bytes4(0xb45a3c0e))
        );
        console2.log("ERC-5192 supportsInterface answered", ifaceOk && ifaceData.length >= 32);
        if (ifaceOk && ifaceData.length >= 32) console2.log("ERC-5192 supported", abi.decode(ifaceData, (bool)));

        _logString("name()", abi.encodeWithSignature("name()"));
        _logString("symbol()", abi.encodeWithSignature("symbol()"));
    }

    function _logString(string memory label, bytes memory data) private view {
        (bool ok, bytes memory out) = OFFICIAL.staticcall(data);
        if (ok && out.length >= 64) console2.log(label, abi.decode(out, (string)));
        else console2.log(label, "unavailable");
    }
}
