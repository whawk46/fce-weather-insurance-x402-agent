# Weather Insurance MCP Server

Expose the same weather-insurance tools as the [in-app AI agent](./frontend-agent.md) to **Cursor**, Claude Desktop, and other MCP hosts via a local stdio server.

## Prerequisites

Same as the dApp:

1. Extension stack running: `bash ./scripts/start-services.sh`
2. x402 gateway in a separate terminal:

```bash
cd tools && go run ./cmd/x402-gateway
```

Or sync frontend env and restart the gateway after a redeploy:

```bash
./scripts/sync-env.sh --restart-gateway
```

3. Repo `.env` with `DEPLOYMENT_PRIVATE_KEY` (funded on Coston2 with **C2FLR**, **WPT**, and **feeToken**)
4. `frontend/.env.local` — contract address and gateway URL are synced by `./scripts/sync-env.sh` (run automatically by `pre-build.sh`); add `OPENAI_API_KEY` for the in-app agent if needed
5. `OPENWEATHERMAP_API_KEY` in repo `.env` or `frontend/.env.local`

## Run locally

```bash
cd frontend
npm install
npm run mcp
```

The process stays alive and speaks MCP over stdin/stdout. Logs go to **stderr** only.

### MCP Inspector

```bash
cd frontend
npx @modelcontextprotocol/inspector npm run mcp
```

Use the Inspector UI to list and call tools without configuring a host.

## Cursor configuration

Add to `.cursor/mcp.json` (project) or Cursor Settings → MCP:

```json
{
  "mcpServers": {
    "weather-insurance": {
      "type": "stdio",
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "${workspaceFolder}/frontend"
    }
  }
}
```

A ready-made config lives at [`.cursor/mcp.json`](../.cursor/mcp.json) in this repo.

Env vars are loaded automatically from the repo `.env` and `frontend/.env.local` — no need to duplicate secrets in the MCP config if you use the paths above.

Restart Cursor after saving.

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

The MCP wallet is derived from `DEPLOYMENT_PRIVATE_KEY` (same key as `tools/cmd/x402-gateway`).

## Example prompts (in Cursor)

- "How much liquidity is in the weather insurance pool?"
- "List my weather insurance policies"
- "Fetch live TEE weather for Berlin,DE"
- "Buy private coverage for Berlin,DE on 2026-07-20 — 2mm threshold, 10 WPT payout, 1 WPT premium"
- "Settle policy 0"

## Security

- **Demo network only.** The MCP wallet can spend C2FLR, WPT, and feeToken on Coston2.
- **Buy tools sign immediately** — there is no confirmation card unlike the dApp chat UI.
- Use a dedicated demo key; never point MCP at mainnet or production keys.

## Files

```
frontend/mcp-server/
├── index.ts    # stdio entry
├── env.ts      # dotenv loader
├── wallet.ts   # viem wallet + ensureExtensionReady
└── tools.ts    # tool registration
```

## Related

- [frontend-agent.md](./frontend-agent.md) — in-app chat assistant
- [frontend-weather-fetch.md](./frontend-weather-fetch.md) — x402 FETCH flow
- [frontend-private-buy.md](./frontend-private-buy.md) — ECIES private buy
