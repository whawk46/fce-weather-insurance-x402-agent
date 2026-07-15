// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test, Vm } from "forge-std/Test.sol";
import { WeatherInsurance } from "../contracts/InstructionSender.sol";
import { MockERC20, MockTeeExtensionRegistry, MockTeeMachineRegistry } from "./Mocks.sol";

/// @notice Covers the x402 gateway gating (onlyGateway) and the on-chain feeToken
/// enforcement on getWeather/requestSettlement — the fee must be pulled atomically
/// via transferFrom from the payer the gateway names, and only the gateway may
/// call these functions at all.
contract WeatherInsuranceFeeTest is Test {
    WeatherInsurance internal wi;
    MockERC20 internal payToken;
    MockERC20 internal feeToken;
    MockTeeExtensionRegistry internal extReg;
    MockTeeMachineRegistry internal machReg;

    address internal owner;
    address internal gatewayAddr;
    address internal payer;
    address internal recipient;

    function setUp() public {
        owner = address(this);
        gatewayAddr = makeAddr("gateway");
        payer = makeAddr("payer");
        recipient = makeAddr("recipient");

        extReg = new MockTeeExtensionRegistry();
        machReg = new MockTeeMachineRegistry();
        payToken = new MockERC20();
        feeToken = new MockERC20();

        wi = new WeatherInsurance(extReg, machReg);
        extReg.setInstructionsSender(address(wi));
        wi.setExtensionId();
        wi.setPayToken(address(payToken));
        wi.setGateway(gatewayAddr);

        vm.deal(gatewayAddr, 1 ether);
    }

    function _fundAndApprove(uint256 amount) internal {
        feeToken.mint(payer, amount);
        vm.prank(payer);
        feeToken.approve(address(wi), amount);
    }

    // --- onlyGateway ---

    function test_getWeather_revertsIfNotCalledByGateway() public {
        vm.prank(payer);
        vm.expectRevert("only gateway");
        wi.getWeather("Berlin,DE", payer);
    }

    function test_requestSettlement_revertsIfNotCalledByGateway() public {
        uint256 policyId = _buyPolicySettleableNow();

        vm.prank(payer);
        vm.expectRevert("only gateway");
        wi.requestSettlement(policyId, payer);
    }

    function test_setGateway_onlyOwner() public {
        vm.prank(payer);
        vm.expectRevert("not owner");
        wi.setGateway(payer);
    }

    function test_setGateway_rejectsZeroAddress() public {
        vm.expectRevert("zero gateway");
        wi.setGateway(address(0));
    }

    // --- getWeather ---

    function test_getWeather_emitsWeatherRequestedWithPayer() public {
        vm.recordLogs();
        vm.prank(gatewayAddr);
        wi.getWeather("Berlin,DE", payer);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 topic = keccak256("WeatherRequested(bytes32,address)");
        bool found = false;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == topic) {
                assertEq(entries[i].topics[2], bytes32(uint256(uint160(payer))));
                found = true;
            }
        }
        assertTrue(found, "WeatherRequested not emitted");
    }

    function test_getWeather_noFeeConfigured_doesNotPullFeeToken() public {
        vm.prank(gatewayAddr);
        wi.getWeather("Berlin,DE", payer);
        assertEq(feeToken.balanceOf(payer), 0);
    }

    function test_getWeather_pullsFeeFromPayerNotGateway() public {
        wi.setFeeToken(address(feeToken));
        wi.setFeeRecipient(recipient);
        wi.setFetchFee(10_000);
        _fundAndApprove(10_000);

        vm.prank(gatewayAddr);
        wi.getWeather("Berlin,DE", payer);

        assertEq(feeToken.balanceOf(recipient), 10_000);
        assertEq(feeToken.balanceOf(payer), 0);
        assertEq(feeToken.balanceOf(gatewayAddr), 0);
    }

    function test_getWeather_revertsWithoutPayerAllowance() public {
        wi.setFeeToken(address(feeToken));
        wi.setFeeRecipient(recipient);
        wi.setFetchFee(10_000);
        feeToken.mint(payer, 10_000); // funded but never approved

        vm.prank(gatewayAddr);
        vm.expectRevert("allowance");
        wi.getWeather("Berlin,DE", payer);
    }

    function test_getWeather_revertsIfFeeTokenUnset() public {
        wi.setFeeRecipient(recipient);
        wi.setFetchFee(10_000);

        vm.prank(gatewayAddr);
        vm.expectRevert("fee token not set");
        wi.getWeather("Berlin,DE", payer);
    }

    function test_getWeather_revertsIfRecipientUnset() public {
        wi.setFeeToken(address(feeToken));
        wi.setFetchFee(10_000);
        _fundAndApprove(10_000);

        vm.prank(gatewayAddr);
        vm.expectRevert("fee recipient not set");
        wi.getWeather("Berlin,DE", payer);
    }

    function test_getWeather_emitsFeeCollected() public {
        wi.setFeeToken(address(feeToken));
        wi.setFeeRecipient(recipient);
        wi.setFetchFee(10_000);
        _fundAndApprove(10_000);

        vm.expectEmit(true, true, false, true);
        emit WeatherInsuranceEvents.FeeCollected(payer, 10_000, bytes32("FETCH"));
        vm.prank(gatewayAddr);
        wi.getWeather("Berlin,DE", payer);
    }

    // --- requestSettlement ---

    function test_requestSettlement_pullsSettleFeeFromPayer() public {
        wi.setFeeToken(address(feeToken));
        wi.setFeeRecipient(recipient);
        wi.setSettleFee(20_000);
        _fundAndApprove(20_000);

        uint256 policyId = _buyPolicySettleableNow();

        vm.prank(gatewayAddr);
        wi.requestSettlement(policyId, payer);

        assertEq(feeToken.balanceOf(recipient), 20_000);
    }

    function test_requestSettlement_revertsWithoutPayerAllowance() public {
        wi.setFeeToken(address(feeToken));
        wi.setFeeRecipient(recipient);
        wi.setSettleFee(20_000);
        feeToken.mint(payer, 20_000);

        uint256 policyId = _buyPolicySettleableNow();

        vm.prank(gatewayAddr);
        vm.expectRevert("allowance");
        wi.requestSettlement(policyId, payer);
    }

    function test_requestSettlement_noFeeConfigured_doesNotPullFeeToken() public {
        uint256 policyId = _buyPolicySettleableNow();

        vm.prank(gatewayAddr);
        wi.requestSettlement(policyId, payer);

        assertEq(feeToken.balanceOf(recipient), 0);
    }

    // --- setters ---

    function test_setFetchFee_onlyOwner() public {
        vm.prank(payer);
        vm.expectRevert("not owner");
        wi.setFetchFee(1);
    }

    function test_setFeeToken_rejectsZeroAddress() public {
        vm.expectRevert("zero token");
        wi.setFeeToken(address(0));
    }

    function test_setFeeRecipient_rejectsZeroAddress() public {
        vm.expectRevert("zero recipient");
        wi.setFeeRecipient(address(0));
    }

    // --- helpers ---

    /// @notice Buys a public policy for `payer` with a coverage date far enough in
    /// the past that settlement is immediately open, so requestSettlement doesn't
    /// revert on timing before we get to assert on the fee.
    function _buyPolicySettleableNow() internal returns (uint256 policyId) {
        payToken.mint(payer, 100 ether);
        payToken.mint(address(wi), 50 ether);
        vm.prank(payer);
        payToken.approve(address(wi), 1 ether);

        vm.warp(2_000_000_000); // 2033-05-18 — comfortably past any hardcoded past date below
        vm.prank(payer);
        policyId = wi.buyPolicy("2020-01-01", 100, 10 ether, 1 ether, "52.52", "13.405");
    }
}

/// @notice Mirrors WeatherInsurance's FeeCollected event signature for vm.expectEmit.
interface WeatherInsuranceEvents {
    event FeeCollected(address indexed payer, uint256 amount, bytes32 indexed kind);
}
