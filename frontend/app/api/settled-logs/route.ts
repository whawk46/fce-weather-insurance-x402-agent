import { NextResponse } from "next/server";

import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import { fetchSettledLogsFromExplorer } from "@/lib/explorer";

const EXPLORER_API_URL = "https://coston2-explorer.flare.network/api";

export async function GET() {
  try {
    const logs = await fetchSettledLogsFromExplorer(
      EXPLORER_API_URL,
      WEATHER_INSURANCE_ADDRESS,
    );
    return NextResponse.json({
      logs: logs.map((log) => ({
        policyId: log.policyId.toString(),
        paidOut: log.paidOut,
        transactionHash: log.transactionHash,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch settled logs";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
