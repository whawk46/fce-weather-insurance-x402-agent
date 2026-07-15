import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerInsuranceTools } from "./tools";
import { getMcpWalletAddress } from "./wallet";

export function createInsuranceMcpServer(): McpServer {
  const wallet = getMcpWalletAddress();

  const server = new McpServer(
    {
      name: "weather-insurance",
      version: "1.0.0",
    },
    {
      instructions: `Parametric rainfall insurance tools for Flare Coston2.

The MCP wallet (${wallet}) signs on-chain transactions and x402 fee approvals.
Prerequisites: extension stack running, x402 gateway on NEXT_PUBLIC_X402_GATEWAY_URL.

Buy tools execute immediately without confirmation — use only on demo networks.`,
    },
  );

  registerInsuranceTools(server);
  return server;
}
