import { tool } from "ai";
import { z } from "zod";

import { readPoolStats } from "@/lib/agent/read-policies";

export const getPoolStatsTool = tool({
  description:
    "Read the weather insurance payout pool: available liquidity, reserved amounts, and pay token symbol.",
  inputSchema: z.object({}),
  execute: async () => readPoolStats(),
});
