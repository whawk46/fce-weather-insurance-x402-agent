# AI insurance agent (frontend)

In-app chat assistant that orchestrates weather insurance actions via OpenAI tool calling and the existing x402 / on-chain flows.

## Setup

Add to `frontend/.env.local`:

```bash
OPENAI_API_KEY=sk-...
# optional
AI_MODEL=gpt-4.1-mini
```

The agent also needs the same prerequisites as the rest of the dApp:

- Extension stack running (`bash ./scripts/start-services.sh`)
- x402 gateway: `go run ./tools/cmd/x402-gateway -contract $INSTRUCTION_SENDER`
- `NEXT_PUBLIC_X402_GATEWAY_URL` pointing at the gateway (default `http://localhost:7703`)
- Wallet on **Coston2** (chain 114) with **C2FLR**, **WPT** (premiums/payouts), and **feeToken** (x402 fetch/settle fees)

## Architecture

| Tool | Runs where | Wallet required |
|------|------------|-----------------|
| `geocodeCity` | Server | No |
| `getPoolStats` | Server | No |
| `listPolicies` | Server | Optional (filters by connected wallet) |
| `fetchWeatherX402` | Client | Yes |
| `settlePolicyX402` | Client | Yes |
| `buyPolicy` | Client + confirm | Yes |
| `buyPolicyPrivate` | Client + confirm | Yes |

Server tools execute in [`app/api/chat/route.ts`](../frontend/app/api/chat/route.ts) via `ToolLoopAgent`.

Wallet tools are defined without a server `execute` handler. The chat UI ([`InsuranceAgentChat.tsx`](../frontend/components/InsuranceAgentChat.tsx)) runs them with wagmi, then calls `addToolOutput` so the agent loop continues. Buy tools show an inline confirmation card before signing.

Shared wallet logic lives in [`lib/agent/actions.ts`](../frontend/lib/agent/actions.ts) (same paths as `LiveWeather`, `PolicyList`, and `BuyPolicyForm`).

## Example conversations

1. **Pool check** — *"How much liquidity is in the pool?"* → `getPoolStats`
2. **Weather** — *"What's the rainfall forecast for Berlin,DE?"* → `fetchWeatherX402` (x402 fee approve + TEE fetch). See [frontend-weather-fetch.md](./frontend-weather-fetch.md).
3. **Buy private** — *"Buy private coverage for Berlin,DE on 2026-07-20 if rain exceeds 2mm, payout 10 WPT, premium 1 WPT"* → confirm card → ECIES private buy
4. **Policies** — *"Show my policies"* → `listPolicies`
5. **Settle** — *"Settle policy 0"* → `settlePolicyX402` (after `canSettle` is true)

## Demo script (presentations)

1. Connect MetaMask on Coston2
2. Open the **Insurance assistant** section at the top of the dApp
3. Ask about pool liquidity
4. Fetch weather for a demo city (approve x402 fee when prompted)
5. Buy private coverage with suggested terms; confirm in the inline card
6. List policies and settle when the unlock time has passed

## Files

```
frontend/
├── app/api/chat/route.ts
├── components/InsuranceAgentChat.tsx
├── components/agent/
├── lib/agent/
│   ├── actions.ts
│   ├── insurance-agent.ts
│   ├── read-policies.ts
│   └── tools/
└── lib/server/geocode.ts
```

## Related

- [frontend-weather-fetch.md](./frontend-weather-fetch.md) — x402 FETCH flow
- [frontend-private-buy.md](./frontend-private-buy.md) — ECIES private buy
- [mcp-server.md](./mcp-server.md) — MCP server for Cursor / external agents
