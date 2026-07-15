"use client";

import { useQuery } from "@tanstack/react-query";
import type { Hash } from "viem";

import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";

export type PolicyTxHashMaps = {
  buy: Map<bigint, Hash>;
  settle: Map<bigint, Hash>;
};

export function policyTxHashesQueryKey(policyCount?: bigint) {
  return [
    "policyTxHashes",
    WEATHER_INSURANCE_ADDRESS,
    policyCount?.toString() ?? "0",
  ] as const;
}

function toMap(record: Record<string, string>): Map<bigint, Hash> {
  const map = new Map<bigint, Hash>();
  for (const [id, hash] of Object.entries(record)) {
    map.set(BigInt(id), hash as Hash);
  }
  return map;
}

export function usePolicyTxHashes(policyCount?: bigint) {
  return useQuery({
    queryKey: policyTxHashesQueryKey(policyCount),
    queryFn: async (): Promise<PolicyTxHashMaps> => {
      const params = new URLSearchParams({ address: WEATHER_INSURANCE_ADDRESS });
      const res = await fetch(`/api/policy-tx-hashes?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `policy tx hashes failed (${res.status})`);
      }
      const data = (await res.json()) as {
        buy: Record<string, string>;
        settle: Record<string, string>;
      };
      return {
        buy: toMap(data.buy),
        settle: toMap(data.settle),
      };
    },
    staleTime: 0,
  });
}
