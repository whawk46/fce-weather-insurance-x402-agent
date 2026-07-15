import { tool } from "ai";
import { z } from "zod";

import { geocodeCityServer } from "@/lib/server/geocode";

export const geocodeCityTool = tool({
  description:
    "Resolve a city name (e.g. Berlin,DE or London,GB) to latitude and longitude for policy coverage.",
  inputSchema: z.object({
    city: z.string().describe("City and country code, e.g. Berlin,DE"),
  }),
  execute: async ({ city }) => geocodeCityServer(city),
});
