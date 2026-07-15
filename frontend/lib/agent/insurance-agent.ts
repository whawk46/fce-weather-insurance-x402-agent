import type { Address } from "viem";
import { InferAgentUIMessage, stepCountIs, ToolLoopAgent } from "ai";
import { openai } from "@ai-sdk/openai";

import { geocodeCityTool } from "@/lib/agent/tools/geocode";
import { createListPoliciesTool } from "@/lib/agent/tools/list-policies";
import { getPoolStatsTool } from "@/lib/agent/tools/pool-stats";
import {
  buyPolicyPrivateTool,
  buyPolicyTool,
  fetchWeatherX402Tool,
  settlePolicyX402Tool,
} from "@/lib/agent/tools/client-tools";

import {
  todayIsoDateLocal,
  tomorrowIsoDateLocal,
} from "@/lib/format";

function buildInstructions(
  walletAddress?: Address,
  deviceCity?: string,
  todayDate?: string,
): string {
  const walletLine = walletAddress
    ? `The user wallet is connected: ${walletAddress}.`
    : "No wallet is connected — advise the user to connect MetaMask on Coston2 before buy, fetch, or settle actions.";

  const locationLine = deviceCity
    ? `The user's device location resolves to: ${deviceCity}. Prefer this city for weather checks and policy coverage unless they specify another place.`
    : "Device location is not available — ask for a city (City,CC format) when needed.";

  const today = todayDate ?? todayIsoDateLocal();
  const tomorrow = tomorrowIsoDateLocal(
    todayDate ? new Date(`${todayDate}T12:00:00`) : new Date(),
  );

  return `You are a parametric rainfall insurance assistant for the Flare Coston2 Weather Insurance dApp.

${walletLine}
${locationLine}

## Dates
- Today (user local): ${today}
- Tomorrow: ${tomorrow}
- Coverage dates must be YYYY-MM-DD. When the user says "tomorrow", use ${tomorrow} exactly — never invent or reuse old dates.

## Product
- Policies pay out when daily rainfall at a chosen city meets or exceeds a threshold on a coverage date.
- Weather data comes from OpenWeatherMap inside a Flare Confidential Compute (FCC) TEE.
- Premiums and payouts use the pool pay token (typically WPT).

## Tools
- geocodeCity: resolve city → coordinates (no wallet needed)
- getPoolStats: read pool liquidity (no wallet needed)
- listPolicies: read on-chain policies for the connected wallet
- fetchWeatherX402: live TEE weather fetch — requires wallet (x402 fee approval)
- settlePolicyX402: settle a policy after unlock — requires wallet (x402 fee)
- buyPolicy: public on-chain buy — requires wallet + user confirmation in UI
- buyPolicyPrivate: ECIES private buy — threshold hidden on-chain — requires wallet + confirmation

## Guidelines
- Explain x402 micropayments before fetch/settle: the user approves a small feeToken fee, then the gateway relays the on-chain call.
- Recommend fetchWeatherX402 before suggesting thresholds for a city.
- Policy IDs are 0-based on-chain indices from listPolicies.
- Settlement opens the day after the coverage date at midnight UTC (settlementUnlockAt).
- Default demo amounts: premium 1 WPT, payout 10 WPT, threshold 1–2 mm.
- For private policies, explain that rain threshold is encrypted and only the TEE sees it.
- If pool liquidity is insufficient, suggest funding the pool or lowering payout.
- Be concise and actionable. When executing wallet tools, tell the user what to expect (MetaMask prompts, TEE polling).`;
}

export function createInsuranceAgent(
  walletAddress?: Address,
  deviceCity?: string,
  todayDate?: string,
) {
  const modelId = process.env.AI_MODEL?.trim() || "gpt-4.1-mini";

  return new ToolLoopAgent({
    model: openai(modelId),
    instructions: buildInstructions(walletAddress, deviceCity, todayDate),
    tools: {
      geocodeCity: geocodeCityTool,
      getPoolStats: getPoolStatsTool,
      listPolicies: createListPoliciesTool(walletAddress),
      fetchWeatherX402: fetchWeatherX402Tool,
      settlePolicyX402: settlePolicyX402Tool,
      buyPolicy: buyPolicyTool,
      buyPolicyPrivate: buyPolicyPrivateTool,
    },
    stopWhen: stepCountIs(12),
  });
}

export type InsuranceAgent = ReturnType<typeof createInsuranceAgent>;
export type InsuranceAgentUIMessage = InferAgentUIMessage<InsuranceAgent>;

export function isAgentConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}
