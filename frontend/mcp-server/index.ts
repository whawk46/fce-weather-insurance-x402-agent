import "./env";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createInsuranceMcpServer } from "./server";
import { getMcpWalletAddress } from "./wallet";

async function main(): Promise<void> {
  const wallet = getMcpWalletAddress();
  console.error(`Weather Insurance MCP — wallet ${wallet}`);

  const server = createInsuranceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather Insurance MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
