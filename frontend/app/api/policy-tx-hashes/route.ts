import { type Address, isAddress } from "viem";
import { NextResponse } from "next/server";

import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import { fetchPolicyTxHashes } from "@/lib/server/policy-tx-hashes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("address") ?? WEATHER_INSURANCE_ADDRESS;
  if (!isAddress(raw)) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }

  try {
    const data = await fetchPolicyTxHashes(raw as Address);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch policy tx hashes";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
