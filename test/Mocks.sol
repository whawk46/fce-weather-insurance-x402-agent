// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ITeeExtensionRegistry } from "../contracts/interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "../contracts/interfaces/ITeeMachineRegistry.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockTeeExtensionRegistry is ITeeExtensionRegistry {
    // counter > 1 so setExtensionId can resolve to extension id 1 (_extensionId must be non-zero).
    uint256 public counter = 2;
    address public instructionsSender;
    bytes32 public lastInstructionId;

    function setInstructionsSender(address sender) external {
        instructionsSender = sender;
    }

    function extensionsCounter() external view returns (uint256) {
        return counter;
    }

    function getTeeExtensionInstructionsSender(uint256 extensionId) external view returns (address) {
        if (extensionId == 1) {
            return instructionsSender;
        }
        return address(0);
    }

    function sendInstructions(address[] calldata, TeeInstructionParams calldata params)
        external
        payable
        returns (bytes32 instructionId)
    {
        lastInstructionId = keccak256(abi.encodePacked(block.timestamp, msg.sender, params.message));
        return lastInstructionId;
    }
}

contract MockTeeMachineRegistry is ITeeMachineRegistry {
    function getRandomTeeIds(uint256, uint256 count) external pure returns (address[] memory teeIds) {
        teeIds = new address[](count);
        teeIds[0] = address(uint160(0x7EE));
    }
}
