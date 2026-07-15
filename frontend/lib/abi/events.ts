import { parseAbi } from "viem";

export const weatherInsuranceEventsAbi = parseAbi([
  "event PrivateBuyRequested(bytes32 indexed instructionId, address indexed holder)",
  "event SettlementRequested(uint256 indexed policyId, bytes32 instructionId)",
  "event PolicyBought(uint256 indexed policyId, address indexed holder, string date, uint256 rainThresholdMmE2, uint256 payout, uint256 premium)",
]);

/** Emitted by TeeExtensionRegistry / Verification on sendInstructions (e.g. getWeather). */
export const teeRegistryEventsAbi = parseAbi([
  "event TeeInstructionsSent(uint256 indexed extensionId, bytes32 indexed instructionId, uint32 indexed rewardEpochId, (address teeId, address teeProxyId, string url)[] teeMachines, bytes32 opType, bytes32 opCommand, bytes message, address[] cosigners, uint64 cosignersThreshold, address claimBackAddress, uint256 fee)",
]);
