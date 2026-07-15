import type { Address, PublicClient } from "viem";

import { weatherInsuranceAbi } from "@/lib/contracts";
import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";

/**
 * Matches InstructionSender._createPolicy: premium is transferred first, then
 * require(payout <= availableLiquidity()).
 */
export function liquidityCoversPayout(
  availableLiquidity: bigint,
  payout: bigint,
  premium: bigint,
): boolean {
  return payout <= availableLiquidity + premium;
}

export async function readAvailableLiquidity(
  publicClient: PublicClient,
  contractAddress: Address = WEATHER_INSURANCE_ADDRESS,
): Promise<bigint> {
  return (await publicClient.readContract({
    address: contractAddress,
    abi: weatherInsuranceAbi,
    functionName: "availableLiquidity",
  })) as bigint;
}

export function formatLiquidityError(
  available: bigint,
  payout: bigint,
  premium: bigint,
): string {
  return (
    "Insufficient pool liquidity for this payout. " +
    `Need payout ≤ available + premium (${payout} ≤ ${available} + ${premium}). ` +
    "Fund the pool in the Payout pool section or run: bash ./scripts/test.sh (funds 10 WPT)."
  );
}
