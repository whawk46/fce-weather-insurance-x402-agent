"use client";

import { useQuery } from "@tanstack/react-query";

import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";

type SettledLogsResponse = {
  logs: Array<{
    policyId: string;
    paidOut: boolean;
    transactionHash: `0x${string}`;
  }>;
};

/** policyId → settle transaction hash for all settled policies. */
export function useSettledTxHashes() {
  return useQuery({
    queryKey: ["settledTxHashes", WEATHER_INSURANCE_ADDRESS],
    queryFn: async () => {
      const res = await fetch("/api/settled-logs");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `settled-logs API returned ${res.status}`);
      }

      const { logs } = (await res.json()) as SettledLogsResponse;
      const map = new Map<bigint, `0x${string}`>();
      for (const log of logs) {
        map.set(BigInt(log.policyId), log.transactionHash);
      }
      return map;
    },
    refetchInterval: 10_000,
  });
}
