// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { WeatherInsurance } from "../contracts/InstructionSender.sol";
import { MockERC20, MockTeeExtensionRegistry, MockTeeMachineRegistry } from "./Mocks.sol";

contract WeatherInsurancePrivateBuyTest is Test {
    WeatherInsurance internal wi;
    MockERC20 internal token;
    MockTeeExtensionRegistry internal extReg;
    MockTeeMachineRegistry internal machReg;

    uint256 internal teePk = 0xA11CE;
    address internal holder;
    address internal teeAddr;
    address internal gatewayAddr;

    function setUp() public {
        holder = makeAddr("holder");
        teeAddr = vm.addr(teePk);
        gatewayAddr = makeAddr("gateway");

        extReg = new MockTeeExtensionRegistry();
        machReg = new MockTeeMachineRegistry();
        token = new MockERC20();

        wi = new WeatherInsurance(extReg, machReg);
        extReg.setInstructionsSender(address(wi));
        wi.setExtensionId();

        wi.setPayToken(address(token));
        wi.setTeeAddress(teeAddr);
        wi.setGateway(gatewayAddr);
        vm.deal(gatewayAddr, 1 ether);

        token.mint(holder, 100 ether);
        token.mint(address(wi), 50 ether);
        vm.deal(holder, 1 ether);
    }

    function test_buyPolicyPrivate_sendsEncryptedInstruction() public {
        bytes memory ciphertext = hex"deadbeef";

        vm.prank(holder);
        wi.buyPolicyPrivate{value: 1000}(ciphertext);

        assertEq(extReg.lastInstructionId(), keccak256(abi.encodePacked(block.timestamp, address(wi), ciphertext)));
    }

    function test_relayPrivateBuy_createsPolicyWithValidTeeSignature() public {
        string memory date = "2026-06-16";
        uint256 threshold = 100;
        uint256 payout = 10 ether;
        uint256 premium = 1 ether;
        string memory lat = "52.52";
        string memory lon = "13.405";

        bytes memory resultData = abi.encode(holder, address(wi), date, threshold, payout, premium, lat, lon);
        bytes32 actionId = keccak256("action");
        string memory tag = "submit";
        uint8 status = 1;
        bytes memory sig = _signActionResult(teePk, resultData, actionId, tag, status);

        vm.prank(holder);
        token.approve(address(wi), premium);

        vm.prank(holder);
        uint256 policyId = wi.relayPrivateBuy(resultData, actionId, tag, status, sig);

        assertEq(policyId, 0);
        (
            address policyholder,
            string memory storedDate,
            uint256 rainThresholdMmE2,
            uint256 storedPayout,
            uint256 storedPremium,
            ,
            ,
            ,
            bool isPrivate,
            bytes32 termsCommitment,
            string memory storedLat,
            string memory storedLon,
            uint64 settlementUnlockAt
        ) = wi.policies(policyId);

        assertEq(policyholder, holder);
        assertTrue(isPrivate);
        assertEq(storedDate, date);
        assertEq(rainThresholdMmE2, 0);
        assertEq(storedPayout, payout);
        assertEq(storedPremium, premium);
        assertTrue(termsCommitment != bytes32(0));
        assertEq(storedLat, lat);
        assertEq(storedLon, lon);
        assertEq(settlementUnlockAt, 1781654400); // 2026-06-17 00:00 UTC (day after 2026-06-16)
        assertEq(token.balanceOf(holder), 100 ether - premium);
    }

    function test_requestSettlement_revertsBeforeUnlock() public {
        string memory date = "2099-01-01";
        bytes memory resultData = abi.encode(holder, address(wi), date, uint256(1), uint256(1 ether), uint256(1), "52.52", "13.405");
        bytes32 actionId = keccak256("action");
        bytes memory sig = _signActionResult(teePk, resultData, actionId, "submit", 1);

        vm.prank(holder);
        token.approve(address(wi), 1 ether);
        vm.prank(holder);
        uint256 policyId = wi.relayPrivateBuy(resultData, actionId, "submit", 1, sig);

        vm.prank(gatewayAddr);
        vm.expectRevert("settlement not open yet");
        wi.requestSettlement{value: 1000}(policyId, holder);
    }

    function test_requestSettlement_allowedAfterUnlock() public {
        string memory date = "2020-06-16";
        bytes memory resultData = abi.encode(holder, address(wi), date, uint256(1), uint256(1 ether), uint256(1), "52.52", "13.405");
        bytes32 actionId = keccak256("action");
        bytes memory sig = _signActionResult(teePk, resultData, actionId, "submit", 1);

        vm.prank(holder);
        token.approve(address(wi), 1 ether);
        vm.prank(holder);
        uint256 policyId = wi.relayPrivateBuy(resultData, actionId, "submit", 1, sig);

        (, , , , , , , , , , , , uint64 unlockAt) = wi.policies(policyId);
        vm.warp(unlockAt);

        vm.prank(gatewayAddr);
        wi.requestSettlement{value: 1000}(policyId, holder);
    }

    function test_relayPrivateBuy_revertsOnBadSignature() public {
        bytes memory resultData =
            abi.encode(holder, address(wi), "2026-06-16", uint256(1), uint256(1 ether), uint256(1), "52.52", "13.405");
        bytes32 actionId = keccak256("action");
        bytes memory sig = _signActionResult(teePk + 1, resultData, actionId, "submit", 1);

        vm.prank(holder);
        token.approve(address(wi), 1);

        vm.prank(holder);
        vm.expectRevert("bad TEE signature");
        wi.relayPrivateBuy(resultData, actionId, "submit", 1, sig);
    }

    function test_settle_privatePolicy_revealsTerms() public {
        string memory date = "2026-06-16";
        uint256 threshold = 100;
        uint256 payout = 10 ether;
        uint256 premium = 1 ether;
        uint256 policyId = _relayPrivateBuy(date, threshold, payout, premium, "52.52", "13.405");

        (, , , , , , , , , , , , uint64 unlockAt) = wi.policies(policyId);
        vm.warp(unlockAt);

        uint256 measured = 150; // mm×100, above threshold
        bytes memory settleData =
            abi.encode(address(wi), policyId, measured, date, threshold, true);
        bytes32 actionId = keccak256("settle-action");
        bytes memory sig = _signActionResult(teePk, settleData, actionId, "submit", 1);

        uint256 balBefore = token.balanceOf(holder);
        wi.settle(settleData, actionId, "submit", 1, sig);

        (
            ,
            string memory storedDate,
            uint256 rainThresholdMmE2,
            ,
            ,
            uint256 measuredMmE2,
            bool settled,
            bool paidOut,
            bool isPrivate,
            bytes32 termsCommitment,
            ,
            ,
        ) = wi.policies(policyId);

        assertFalse(isPrivate);
        assertEq(storedDate, date);
        assertEq(rainThresholdMmE2, threshold);
        assertTrue(settled);
        assertTrue(paidOut);
        assertEq(measuredMmE2, measured);
        assertTrue(termsCommitment != bytes32(0));
        assertEq(token.balanceOf(holder), balBefore + payout);
    }

    function test_settle_privatePolicy_revertsOnTermsMismatch() public {
        string memory date = "2026-06-16";
        uint256 threshold = 100;
        uint256 policyId = _relayPrivateBuy(date, threshold, 10 ether, 1 ether, "52.52", "13.405");

        (, , , , , , , , , , , , uint64 unlockAt) = wi.policies(policyId);
        vm.warp(unlockAt);

        bytes memory settleData = abi.encode(address(wi), policyId, uint256(50), date, threshold + 1, false);
        bytes32 actionId = keccak256("settle-bad");
        bytes memory sig = _signActionResult(teePk, settleData, actionId, "submit", 1);

        vm.expectRevert("terms mismatch");
        wi.settle(settleData, actionId, "submit", 1, sig);
    }

    function test_relayPrivateBuy_revertsWhenCallerNotHolder() public {
        bytes memory resultData =
            abi.encode(holder, address(wi), "2026-06-16", uint256(1), uint256(1 ether), uint256(1), "52.52", "13.405");
        bytes32 actionId = keccak256("action");
        bytes memory sig = _signActionResult(teePk, resultData, actionId, "submit", 1);

        address other = makeAddr("other");
        vm.prank(other);
        vm.expectRevert("not holder");
        wi.relayPrivateBuy(resultData, actionId, "submit", 1, sig);
    }

    function _relayPrivateBuy(
        string memory date,
        uint256 threshold,
        uint256 payout,
        uint256 premium,
        string memory lat,
        string memory lon
    ) internal returns (uint256 policyId) {
        bytes memory resultData = abi.encode(holder, address(wi), date, threshold, payout, premium, lat, lon);
        bytes32 actionId = keccak256("relay");
        bytes memory sig = _signActionResult(teePk, resultData, actionId, "submit", 1);

        vm.prank(holder);
        token.approve(address(wi), premium);
        vm.prank(holder);
        return wi.relayPrivateBuy(resultData, actionId, "submit", 1, sig);
    }

    function _signActionResult(
        uint256 privateKey,
        bytes memory data,
        bytes32 actionId,
        string memory tag,
        uint8 status
    ) internal view returns (bytes memory) {
        bytes32 resultHash = keccak256(
            abi.encodePacked(keccak256(data), actionId, keccak256(bytes(tag)), status)
        );
        // The TEE node signs a domain-separated payload over resultHash, not resultHash
        // directly — mirrors TEE_ACTION_RESULT_PREFIX in InstructionSender.sol.
        bytes32 payloadHash = keccak256(abi.encode(bytes32("TEE_ACTION_RESULT"), block.chainid, resultHash));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethHash);
        return abi.encodePacked(r, s, v);
    }
}
