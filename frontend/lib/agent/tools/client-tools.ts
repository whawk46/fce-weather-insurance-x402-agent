import { tool } from "ai";
import { z } from "zod";

const buyInputSchema = z.object({
  city: z.string().describe("Coverage location, e.g. Berlin,DE"),
  date: z.string().describe("Coverage date YYYY-MM-DD"),
  thresholdMm: z
    .string()
    .describe("Minimum daily rainfall in mm to trigger payout, e.g. 1.00"),
  payoutTokens: z.string().describe("Payout amount in pay token units, e.g. 10"),
  premiumTokens: z.string().describe("Premium in pay token units, e.g. 1"),
});

const weatherReportSchema = z.object({
  city: z.string(),
  country: z.string(),
  description: z.string(),
  tempC: z.number(),
  feelsLikeC: z.number(),
  humidityPct: z.number(),
  pressureHpa: z.number(),
  windMS: z.number(),
  observedAt: z.number(),
});

export const fetchWeatherX402Tool = tool({
  description:
    "Fetch live weather from OpenWeatherMap inside the TEE via x402 micropayment. " +
    "Requires a connected wallet to approve the on-chain fetch fee. Use before recommending coverage.",
  inputSchema: z.object({
    city: z.string().describe("City to fetch weather for, e.g. Berlin,DE"),
  }),
  outputSchema: z.object({
    instructionId: z.string(),
    requestTx: z.string(),
    report: weatherReportSchema,
  }),
});

export const settlePolicyX402Tool = tool({
  description:
    "Settle an active policy after its settlement unlock time via x402 micropayment. " +
    "Requires wallet connection. Use listPolicies first to find the policyId and canSettle status.",
  inputSchema: z.object({
    policyId: z.number().int().min(0).describe("0-based on-chain policy index"),
  }),
  outputSchema: z.object({
    settleTx: z.string(),
    precipitationMmE2: z.string(),
    date: z.string(),
    revealedThresholdMmE2: z.string(),
    triggered: z.boolean(),
  }),
});

const buyResultSchema = z.object({
  mode: z.enum(["public", "private"]),
  city: z.string(),
  date: z.string(),
  lat: z.string(),
  lon: z.string(),
  thresholdMmE2: z.string(),
  payout: z.string(),
  premium: z.string(),
  buyTxHash: z.string(),
  relayTxHash: z.string().optional(),
});

export const buyPolicyTool = tool({
  description:
    "Buy a public rainfall policy on-chain. Terms are visible on-chain. " +
    "Requires wallet connection and user confirmation. Geocodes the city automatically.",
  inputSchema: buyInputSchema,
  outputSchema: buyResultSchema,
});

export const buyPolicyPrivateTool = tool({
  description:
    "Buy a private rainfall policy with ECIES-encrypted terms in the TEE. " +
    "Threshold is hidden on-chain. Requires wallet connection and user confirmation.",
  inputSchema: buyInputSchema,
  outputSchema: buyResultSchema,
});

export const CLIENT_TOOL_NAMES = [
  "fetchWeatherX402",
  "settlePolicyX402",
  "buyPolicy",
  "buyPolicyPrivate",
] as const;

export type ClientToolName = (typeof CLIENT_TOOL_NAMES)[number];

export const AUTO_CLIENT_TOOLS = ["fetchWeatherX402", "settlePolicyX402"] as const;

export const CONFIRM_CLIENT_TOOLS = ["buyPolicy", "buyPolicyPrivate"] as const;
