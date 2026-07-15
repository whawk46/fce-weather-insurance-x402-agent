import "./env";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerInsuranceTools } from "./tools";
import { getMcpWalletAddress } from "./wallet";

async function main(): Promise<void> {
  const wallet = getMcpWalletAddress();
  console.error(`Weather Insurance MCP — wallet ${wallet}`);

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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather Insurance MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
