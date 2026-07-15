import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Address } from "viem";
import { z } from "zod";

import {
  buyPrivatePolicy,
  buyPublicPolicy,
  fetchWeatherViaX402,
  settlePolicyViaX402,
} from "@/lib/agent/actions";
import { readPolicySummaries, readPoolStats } from "@/lib/agent/read-policies";
import { erc20Abi } from "@/lib/abi/erc20";
import { PAY_TOKEN_ADDRESS, WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import { geocodeCityServer } from "@/lib/server/geocode";

import {
  createMcpExecute,
  ensureExtensionReady,
  getMcpPublicClient,
  getMcpWalletAddress,
} from "./wallet";

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function jsonError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

async function readPayTokenAllowance(): Promise<bigint> {
  const client = getMcpPublicClient();
  const holder = getMcpWalletAddress();
  return client.readContract({
    address: PAY_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [holder, WEATHER_INSURANCE_ADDRESS],
  });
}

const buyInputSchema = {
  city: z.string().describe("Coverage location, e.g. Berlin,DE"),
  date: z.string().describe("Coverage date YYYY-MM-DD"),
  thresholdMm: z
    .string()
    .describe("Minimum daily rainfall in mm to trigger payout, e.g. 1.00"),
  payoutTokens: z.string().describe("Payout amount in pay token units, e.g. 10"),
  premiumTokens: z.string().describe("Premium in pay token units, e.g. 1"),
};

export function registerInsuranceTools(server: McpServer): void {
  server.registerTool(
    "geocodeCity",
    {
      description:
        "Resolve a city name (e.g. Berlin,DE or London,GB) to latitude and longitude for policy coverage.",
      inputSchema: {
        city: z.string().describe("City and country code, e.g. Berlin,DE"),
      },
    },
    async ({ city }) => {
      try {
        return jsonResult(await geocodeCityServer(city));
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Geocode failed");
      }
    },
  );

  server.registerTool(
    "getPoolStats",
    {
      description:
        "Read the weather insurance payout pool: available liquidity, reserved amounts, and pay token symbol.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await readPoolStats());
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Pool read failed");
      }
    },
  );

  server.registerTool(
    "listPolicies",
    {
      description:
        "List on-chain weather insurance policies. Defaults to the MCP wallet holder. " +
        "Policy IDs are 0-based indices used for settlement.",
      inputSchema: {
        holder: z
          .string()
          .optional()
          .describe("Optional holder address; defaults to the MCP wallet"),
      },
    },
    async ({ holder }) => {
      try {
        const filter = (holder ?? getMcpWalletAddress()) as Address;
        const policies = await readPolicySummaries(filter);
        return jsonResult({
          wallet: getMcpWalletAddress(),
          count: policies.length,
          policies,
        });
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Policy list failed");
      }
    },
  );

  server.registerTool(
    "fetchWeatherX402",
    {
      description:
        "Fetch live weather from OpenWeatherMap inside the TEE via x402 micropayment. " +
        "The MCP wallet approves the on-chain fetch fee. Use before recommending coverage.",
      inputSchema: {
        city: z.string().describe("City to fetch weather for, e.g. Berlin,DE"),
      },
    },
    async ({ city }) => {
      try {
        const payer = getMcpWalletAddress();
        const execute = createMcpExecute();
        const result = await fetchWeatherViaX402(city, payer, execute, (step) => {
          console.error(`[fetchWeatherX402] ${step}`);
        });
        return jsonResult(result);
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Weather fetch failed");
      }
    },
  );

  server.registerTool(
    "settlePolicyX402",
    {
      description:
        "Settle an active policy after its settlement unlock time via x402 micropayment. " +
        "Use listPolicies first to find the policyId and canSettle status.",
      inputSchema: {
        policyId: z
          .number()
          .int()
          .min(0)
          .describe("0-based on-chain policy index"),
      },
    },
    async ({ policyId }) => {
      try {
        const payer = getMcpWalletAddress();
        const execute = createMcpExecute();
        const publicClient = getMcpPublicClient();
        const result = await settlePolicyViaX402(
          policyId,
          payer,
          execute,
          (step) => {
            console.error(`[settlePolicyX402] ${step}`);
          },
          publicClient,
        );
        return jsonResult(result);
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Settlement failed");
      }
    },
  );

  server.registerTool(
    "buyPolicy",
    {
      description:
        "Buy a public rainfall policy on-chain. Terms are visible on-chain. " +
        "Signs immediately with the MCP wallet (no confirmation UI). Geocodes the city automatically.",
      inputSchema: buyInputSchema,
    },
    async (input) => {
      try {
        const holder = getMcpWalletAddress();
        const execute = createMcpExecute();
        const publicClient = getMcpPublicClient();
        let allowance = await readPayTokenAllowance();
        const result = await buyPublicPolicy(input, holder, execute, {
          onStep: (step) => console.error(`[buyPolicy] ${step}`),
          ensureReady: ensureExtensionReady,
          publicClient,
          allowance,
          refetchAllowance: async () => {
            allowance = await readPayTokenAllowance();
          },
        });
        return jsonResult(result);
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Buy failed");
      }
    },
  );

  server.registerTool(
    "buyPolicyPrivate",
    {
      description:
        "Buy a private rainfall policy with ECIES-encrypted terms in the TEE. " +
        "Threshold is hidden on-chain. Signs immediately with the MCP wallet.",
      inputSchema: buyInputSchema,
    },
    async (input) => {
      try {
        const holder = getMcpWalletAddress();
        const execute = createMcpExecute();
        const publicClient = getMcpPublicClient();
        let allowance = await readPayTokenAllowance();
        const result = await buyPrivatePolicy(input, holder, execute, {
          onStep: (step) => console.error(`[buyPolicyPrivate] ${step}`),
          ensureReady: ensureExtensionReady,
          publicClient,
          allowance,
          refetchAllowance: async () => {
            allowance = await readPayTokenAllowance();
          },
        });
        return jsonResult(result);
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Private buy failed");
      }
    },
  );
}
