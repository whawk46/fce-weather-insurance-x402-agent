"use client";

import { useMemo } from "react";
import { useAccount, useSimulateContract } from "wagmi";

import { weatherInsuranceAbi } from "@/lib/contracts";
import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";

export type ExtensionReadyStatus =
  | "disconnected"
  | "checking"
  | "ready"
  | "needs_set"
  | "not_registered"
  | "unknown";

function statusFromSimulate(
  hasAccount: boolean,
  isLoading: boolean,
  hasSimData: boolean,
  errorMessage: string | undefined,
): ExtensionReadyStatus {
  if (!hasAccount) return "disconnected";
  if (isLoading) return "checking";
  if (hasSimData) return "needs_set";
  const msg = errorMessage ?? "";
  if (msg.includes("Extension ID already set")) return "ready";
  if (msg.includes("Extension ID not found")) return "not_registered";
  if (msg.includes("Extension ID is not set")) return "needs_set";
  return "unknown";
}

export function useExtensionReady() {
  const { address, isConnected } = useAccount();

  const {
    data: simData,
    error: simError,
    isLoading,
    refetch,
  } = useSimulateContract({
    address: WEATHER_INSURANCE_ADDRESS,
    abi: weatherInsuranceAbi,
    functionName: "setExtensionId",
    account: address,
    query: { enabled: isConnected && !!address, retry: false },
  });

  const status = useMemo(
    () =>
      statusFromSimulate(
        !!address,
        isLoading,
        !!simData,
        simError?.message,
      ),
    [address, isLoading, simData, simError?.message],
  );

  return { status, refetch };
}
