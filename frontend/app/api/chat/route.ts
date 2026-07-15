import { createAgentUIStreamResponse } from "ai";
import type { Address } from "viem";

import {
  createInsuranceAgent,
  isAgentConfigured,
} from "@/lib/agent/insurance-agent";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAgentConfigured()) {
    return new Response(
      JSON.stringify({
        error:
          "OPENAI_API_KEY is not configured. Add it to frontend/.env.local to enable the AI agent.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: {
    messages?: unknown[];
    walletAddress?: string;
    deviceCity?: string;
    todayDate?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = body.messages ?? [];
  const walletAddress = body.walletAddress?.trim() as Address | undefined;
  const deviceCity = body.deviceCity?.trim() || undefined;
  const todayDate = body.todayDate?.trim() || undefined;

  const agent = createInsuranceAgent(walletAddress, deviceCity, todayDate);

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
  });
}
