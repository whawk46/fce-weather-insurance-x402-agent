import type { Address, PublicClient } from "viem";

import { weatherInsuranceAbi } from "@/lib/contracts";
import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export type PolicyRow = {
  policyholder: Address;
  date: string;
  rainThresholdMmE2: bigint;
  payout: bigint;
  premium: bigint;
  measuredMmE2: bigint;
  settled: boolean;
  paidOut: boolean;
  isPrivate: boolean;
  termsCommitment: `0x${string}`;
  lat: string;
  lon: string;
  settlementUnlockAt: bigint;
};

export async function readPolicyById(
  client: PublicClient,
  policyId: number,
): Promise<PolicyRow | null> {
  const raw = await client.readContract({
    address: WEATHER_INSURANCE_ADDRESS,
    abi: weatherInsuranceAbi,
    functionName: "policies",
    args: [BigInt(policyId)],
  });
  return normalizePolicyReadResult(raw);
}

/** Private buys use relayPrivateBuy; commitment stays set after settlement. */
export function isPrivatePolicy(
  p: Pick<PolicyRow, "isPrivate" | "termsCommitment">,
): boolean {
  return (
    p.isPrivate ||
    (p.termsCommitment !== ZERO_BYTES32 && p.termsCommitment !== "0x0")
  );
}

/** Viem returns `policies(id)` as a positional tuple when the ABI lists flattened struct fields. */
export function normalizePolicyReadResult(raw: unknown): PolicyRow | null {
  if (raw == null) return null;

  if (typeof raw === "object" && "policyholder" in raw) {
    const named = raw as PolicyRow;
    if (named.policyholder) return named;
  }

  const tuple = raw as readonly unknown[];
  const policyholder = tuple[0];
  if (typeof policyholder !== "string" || !policyholder.startsWith("0x")) {
    return null;
  }

  const toBigInt = (v: unknown): bigint => {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(v);
    if (typeof v === "string" && v !== "") return BigInt(v);
    return 0n;
  };

  return {
    policyholder: policyholder as Address,
    date: typeof tuple[1] === "string" ? tuple[1] : "",
    rainThresholdMmE2: toBigInt(tuple[2]),
    payout: toBigInt(tuple[3]),
    premium: toBigInt(tuple[4]),
    measuredMmE2: toBigInt(tuple[5]),
    settled: Boolean(tuple[6]),
    paidOut: Boolean(tuple[7]),
    isPrivate: Boolean(tuple[8]),
    termsCommitment: (typeof tuple[9] === "string" ? tuple[9] : "0x0") as `0x${string}`,
    lat: typeof tuple[10] === "string" ? tuple[10] : "",
    lon: typeof tuple[11] === "string" ? tuple[11] : "",
    settlementUnlockAt: toBigInt(tuple[12]),
  };
}
