import type { Address } from "viem";

import { erc20Abi } from "@/lib/abi/erc20";
import { weatherInsuranceAbi } from "@/lib/contracts";
import { PAY_TOKEN_ADDRESS, WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import { isPrivatePolicy, normalizePolicyReadResult } from "@/lib/policy";
import { canSettleNow } from "@/lib/settlement-time";
import { publicClient } from "@/lib/server/viem";

export type PolicySummary = {
  policyId: number;
  policyholder: Address;
  date: string;
  rainThresholdMmE2: string;
  payout: string;
  premium: string;
  measuredMmE2: string;
  settled: boolean;
  paidOut: boolean;
  isPrivate: boolean;
  lat: string;
  lon: string;
  settlementUnlockAt: string;
  canSettle: boolean;
  status: "active" | "paid" | "no-payout";
};

function policyStatus(p: { settled: boolean; paidOut: boolean }): PolicySummary["status"] {
  if (!p.settled) return "active";
  if (p.paidOut) return "paid";
  return "no-payout";
}

export async function readPolicySummaries(holder?: Address): Promise<PolicySummary[]> {
  const count = (await publicClient.readContract({
    address: WEATHER_INSURANCE_ADDRESS,
    abi: weatherInsuranceAbi,
    functionName: "policyCount",
  })) as bigint;

  const n = Number(count);
  if (n === 0) return [];

  const block = await publicClient.getBlock();
  const nowSec = block.timestamp;

  const summaries: PolicySummary[] = [];

  for (let policyId = 0; policyId < n; policyId++) {
    const raw = await publicClient.readContract({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "policies",
      args: [BigInt(policyId)],
    });

    const p = normalizePolicyReadResult(raw);
    if (!p) continue;

    if (holder && p.policyholder.toLowerCase() !== holder.toLowerCase()) {
      continue;
    }

    const isOwner = !holder || p.policyholder.toLowerCase() === holder.toLowerCase();
    const settlementOpen = canSettleNow(p.settlementUnlockAt, nowSec);

    summaries.push({
      policyId,
      policyholder: p.policyholder,
      date: p.date,
      rainThresholdMmE2: p.rainThresholdMmE2.toString(),
      payout: p.payout.toString(),
      premium: p.premium.toString(),
      measuredMmE2: p.measuredMmE2.toString(),
      settled: p.settled,
      paidOut: p.paidOut,
      isPrivate: isPrivatePolicy(p),
      lat: p.lat,
      lon: p.lon,
      settlementUnlockAt: p.settlementUnlockAt.toString(),
      canSettle: isOwner && !p.settled && settlementOpen,
      status: policyStatus(p),
    });
  }

  return summaries;
}

export async function readPoolStats(): Promise<{
  availableLiquidity: string;
  reserved: string;
  contractBalance: string;
  payTokenSymbol: string;
}> {
  const [availableLiquidity, reserved, contractBalance, payTokenSymbol] =
    await Promise.all([
      publicClient.readContract({
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "availableLiquidity",
      }),
      publicClient.readContract({
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "reserved",
      }),
      publicClient.readContract({
        address: PAY_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [WEATHER_INSURANCE_ADDRESS],
      }),
      publicClient.readContract({
        address: PAY_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "symbol",
      }),
    ]);

  return {
    availableLiquidity: (availableLiquidity as bigint).toString(),
    reserved: (reserved as bigint).toString(),
    contractBalance: (contractBalance as bigint).toString(),
    payTokenSymbol:
      typeof payTokenSymbol === "string" && payTokenSymbol.length > 0
        ? payTokenSymbol
        : "WPT",
  };
}
