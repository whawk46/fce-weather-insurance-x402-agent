# Weather Insurance Extension

A Flare Confidential Compute (FCC) extension that settles **parametric rainfall insurance** using weather data from [OpenWeatherMap](https://openweathermap.org/api) inside a TEE.

## Quick start (local simulated on Coston2)

See **[DEPLOYMENT_STEPS.md](DEPLOYMENT_STEPS.md)** for the full walkthrough. Summary:

1. **Configure** `.env.local.coston2` (keys, `OPENWEATHERMAP_API_KEY`, `PAY_TOKEN`), then activate:

   ```bash
   ./scripts/use-chain.sh local coston2
   ```

2. **Deploy** the contract and register the extension:

   ```bash
   ./scripts/pre-build.sh
   ./scripts/extension-setup.sh
   ```

3. **Tunnel** port `6674` publicly — pick one:

   ```bash
   ngrok http 6674
   # or, no ngrok account needed:
   cloudflared tunnel --url http://localhost:6674
   ```

   Set `EXT_PROXY_URL` in `.env.local.coston2` to the tunnel HTTPS URL, then:

   ```bash
   ./scripts/use-chain.sh local coston2
   ```

4. **Indexer DB** — copy the example (gitignored; holds credentials):

   ```bash
   cp config/proxy/extension_proxy.coston2.docker.toml.example \
      config/proxy/extension_proxy.coston2.docker.toml
   ```

   Fill `[db]` with Flare's read-only indexer credentials for Coston2
   (`host` / `username` / `password`). Ask your Flare TEE contact / devops
   for them.

5. **Start** the Docker stack (redis + ext-proxy + extension-tee):

   ```bash
   ./scripts/start-services.sh
   ```

6. **Register** the TEE on-chain and run the policy demo:

   ```bash
   ./scripts/post-build.sh
   ./scripts/extension-post-setup.sh
   ./scripts/test.sh
   ```

7. **Tear down** when finished:

   ```bash
   ./scripts/stop-services.sh
   ```

## Web frontend (Coston2)

dApp in [`frontend/`](frontend/) — wallet connect, buy policies (public or [ECIES](https://en.wikipedia.org/wiki/Elliptic-curve_cryptography) private), settle, and live weather FETCH. Private buys encrypt policy terms under the TEE public key inside FCC; see [docs/frontend-private-buy.md](docs/frontend-private-buy.md#ecies-and-flare-confidential-compute-fcc).

After the extension stack is running and `config/extension.env` exists:

```bash
cp frontend/.env.local.example frontend/.env.local
# Contract address + proxy URLs are synced automatically by pre-build.sh
# (scripts/sync-env.sh). Re-run manually after a redeploy or tunnel change:
#   ./scripts/sync-env.sh

cd frontend && npm install && npm run dev
```

`getWeather`/`requestSettlement` are `onlyGateway` — the frontend's "Fetch weather" and
"Settle" buttons go through the x402 gateway (Next.js routes at `/x402/weather/*`), not the
contract directly. The gateway runs in the same process as the dApp.

`NEXT_PUBLIC_X402_GATEWAY_URL` in `frontend/.env.local` must point at the Next.js origin
(default `http://localhost:3000`; synced by `scripts/sync-env.sh`). The gateway wallet
(`DEPLOYMENT_PRIVATE_KEY` from repo `.env`, server-side only) must match the contract's
`gateway()` address (set by `extension-setup.sh`). **Restart `npm run dev`** whenever you
redeploy the contract or your tunnel URL changes.

Open [http://localhost:3000](http://localhost:3000), connect MetaMask on **Coston2** (chain id 114), and fund **C2FLR** + **WPT** for premiums.

### AI insurance agent

The dApp includes an in-app **Insurance assistant** chat (OpenAI + tool calling). It can read pool stats, fetch TEE weather via x402, list policies, buy (public or private), and settle — using the same on-chain flows as the manual forms.

Set `OPENAI_API_KEY` in `frontend/.env.local` (see `frontend/.env.local.example`). Full setup and demo script: [docs/frontend-agent.md](docs/frontend-agent.md).

### MCP server (Cursor / external agents)

The same tools are available as an MCP URL endpoint when the dev server is running:

```
http://localhost:3000/api/mcp
```

Start with `cd frontend && npm run dev` — no separate MCP process needed for Cursor or Claude Code. Setup, Cursor/Claude config, and security notes: [docs/mcp-server.md](docs/mcp-server.md).

The UI proxies TEE `/info` and `/action/result` through Next API routes (`EXT_PROXY_URL` server-side) to avoid browser CORS. Optional types-server decode UI uses port **8100** (exposed from `extension-tee` in Docker Compose).

## Repository structure

```
├── cmd/                    # TEE entry (docker/main.go for container)
├── frontend/               # Next.js dApp (wagmi, Flare theme)
├── internal/extension/     # WEATHER FETCH / SETTLE / BUY handlers
├── pkg/types/              # Request/response types
├── contracts/              # WeatherInsurance (InstructionSender)
├── tools/                  # deploy, register-tee, run-test, settle
├── config/                 # chain addresses, proxy TOML examples
└── scripts/                # pre-build, start-services, test, use-chain
```

## Contract

`contracts/InstructionSender.sol` defines `WeatherInsurance`: `buyPolicy`, `buyPolicyPrivate`, `settle`, ERC-20 premiums/payouts via `PAY_TOKEN`. `requestSettlement`/`getWeather` are `onlyGateway` — callable only by the registered `gateway` address (`setGateway`) — and pull an optional per-call `feeToken` fee (any ERC-20, e.g. FXRP or a test USDT0) atomically via `transferFrom` from the payer the gateway names (`setFeeToken`/`setFeeRecipient`/`setFetchFee`/`setSettleFee`). The Next.js x402 routes at [`frontend/app/x402/weather/`](frontend/app/x402/weather/) front these two with a `402 Payment Required` → approve → retry handshake; the contract's own `transferFrom` is the actual enforcement, not the HTTP layer.

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENWEATHERMAP_API_KEY` | Required for TEE weather API calls |
| `PAY_TOKEN` | ERC-20 for premiums/payouts (`extension-setup.sh` → `setPayToken`) |
| `SIMULATED_TEE` | `true` for local Docker + a public tunnel (ngrok or cloudflared); `false` for GCP VM |
| `EXT_PROXY_URL` | Tunnel HTTPS URL — ngrok, or `cloudflared tunnel --url http://localhost:6674` if you don't have an ngrok account — (local) or devops proxy (deployed). cloudflared's quick-tunnel URL is ephemeral: it changes on every restart, so re-run `post-build.sh`'s register-tee step after it changes. |
| `GATEWAY_ADDRESS` | Only address allowed to call `getWeather`/`requestSettlement` (`setGateway`); defaults to the deployer's own address |
| `FEE_TOKEN` / `FEE_RECIPIENT` / `FETCH_FEE` / `SETTLE_FEE` | On-chain per-call fee (any ERC-20, amounts in its base units); 0/unset disables it |

Chain templates: `.env.coston2`, `.env.local.coston2` (and Coston variants). Switch with `./scripts/use-chain.sh [local] <chain>`.

## Scripts

| Script | Purpose |
|--------|---------|
| `pre-build.sh` | Deploy `WeatherInsurance` + register extension |
| `extension-setup.sh` | `setPayToken`, `setGateway`, and the on-chain fee setters on the contract |
| `start-services.sh` | Docker: redis + ext-proxy + extension-tee |
| `post-build.sh` | Allow TEE version + `register-tee rRap` |
| `extension-post-setup.sh` | `setTeeAddress` on contract |
| `test.sh` | Full buy → settle policy demo |
| `settle-policy.sh` | Keeper settle for one policy ID (must be run as the registered gateway) |
| `sync-env.sh` | Propagate `extension.env` + `.env` → `frontend/.env` / `.env.local` |

The x402 gateway is implemented as Next.js route handlers (`frontend/app/x402/weather/*`); it starts automatically with `npm run dev`.

## Prerequisites

- Docker Desktop, Go 1.25.1+, Foundry, a tunnel tool for the local flow — ngrok, or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) if you don't have an ngrok account (`cloudflared tunnel --url http://localhost:6674`, no account needed for a quick tunnel)
- Funded Coston2 key + WPT for tests
- OpenWeatherMap API key

> Demonstration only — production would need multi-source oracles and stronger guarantees.

## Related docs

- [DEPLOYMENT_STEPS.md](DEPLOYMENT_STEPS.md) — deployed vs local simulated flows
- [docs/frontend-agent.md](docs/frontend-agent.md) — AI chat agent (OpenAI + x402 + on-chain tools)
- [docs/mcp-server.md](docs/mcp-server.md) — MCP server for Cursor / external agents
- [docs/frontend-private-buy.md](docs/frontend-private-buy.md) — private buy UI flow and `relayPrivateBuy`
- [docs/frontend-weather-fetch.md](docs/frontend-weather-fetch.md) — `getWeather` TEE poll and JSON decode
- [docs/testing.md](docs/testing.md) — unit tests and signature checks
- [docs/types-server.md](docs/types-server.md) — decode API for the frontend activity panel
