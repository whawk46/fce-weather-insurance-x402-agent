import "@/lib/server/env";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createInsuranceMcpServer } from "@/mcp-server/server";

export const runtime = "nodejs";
export const maxDuration = 120;

async function handleMcp(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createInsuranceMcpServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handleMcp as GET, handleMcp as POST, handleMcp as DELETE };
