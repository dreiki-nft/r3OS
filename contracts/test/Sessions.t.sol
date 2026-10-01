// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {R3tardsPaint} from "../src/R3tardsPaint.sol";
import {MockR3tards} from "./MockR3tards.sol";

contract Mock1271Owner is IERC1271 {
    address public signer;
    constructor(address signer_) { signer = signer_; }
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        (bytes32 r, bytes32 s, uint8 v) = _split(signature);
        return ecrecover(hash, v, r, s) == signer ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
    function _split(bytes memory sig) private pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly ("memory-safe") {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }
}

contract SessionsTest is Test {
    R3tardsPaint paint;
    MockR3tards r;
    uint256 ownerPk = 0xA11CE;
    address owner;
    address key = address(0xBEEF);

    function setUp() public {
        vm.roll(1_000); // keep ordinary tests outside deterministic DF1 storm windows
        owner = vm.addr(ownerPk);
        r = new MockR3tards();
        paint = new R3tardsPaint(address(r), uint64(vm.getBlockTimestamp()), owner, owner, 512, 0, 512, 16, 256);
    }

    function testSessionPaintAttributedToOwnerAndPaintOnly() public {
        _start(100, 300);
        vm.prank(key);
        paint.paint(hex"00000F04", new uint256[](0));
        (,,,,,, uint64 count,,, uint64 stormPaints) = paint.painterStats(owner);
        assertEq(count, 1);
        assertEq(stormPaints, 0);
        (address sessionOwner,,, uint256 spent,, bool active) = paint.sessionInfo(key);
        assertEq(sessionOwner, owner);
        assertGt(spent, 0);
        assertTrue(active);

        vm.prank(key);
        vm.expectRevert(R3tardsPaint.SessionKeyPaintOnly.selector);
        paint.mintFrame();
        vm.prank(key);
        vm.expectRevert(R3tardsPaint.SessionKeyPaintOnly.selector);
        paint.setFace(7, new uint256[](0));
    }

    function testSessionReplayExpiryRevokeAndMaxUnits() public {
        _start(3, 16);

        uint256 expectedNonce = paint.sessionNonces(owner);
        uint256 suppliedNonce = 0;
        uint256 replayExpiry = vm.getBlockNumber() + 3;
        uint256 replayDeadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory replaySig = _signatureFor(
            ownerPk, address(paint), owner, key, replayExpiry, 16, suppliedNonce, replayDeadline
        );
        vm.prank(key);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.InvalidSessionNonce.selector, expectedNonce, suppliedNonce));
        paint.startSession(owner, key, replayExpiry, 16, suppliedNonce, replayDeadline, replaySig);

        uint256 needed = 32;
        uint256 available = 16;
        vm.prank(key);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.SessionUnitsExceeded.selector, needed, available));
        paint.paint(hex"00001F04", new uint256[](0));

        vm.prank(owner);
        paint.revokeSession(key);
        assertFalse(paint.isActiveSessionKey(key));

        // Revoked keys are plain addresses again, not permanently bricked identities.
        vm.prank(key);
        paint.paint(hex"01000304", new uint256[](0));
        (,,,,,, uint64 keyPaintCount,,,) = paint.painterStats(key);
        assertEq(keyPaintCount, 1);

        address key2 = address(0xCAFE);
        _startFor(key2, 1, 100, paint.sessionNonces(owner));
        vm.roll(vm.getBlockNumber() + 2);
        assertFalse(paint.isActiveSessionKey(key2));
        vm.prank(key2);
        paint.paint(hex"02000304", new uint256[](0));
        (,,,,,, uint64 key2PaintCount,,,) = paint.painterStats(key2);
        assertEq(key2PaintCount, 1);
        vm.prank(key2);
        uint256 key2Frame = paint.mintFrame();
        assertEq(paint.ownerOf(key2Frame), key2);
    }

    function testAttackerCannotRegisterVictimAndVictimKeepsNormalActions() public {
        address attacker = address(0xBAD);
        address victim = address(0xCA11);
        uint256 expiry = vm.getBlockNumber() + 100;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        uint256 nonce = paint.sessionNonces(owner);
        bytes memory sig = _signatureFor(ownerPk, address(paint), owner, victim, expiry, 100, nonce, deadline);

        vm.prank(attacker);
        vm.expectRevert(R3tardsPaint.InvalidSessionKey.selector);
        paint.startSession(owner, victim, expiry, 100, nonce, deadline, sig);

        vm.prank(victim);
        paint.paint(hex"03000304", new uint256[](0));
        vm.prank(victim);
        uint256 frameId = paint.mintFrame();
        assertEq(paint.ownerOf(frameId), victim);
    }

    function testBurnerMustRegisterItselfAndCannotHijackActiveOwner() public {
        _start(100, 100);
        assertTrue(paint.isActiveSessionKey(key));

        uint256 otherPk = 0xB0B;
        address otherOwner = vm.addr(otherPk);
        uint256 expiry = vm.getBlockNumber() + 100;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory otherSig = _signatureFor(otherPk, address(paint), otherOwner, key, expiry, 100, 0, deadline);
        vm.prank(key);
        vm.expectRevert(abi.encodeWithSelector(R3tardsPaint.SessionKeyInUse.selector, owner));
        paint.startSession(otherOwner, key, expiry, 100, 0, deadline, otherSig);
    }

    function testKeyWithOwnerHistoryCannotBecomeSessionKey() public {
        address paintedKey = address(0x1111);
        vm.prank(paintedKey);
        paint.paint(hex"04000304", new uint256[](0));
        _expectSessionStartError(paintedKey, R3tardsPaint.SessionKeyHasOwnerHistory.selector);
    }

    function testActiveSessionKeyCannotBecomeSessionOwner() public {
        uint256 firstKeyPk = 0xBEE1;
        address firstKey = vm.addr(firstKeyPk);
        _startFor(firstKey, 100, 100, paint.sessionNonces(owner));
        assertTrue(paint.isActiveSessionKey(firstKey));

        uint256 secondKeyPk = 0xBEE2;
        address secondKey = vm.addr(secondKeyPk);
        uint256 expiry = vm.getBlockNumber() + 100;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        uint256 nonce = paint.sessionNonces(firstKey);
        bytes memory sig = _signatureFor(
            firstKeyPk, address(paint), firstKey, secondKey, expiry, 100, nonce, deadline
        );

        vm.prank(secondKey);
        vm.expectRevert(R3tardsPaint.InvalidSessionKey.selector);
        paint.startSession(firstKey, secondKey, expiry, 100, nonce, deadline, sig);
    }

    function testERC1271OwnerSignatureWorks() public {
        uint256 signerPk = 0xC0FFEE;
        address signer = vm.addr(signerPk);
        Mock1271Owner wallet = new Mock1271Owner(signer);
        R3tardsPaint p2 = new R3tardsPaint(address(r), uint64(vm.getBlockTimestamp()), address(wallet), owner, 512, 0, 512, 16, 256);
        address sessionKey = address(0x1234);
        uint256 expiry = vm.getBlockNumber() + 100;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig = _signatureFor(signerPk, address(p2), address(wallet), sessionKey, expiry, 100, 0, deadline);
        vm.prank(sessionKey);
        p2.startSession(address(wallet), sessionKey, expiry, 100, 0, deadline, sig);
        vm.prank(sessionKey);
        p2.paint(hex"00000304", new uint256[](0));
        (,,,,,, uint64 count,, uint64 sessionPaints,) = p2.painterStats(address(wallet));
        assertEq(count, 1);
        assertEq(sessionPaints, 1);
    }

    function _expectSessionStartError(address sessionKey, bytes4 selector) internal {
        uint256 expiry = vm.getBlockNumber() + 100;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        uint256 nonce = paint.sessionNonces(owner);
        bytes memory sig = _signatureFor(ownerPk, address(paint), owner, sessionKey, expiry, 100, nonce, deadline);
        vm.prank(sessionKey);
        vm.expectRevert(selector);
        paint.startSession(owner, sessionKey, expiry, 100, nonce, deadline, sig);
    }

    function _start(uint256 blocks_, uint256 maxUnits) internal {
        _startWithNonce(blocks_, maxUnits, paint.sessionNonces(owner));
    }

    function _startWithNonce(uint256 blocks_, uint256 maxUnits, uint256 nonce) internal {
        _startFor(key, blocks_, maxUnits, nonce);
    }

    function _startFor(address sessionKey, uint256 blocks_, uint256 maxUnits, uint256 nonce) internal {
        uint256 expiry = vm.getBlockNumber() + blocks_;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig = _signatureFor(ownerPk, address(paint), owner, sessionKey, expiry, maxUnits, nonce, deadline);
        vm.prank(sessionKey);
        paint.startSession(owner, sessionKey, expiry, maxUnits, nonce, deadline, sig);
    }

    function _signatureFor(
        uint256 signerPk,
        address verifyingContract,
        address owner_,
        address sessionKey,
        uint256 expiry,
        uint256 maxUnits,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 typehash = paint.SESSION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(typehash, owner_, sessionKey, expiry, maxUnits, nonce, deadline));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("r3tards paint")), keccak256(bytes("2")), block.chainid, verifyingContract
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(signerPk, digest);
        return abi.encodePacked(rr, ss, v);
    }
}
