# Weather Insurance Extension

A [Flare Confidential Compute (FCC)](https://dev.flare.network/fcc/overview) extension that settles **parametric rainfall insurance** using weather data from [OpenWeatherMap](https://openweathermap.org/api) inside a TEE.

> **Two deployment modes.** The main path deploys to a **GCP Confidential Space VM** (production attestation, devops-hosted proxy). For development, run the TEE and proxy as **local Docker containers** with a **simulated** TEE (`SIMULATED_TEE=true`, `MODE=1`) exposed via a public tunnel (**ngrok**, or **cloudflared** if you don't have an ngrok account) on the real chain — see [Local / simulated deployment](#local--simulated-deployment-docker--tunnel).

## Prerequisites

- Docker Desktop (Linux containers)
- Go 1.25.1+, Foundry (`forge`, `cast`), `jq`, `curl`
- **OpenWeatherMap API key** — set `OPENWEATHERMAP_API_KEY` in `.env` before `start-services.sh`
- **OpenAI API key** — set `OPENAI_API_KEY` in `frontend/.env.local` for the insurance assistant (optional if you skip the agent)
- **ngrok**, or **[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)** as a no-account alternative — for the local / simulated flow only
- Funded deployer key on Coston2 (and WPT for `test.sh` payouts) — [faucet](https://faucet.flare.network/coston2)
- **VPN** — only for Coston (VPN-gated indexer)

> Demonstration only — production would need multi-source oracles and stronger guarantees.

## Indexer DB credentials

The `ext-proxy` queries Flare's **indexer DB** for TEE events and instruction responses. Credentials are **chain-specific**, read-only throwaway values — obtain `username` / `password` from your **Flare TEE contact or devops** (same creds used by other FCC extensions on that chain). Do not cross Coston and Coston2 values.

Create the chain-specific docker config (gitignored) from the example, then fill `[db]`:

```bash
cp config/proxy/extension_proxy.coston2.docker.toml.example \
   config/proxy/extension_proxy.coston2.docker.toml
```

### Coston2 (no VPN)

```toml
[db]
host     = "34.38.42.208"
port     = 3306
database = "indexer"
username = "<from Flare>"
password = "<from Flare>"
log_queries = false
```

Wrong or missing DB config (or unreachable host) causes `test.sh` to fail the round-trip — the proxy never sees instruction responses.

## Repository structure

No sibling `tee-node` / `tee-proxy` repos required. The extension `Dockerfile`, root `go.mod`, and `tools/` pull pinned versions from GitHub (`tee-node` and `tee-proxy` in `go.sum` / `tools/go.sum`).

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

## 1. Configure environment

Copy and edit chain templates (or start from `.env.example`):

```bash
cp .env.example .env.coston2
cp .env.example .env.local.coston2
```

Set at minimum:

| Variable | Notes |
|----------|--------|
| `DEPLOYMENT_PRIVATE_KEY` | Funded key, no `0x` prefix |
| `INITIAL_OWNER` | Address from that key |
| `OPENWEATHERMAP_API_KEY` | From [openweathermap.org](https://openweathermap.org/api) |
| `PAY_TOKEN` | Coston2 WPT: `0x53192e788991AD96bC180249B15AefB94E597dD1` |

Activate:

```bash
./scripts/use-chain.sh coston2         # deployed
./scripts/use-chain.sh local coston2   # local simulated
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `OPENWEATHERMAP_API_KEY` | Required for TEE weather API calls |
| `PAY_TOKEN` | ERC-20 for premiums/payouts (`extension-setup.sh` → `setPayToken`) |
| `SIMULATED_TEE` | `true` for local Docker + a public tunnel (ngrok or cloudflared); `false` for GCP VM |
| `EXT_PROXY_URL` | Tunnel HTTPS URL — ngrok, or `cloudflared tunnel --url http://localhost:6674` if you don't have an ngrok account — (local) or devops proxy (deployed). cloudflared's quick-tunnel URL is ephemeral: it changes on every restart, so re-run `post-build.sh`'s register-tee step after it changes. |
| `GATEWAY_ADDRESS` | Only address allowed to call `getWeather`/`requestSettlement` (`setGateway`); defaults to the deployer's own address |
| `FEE_TOKEN` / `FEE_RECIPIENT` / `FETCH_FEE` / `SETTLE_FEE` | On-chain per-call fee (any ERC-20, amounts in its base units); 0/unset disables it |

Chain templates: `.env.coston2`, `.env.local.coston2` (and Coston variants). Switch with `./scripts/use-chain.sh [local] <chain>`.

## 2. Register extension on-chain

```bash
./scripts/pre-build.sh
```

Deploys `WeatherInsurance`, registers the extension, writes `config/extension.env`.

Policy location is chosen at buy time (City,CC geocoded to lat/lon). After contract changes, re-run `pre-build.sh` and copy the new ABI into `frontend/lib/abi/weatherInsurance.json` (or run `scripts/generate-bindings.sh` and `jq` as in that script).

Then wire the pay token (before Docker):

```bash
./scripts/extension-setup.sh
```

## 3. Register TEE (deployed path)

After devops provides `EXT_PROXY_URL`, update `.env.coston2` and re-run `use-chain.sh`, then:

```bash
./scripts/post-build.sh
./scripts/extension-post-setup.sh   # setTeeAddress on WeatherInsurance
./scripts/test.sh
```

`post-build.sh` uses `register-tee -command rRap` (load-bearing for re-runs).

---

## Local / simulated deployment (Docker + tunnel)

Real Coston2 chain + simulated TEE in Docker, public proxy via a tunnel (ngrok, or cloudflared if you don't have an ngrok account). No GCP VM.

### What `local` changes in `.env`

`use-chain.sh local coston2` copies `.env.local.coston2` → `.env`.

| Variable | Deployed | Local / simulated |
|----------|----------|-------------------|
| `SIMULATED_TEE` | `false` | `true` |
| `EXT_PROXY_URL` | devops URL | your tunnel's `https://…` URL |

`LOCAL_MODE` stays **`false`**. `MODE=1` is injected by `docker-compose.yaml` at runtime.

### Steps

1. **Activate local mode**

   ```bash
   ./scripts/use-chain.sh local coston2
   ```

2. **Pre-build + extension setup**

   ```bash
   ./scripts/pre-build.sh
   ./scripts/extension-setup.sh
   ```

3. **Tunnel** (host port `6674` → proxy `6664`) — ngrok:

   ```bash
   ngrok http 6674
   ```

   or, if you don't have an ngrok account, cloudflared (no account needed):

   ```bash
   cloudflared tunnel --url http://localhost:6674
   ```

   Set `EXT_PROXY_URL` in `.env.local.coston2` to the `Forwarding` HTTPS URL (ngrok) or the printed `https://….trycloudflare.com` URL (cloudflared), then:

   ```bash
   ./scripts/use-chain.sh local coston2
   ```

   cloudflared's quick-tunnel URL is ephemeral — it changes every time the tunnel restarts. When it does, update `EXT_PROXY_URL` and re-run `./scripts/post-build.sh` (its `register-tee` step needs the current URL).

4. **Indexer DB** — create `config/proxy/extension_proxy.coston2.docker.toml` (see [Indexer DB credentials](#indexer-db-credentials)).

5. **Start stack**

   ```bash
   ./scripts/start-services.sh
   ```

6. **Verify `/info`** (simulated `codeHash` ≈ `0x194844cf…`)

   ```bash
   curl -s "$EXT_PROXY_URL/info" | jq '.machineData'
   ```

7. **Register TEE and test**

   ```bash
   ./scripts/post-build.sh
   ./scripts/extension-post-setup.sh
   ./scripts/test.sh
   ```

8. **Tear down**

   ```bash
   ./scripts/stop-services.sh
   ```

> Re-run after code changes: keep the tunnel up, `start-services.sh`, then `post-build.sh` / `test.sh` as needed.

## End-to-end test

`test.sh` runs `tools/cmd/run-test`: fund pool, private buy, settlement against OpenWeatherMap, assert payout. The deployer needs WPT balance on Coston2.

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

`getWeather`/`requestSettlement` are `onlyGateway` — the frontend's "Fetch weather" and "Settle" buttons go through the x402 gateway (Next.js routes at `/x402/weather/*`), not the contract directly. The gateway runs in the same process as the dApp.

`NEXT_PUBLIC_X402_GATEWAY_URL` in `frontend/.env.local` must point at the Next.js origin (default `http://localhost:3000`; synced by `scripts/sync-env.sh`). The gateway wallet (`DEPLOYMENT_PRIVATE_KEY` from repo `.env`, server-side only) must match the contract's `gateway()` address (set by `extension-setup.sh`). **Restart `npm run dev`** whenever you redeploy the contract or your tunnel URL changes.

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

## Contract

`contracts/InstructionSender.sol` defines `WeatherInsurance`: `buyPolicy`, `buyPolicyPrivate`, `settle`, ERC-20 premiums/payouts via `PAY_TOKEN`. `requestSettlement`/`getWeather` are `onlyGateway` — callable only by the registered `gateway` address (`setGateway`) — and pull an optional per-call `feeToken` fee (any ERC-20, e.g. FXRP or a test USDT0) atomically via `transferFrom` from the payer the gateway names (`setFeeToken`/`setFeeRecipient`/`setFetchFee`/`setSettleFee`). The Next.js x402 routes at [`frontend/app/x402/weather/`](frontend/app/x402/weather/) front these two with a `402 Payment Required` → approve → retry handshake; the contract's own `transferFrom` is the actual enforcement, not the HTTP layer.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `OPENWEATHERMAP_API_KEY is not set` in TEE logs | Set in `.env`, re-run `start-services.sh` |
| `Post "http://localhost:7702/action": context deadline exceeded` on settle | tee-node allows only **2s** for synchronous extension responses; settlement calls OpenWeatherMap One Call `day_summary` (often slower). Rebuild `extension-tee` after pulling fixes (async SETTLE/FETCH + longer OWM timeout). Ensure the API key has a [One Call subscription](https://openweathermap.org/api/one-call-3). |
| `test.sh` round-trip fails | Check indexer `[db]` in docker proxy config; confirm `EXT_PROXY_URL` is your tunnel's HTTPS URL (ngrok or cloudflared, not localhost) on Coston2 |
| `MachineManager.TooMany()` | `INSTRUCTION_SENDER` / `EXTENSION_ID` mismatch — re-run `pre-build.sh --force` only if intentional |
| `code hashes do not match` | `SIMULATED_TEE` must match TEE `MODE` (simulated: `SIMULATED_TEE=true`, compose `MODE=1`) |

### Fresh clone without re-minting

```bash
./scripts/generate-bindings.sh
# Recover EXTENSION_ID from curl $EXT_PROXY_URL/info
# Recover INSTRUCTION_SENDER via cast call FlareTeeManager getTeeExtensionInstructionsSender
```

Then write `config/extension.env` and run `post-build.sh` / `test.sh`.

## Related docs

- [FCC overview](https://dev.flare.network/fcc/overview) — Flare Confidential Compute on the Developer Hub
- [docs/deployment-steps.md](docs/deployment-steps.md) — Confidential Space / production deploy recipe
- [docs/frontend-agent.md](docs/frontend-agent.md) — AI chat agent (OpenAI + x402 + on-chain tools)
- [docs/mcp-server.md](docs/mcp-server.md) — MCP server for Cursor / external agents
- [docs/frontend-private-buy.md](docs/frontend-private-buy.md) — private buy UI flow and `relayPrivateBuy`
- [docs/frontend-weather-fetch.md](docs/frontend-weather-fetch.md) — `getWeather` TEE poll and JSON decode
- [docs/testing.md](docs/testing.md) — unit tests and signature checks
- [docs/types-server.md](docs/types-server.md) — decode API for the frontend activity panel
- [REPRODUCIBILITY.md](REPRODUCIBILITY.md) — reproducible Docker builds
