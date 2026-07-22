# Weather-insurance extension — deployment

Parametric rainfall insurance TEE extension for Flare Coston / Coston2.

> **Two deployment modes.** The main path deploys to a **GCP Confidential Space VM**
> (production attestation, devops-hosted proxy). For development, run the TEE and
> proxy as **local Docker containers** with a **simulated** TEE (`SIMULATED_TEE=true`,
> `MODE=1`) exposed via a public tunnel (**ngrok**, or **cloudflared** if you don't
> have an ngrok account) on the real chain — see
> [Local / simulated deployment](#local--simulated-deployment-docker--ngrok).

## Prerequisites

- Docker Desktop (Linux containers)
- Go 1.25.1+, Foundry (`forge`, `cast`), `jq`, `curl`
- **OpenWeatherMap API key** — set `OPENWEATHERMAP_API_KEY` in `.env` before `start-services.sh`
- **ngrok**, or **[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)** as a no-account alternative — for the local / simulated flow only
- Funded deployer key on Coston2 (and WPT for `test.sh` payouts) — [faucet](https://faucet.flare.network/coston2)
- **VPN** — only for Coston (VPN-gated indexer)

## Indexer DB credentials

The `ext-proxy` queries Flare's **indexer DB** for TEE events and instruction
responses. Credentials are **chain-specific**, read-only throwaway values —
obtain `username` / `password` from your **Flare TEE contact or devops** (same
creds used by other FCC extensions on that chain). Do not cross Coston and
Coston2 values.

Create the chain-specific docker config (gitignored) from the example, then fill
`[db]`:

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

Wrong or missing DB config (or unreachable host) causes `test.sh` to fail the
round-trip — the proxy never sees instruction responses.

## Repository layout

No sibling `tee-node` / `tee-proxy` repos required. The extension `Dockerfile`, root `go.mod`, and `tools/` pull pinned versions from GitHub (`tee-node v0.0.20`, `tee-proxy v0.0.17` in `tools/go.sum`).

```text
extensions/weather-insurance/
├── cmd/ internal/ pkg/     # TEE extension (Go)
├── tools/                  # deploy, register-tee, run-test
├── contracts/              # WeatherInsurance (InstructionSender)
├── scripts/
└── config/coston2/deployed-addresses.json
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
bash ./scripts/use-chain.sh coston2          # deployed
bash ./scripts/use-chain.sh local coston2  # local simulated
```

## 2. Register extension on-chain

```bash
bash ./scripts/pre-build.sh
```

Deploys `WeatherInsurance`, registers the extension, writes `config/extension.env`.

Policy location is chosen at buy time (City,CC geocoded to lat/lon). After contract changes, re-run `pre-build.sh` and copy the new ABI into `frontend/lib/abi/weatherInsurance.json` (or run `scripts/generate-bindings.sh` and `jq` as in that script).

Then wire the pay token (before Docker):

```bash
bash ./scripts/extension-setup.sh
```

## 3. Register TEE (deployed path)

After devops provides `EXT_PROXY_URL`, update `.env.coston2` and re-run `use-chain.sh`, then:

```bash
bash ./scripts/post-build.sh
bash ./scripts/extension-post-setup.sh   # setTeeAddress on WeatherInsurance
bash ./scripts/test.sh
```

`post-build.sh` uses `register-tee -command rRap` (load-bearing for re-runs).

---

## Local / simulated deployment (Docker + ngrok)

Real Coston2 chain + simulated TEE in Docker, public proxy via a tunnel (ngrok,
or cloudflared if you don't have an ngrok account). No GCP VM.

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
   bash ./scripts/use-chain.sh local coston2
   ```

2. **Pre-build + extension setup**

   ```bash
   bash ./scripts/pre-build.sh
   bash ./scripts/extension-setup.sh
   ```

3. **Tunnel** (host port `6674` → proxy `6664`) — ngrok:

   ```bash
   ngrok http 6674
   ```

   or, if you don't have an ngrok account, cloudflared (no account needed):

   ```bash
   cloudflared tunnel --url http://localhost:6674
   ```

   Set `EXT_PROXY_URL` in `.env.local.coston2` to the `Forwarding` HTTPS URL
   (ngrok) or the printed `https://….trycloudflare.com` URL (cloudflared), then:

   ```bash
   bash ./scripts/use-chain.sh local coston2
   ```

   cloudflared's quick-tunnel URL is ephemeral — it changes every time the
   tunnel restarts. When it does, update `EXT_PROXY_URL` and re-run
   `./scripts/post-build.sh` (its `register-tee` step needs the current URL).

4. **Indexer DB** — create `config/proxy/extension_proxy.coston2.docker.toml` (see above).

5. **Start stack**

   ```bash
   bash ./scripts/start-services.sh
   ```

6. **Verify `/info`** (simulated `codeHash` ≈ `0x194844cf…`)

   ```bash
   curl -s "$EXT_PROXY_URL/info" | jq '.machineData'
   ```

7. **Register TEE and test**

   ```bash
   bash ./scripts/post-build.sh
   bash ./scripts/extension-post-setup.sh
   bash ./scripts/test.sh
   ```

8. **Tear down**

   ```bash
   bash ./scripts/stop-services.sh
   ```

> Re-run after code changes: keep the tunnel up, `start-services.sh`, then `post-build.sh` / `test.sh` as needed.

## End-to-end test

`test.sh` runs `tools/cmd/run-test`: fund pool, private buy, settlement against OpenWeatherMap, assert payout. The deployer needs WPT balance on Coston2.

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
bash ./scripts/generate-bindings.sh
# Recover EXTENSION_ID from curl $EXT_PROXY_URL/info
# Recover INSTRUCTION_SENDER via cast call FlareTeeManager getTeeExtensionInstructionsSender
```

Then write `config/extension.env` and run `post-build.sh` / `test.sh`.
