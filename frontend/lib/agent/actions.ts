import { parseEther, type Address, type PublicClient } from "viem";

import { erc20Abi } from "@/lib/abi/erc20";
import { weatherInsuranceAbi } from "@/lib/contracts";
import {
  PAY_TOKEN_ADDRESS,
  WEATHER_INSURANCE_ADDRESS,
} from "@/lib/config";
import { geocodeCity } from "@/lib/geocode";
import { parseMmToMmE2 } from "@/lib/format";
import { readPolicyById } from "@/lib/policy";
import {
  formatLiquidityError,
  liquidityCoversPayout,
  readAvailableLiquidity,
} from "@/lib/pool";
import type { WeatherReport } from "@/lib/tee/instruction";
import {
  requestAndRelayPrivateBuy,
  type ContractExecute,
} from "@/lib/tee/private-buy";
import { payAndFetch } from "@/lib/tee/x402";

async function resolveCityCoords(city: string): Promise<{ lat: string; lon: string }> {
  if (typeof window !== "undefined") {
    return geocodeCity(city);
  }

  const { geocodeCityServer } = await import("@/lib/server/geocode");
  return geocodeCityServer(city);
}

export type BuyPolicyInput = {
  city: string;
  date: string;
  thresholdMm: string;
  payoutTokens: string;
  premiumTokens: string;
};

export type FetchWeatherResult = {
  instructionId: string;
  requestTx: `0x${string}`;
  report: WeatherReport;
};

export type SettlePolicyResult = {
  settleTx: `0x${string}`;
  precipitationMmE2: string;
  date: string;
  revealedThresholdMmE2: string;
  triggered: boolean;
};

export type BuyPolicyResult = {
  mode: "public" | "private";
  city: string;
  date: string;
  lat: string;
  lon: string;
  thresholdMmE2: string;
  payout: string;
  premium: string;
  buyTxHash: `0x${string}`;
  relayTxHash?: `0x${string}`;
};

export async function fetchWeatherViaX402(
  city: string,
  payer: Address,
  execute: ContractExecute,
  onStep?: (label: string) => void,
): Promise<FetchWeatherResult> {
  return payAndFetch<FetchWeatherResult>(
    "/x402/weather/fetch",
    { city, payer },
    execute,
    onStep,
  );
}

export async function settlePolicyViaX402(
  policyId: number,
  payer: Address,
  execute: ContractExecute,
  onStep?: (label: string) => void,
  publicClient?: PublicClient | null,
): Promise<SettlePolicyResult> {
  const result = await payAndFetch<SettlePolicyResult>(
    "/x402/weather/settle",
    { policyId: String(policyId), payer },
    execute,
    onStep,
  );

  if (!publicClient) {
    return result;
  }

  const policy = await readPolicyById(publicClient, policyId);
  if (!policy?.settled) {
    return result;
  }

  const gatewayThreshold = BigInt(result.revealedThresholdMmE2 || "0");
  const threshold =
    gatewayThreshold > 0n ? gatewayThreshold : policy.rainThresholdMmE2;
  const measured =
    policy.measuredMmE2 > 0n
      ? policy.measuredMmE2
      : BigInt(result.precipitationMmE2 || "0");

  return {
    ...result,
    date: result.date || policy.date,
    precipitationMmE2: measured.toString(),
    revealedThresholdMmE2: threshold.toString(),
    triggered: policy.paidOut,
  };
}

export async function buyPublicPolicy(
  input: BuyPolicyInput,
  holder: Address,
  execute: ContractExecute,
  options?: {
    onStep?: (label: string) => void;
    ensureReady?: () => Promise<void>;
    publicClient?: PublicClient | null;
    allowance?: bigint;
    refetchAllowance?: () => Promise<unknown>;
  },
): Promise<BuyPolicyResult> {
  const premium = parseEther(input.premiumTokens || "0");
  const payout = parseEther(input.payoutTokens || "0");
  const threshold = parseMmToMmE2(input.thresholdMm);

  options?.onStep?.("Checking contract setup…");
  await options?.ensureReady?.();

  if (options?.publicClient) {
    const available = await readAvailableLiquidity(
      options.publicClient,
      WEATHER_INSURANCE_ADDRESS,
    );
    if (!liquidityCoversPayout(available, payout, premium)) {
      throw new Error(formatLiquidityError(available, payout, premium));
    }
  }

  options?.onStep?.("Resolving location…");
  const { lat, lon } = await resolveCityCoords(input.city);

  const needsApproval =
    options?.allowance !== undefined && options.allowance < premium + payout;

  if (needsApproval) {
    options?.onStep?.("Approving pay token…");
    await execute({
      address: PAY_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [WEATHER_INSURANCE_ADDRESS, premium + payout],
    });
    await options?.refetchAllowance?.();
  }

  options?.onStep?.("Buying policy (public)…");
  const buyReceipt = await execute({
    address: WEATHER_INSURANCE_ADDRESS,
    abi: weatherInsuranceAbi,
    functionName: "buyPolicy",
    args: [input.date, threshold, payout, premium, lat, lon],
  });

  return {
    mode: "public",
    city: input.city,
    date: input.date,
    lat,
    lon,
    thresholdMmE2: threshold.toString(),
    payout: payout.toString(),
    premium: premium.toString(),
    buyTxHash: buyReceipt.transactionHash,
  };
}

export async function buyPrivatePolicy(
  input: BuyPolicyInput,
  holder: Address,
  execute: ContractExecute,
  options?: {
    onStep?: (label: string) => void;
    ensureReady?: () => Promise<void>;
    publicClient?: PublicClient | null;
    allowance?: bigint;
    refetchAllowance?: () => Promise<unknown>;
  },
): Promise<BuyPolicyResult> {
  const premium = parseEther(input.premiumTokens || "0");
  const payout = parseEther(input.payoutTokens || "0");
  const threshold = parseMmToMmE2(input.thresholdMm);

  options?.onStep?.("Checking contract setup…");
  await options?.ensureReady?.();

  if (options?.publicClient) {
    const available = await readAvailableLiquidity(
      options.publicClient,
      WEATHER_INSURANCE_ADDRESS,
    );
    if (!liquidityCoversPayout(available, payout, premium)) {
      throw new Error(formatLiquidityError(available, payout, premium));
    }
  }

  options?.onStep?.("Resolving location…");
  const { lat, lon } = await resolveCityCoords(input.city);

  const needsApproval =
    options?.allowance !== undefined && options.allowance < premium + payout;

  if (needsApproval) {
    options?.onStep?.("Approving pay token…");
    await execute({
      address: PAY_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [WEATHER_INSURANCE_ADDRESS, premium + payout],
    });
    await options?.refetchAllowance?.();
  }

  const privateBuy = await requestAndRelayPrivateBuy(
    {
      holder,
      date: input.date,
      rainThresholdMmE2: threshold,
      payout,
      premium,
      lat,
      lon,
    },
    execute,
    options?.onStep,
    options?.publicClient,
  );

  return {
    mode: "private",
    city: input.city,
    date: input.date,
    lat,
    lon,
    thresholdMmE2: threshold.toString(),
    payout: payout.toString(),
    premium: premium.toString(),
    buyTxHash: privateBuy.buyReceipt.transactionHash,
    relayTxHash: privateBuy.relayReceipt.transactionHash,
  };
}
