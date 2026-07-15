import type { Address } from "viem";
import { tool } from "ai";
import { z } from "zod";

import { readPolicySummaries } from "@/lib/agent/read-policies";

export function createListPoliciesTool(walletAddress?: Address) {
  return tool({
    description:
      "List on-chain weather insurance policies. When a wallet is connected, returns only that holder's policies. " +
      "Policy IDs are 0-based indices used for settlement.",
    inputSchema: z.object({
      holder: z
        .string()
        .optional()
        .describe("Optional holder address; defaults to the connected wallet"),
    }),
    execute: async ({ holder }) => {
      const filter = (holder ?? walletAddress) as Address | undefined;
      const policies = await readPolicySummaries(filter);
      return {
        walletConnected: !!walletAddress,
        count: policies.length,
        policies,
      };
    },
  });
}
