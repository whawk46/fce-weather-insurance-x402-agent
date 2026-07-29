# Weather Insurance MCP Server

Expose the same weather-insurance tools as the [in-app AI agent](./frontend-agent.md) to **Cursor**, Claude Desktop, and other MCP hosts via a Streamable HTTP URL served by the Next.js dev server.

## Prerequisites

Same as the dApp:

1. Extension stack running: `bash ./scripts/start-services.sh`
2. Next.js dev server (serves dApp, x402 gateway, and MCP):

```bash
cd frontend && npm run dev
```

3. Repo `.env` with `DEPLOYMENT_PRIVATE_KEY` (funded on Coston2 with **C2FLR**, **WPT**, and **feeToken**)
4. `frontend/.env.local` — contract address and gateway URL are synced by `./scripts/sync-env.sh` (run automatically by `pre-build.sh`); add `OPENAI_API_KEY` for the in-app agent if needed
5. `OPENWEATHERMAP_API_KEY` in repo `.env` or `frontend/.env.local`

## Run locally

With the dev server running, MCP is available at:

```
http://localhost:3000/api/mcp
```

No separate MCP process is needed for Cursor — `npm run dev` serves both the dApp and the MCP endpoint.

### MCP Inspector (stdio, optional)

For debugging with the MCP Inspector UI, use the stdio entry point:

```bash
cd frontend
npx @modelcontextprotocol/inspector npm run mcp
```

## Cursor configuration

Add to `.cursor/mcp.json` (project) or Cursor Settings → MCP:

```json
{
  "mcpServers": {
    "weather-insurance": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

A ready-made config lives at [`.cursor/mcp.json`](../.cursor/mcp.json) in this repo.

**`npm run dev` must be running** before Cursor connects. Restart Cursor after saving the config.

Env vars are loaded automatically from the repo `.env` and `frontend/.env.local` via the Next.js server — no need to duplicate secrets in the MCP config.

## Claude Code configuration

Project config lives at [`.mcp.json`](../.mcp.json). Claude Code requires `"type": "http"` for URL-based servers:

```json
{
  "mcpServers": {
    "weather-insurance": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

**`npm run dev` must be running** before starting a Claude Code session in this project.

## Claude Desktop configuration

Claude Desktop's `claude_desktop_config.json` does **not** accept a bare `url` field — it expects stdio servers. Bridge the local HTTP endpoint with `mcp-remote`:

```json
{
  "mcpServers": {
    "weather-insurance": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://127.0.0.1:3000/api/mcp",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

On macOS, edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Settings → Developer → Edit Config). Restart Claude Desktop after saving.

**`npm run dev` must be running** before Claude Desktop connects.

## Tools

| Tool | Wallet required | Description |
|------|-----------------|-------------|
| `geocodeCity` | No | City → lat/lon via OpenWeatherMap |
| `getPoolStats` | No | Pool liquidity and pay token symbol |
| `listPolicies` | No (optional holder filter) | On-chain policies; defaults to MCP wallet |
| `fetchWeatherX402` | Yes (MCP wallet) | TEE weather fetch via x402 |
| `settlePolicyX402` | Yes | Settle policy after unlock |
| `buyPolicy` | Yes | Public on-chain buy |
| `buyPolicyPrivate` | Yes | ECIES private buy |

The MCP wallet is derived from `DEPLOYMENT_PRIVATE_KEY` (same key as the Next.js x402 gateway).

## Example prompts (in Cursor or Claude)

- "How much liquidity is in the weather insurance pool?"
- "List my weather insurance policies"
- "Fetch live TEE weather for Berlin,DE"
- "Buy private coverage for Berlin,DE on 2026-07-20 — 2mm threshold, 10 WPT payout, 1 WPT premium"
- "Settle policy 0"

## Security

- **Dev-only, no auth.** The URL endpoint has no authentication. Do not expose beyond localhost.
- **Demo network only.** The MCP wallet can spend C2FLR, WPT, and feeToken on Coston2.
- **Buy tools sign immediately** — there is no confirmation card unlike the dApp chat UI.
- Use a dedicated demo key; never point MCP at mainnet or production keys.
- **Not for production deploy** — wallet key, long-running txs, and no auth make this unsuitable for Vercel or public hosting.

## Files

```
frontend/mcp-server/
├── server.ts   # shared McpServer factory
├── index.ts    # stdio entry (MCP Inspector)
├── env.ts      # dotenv loader
├── wallet.ts   # viem wallet + ensureExtensionReady
└── tools.ts    # tool registration

frontend/app/api/mcp/
└── route.ts    # Streamable HTTP URL endpoint
```

## Related

- [frontend-agent.md](./frontend-agent.md) — in-app chat assistant
- [frontend-weather-fetch.md](./frontend-weather-fetch.md) — x402 FETCH flow
- [frontend-private-buy.md](./frontend-private-buy.md) — ECIES private buy
- [README](../README.md) — local stack prerequisites
