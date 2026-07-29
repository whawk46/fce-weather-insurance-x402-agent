# Deployment steps

Detailed recipe for deploying this weather-insurance FCC extension to Flare Coston / Coston2. For a shorter overview, see the [README](../README.md).

> **Two modes.** Production attestation runs on a **GCP Confidential Space VM** (this doc). Local development uses **Docker + a public tunnel** with `SIMULATED_TEE=true` — see [Local / simulated deployment](../README.md#local--simulated-deployment-docker--tunnel) in the README.

No sibling `tee-node` / `tee-proxy` checkouts are required. The `Dockerfile`, root `go.mod`, and `tools/` pull pinned modules from GitHub.

## Prerequisites

- Docker Desktop (Linux containers)
- Go 1.25.1+, Foundry (`forge`, `cast`), `jq`, `curl`
- OpenWeatherMap API key (`OPENWEATHERMAP_API_KEY` in `.env` before `start-services.sh`)
- OpenAI API key (`OPENAI_API_KEY` in `frontend/.env.local`) — only for the insurance assistant / agent
- Funded deployer key on the target chain — [Coston2 faucet](https://faucet.flare.network/coston2) / [Coston faucet](https://faucet.flare.network/coston)
- VPN — only for Coston (VPN-gated indexer)
- Indexer DB credentials from Flare TEE contact / devops — see [Indexer DB credentials](../README.md#indexer-db-credentials)

## 1. Configure environment

```bash
cp .env.example .env.coston2
# or: cp .env.example .env.coston
```

Set at minimum:

| Variable | Notes |
|----------|--------|
| `DEPLOYMENT_PRIVATE_KEY` | Funded key, no `0x` prefix |
| `INITIAL_OWNER` | Address from that key |
| `OPENWEATHERMAP_API_KEY` | From [openweathermap.org](https://openweathermap.org/api) |
| `PAY_TOKEN` | Coston2 WPT: `0x53192e788991AD96bC180249B15AefB94E597dD1` |
| `SIMULATED_TEE` | `false` for Confidential Space |
| `EXT_PROXY_URL` | Leave empty until the VM proxy URL is known (step 5) |

Activate:

```bash
./scripts/use-chain.sh coston2
```

## 2. Register the extension on-chain

```bash
./scripts/pre-build.sh
./scripts/extension-setup.sh
```

`pre-build.sh` deploys `WeatherInsurance`, registers the extension, and writes `EXTENSION_ID` / `INSTRUCTION_SENDER` to `config/extension.env`. `extension-setup.sh` sets `payToken`, `gateway`, and optional on-chain fees.

```bash
cat config/extension.env
```

Hand `EXTENSION_ID` to the VM operator in step 4.

## 3. Build the Docker image (production)

Confirm the image will run with `MODE=0` (production attestation). Local compose defaults to `MODE=1` (simulated); for Confidential Space, bake or launch with `MODE=0`:

```dockerfile
ENV MODE=0 CONFIG_PORT=5501 SIGN_PORT=7701 EXTENSION_PORT=7702
```

Build from this repo root (build context is `.` — see [REPRODUCIBILITY.md](../REPRODUCIBILITY.md)):

```bash
export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
docker compose -f docker-compose.yaml build --no-cache extension-tee
docker tag weather-insurance-x402-agent-extension-tee:latest weather-insurance:v0.1.0
docker save weather-insurance:v0.1.0 -o weather-insurance-v0.1.0.tar
```

Verify `MODE`:

```bash
docker inspect weather-insurance:v0.1.0 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MODE
```

## 4. Deploy on a Confidential Space VM

Hand off (or deploy) to a GCP Confidential Space VM with:

- The image (tar or registry URL + tag)
- Workload-launch env: `INITIAL_OWNER`, `CHAIN_URL`, `EXTENSION_ID` (from step 2), `PROXY_URL` (proxy reachable from the TEE), `OPENWEATHERMAP_API_KEY`
- Public HTTPS routed to port `6664` of the proxy container

You receive the **public proxy URL**. Set it and re-activate:

```bash
# in .env.coston2
EXT_PROXY_URL=<public proxy URL>
```

```bash
./scripts/use-chain.sh coston2
```

## 5. Verify the proxy `/info`

```bash
curl -s "$EXT_PROXY_URL/info" | jq '.machineData'
```

| Field | Expected |
|-------|----------|
| `platform` | starts with `0x4743505f414d445f534556…` (GCP_AMD_SEV) |
| `codeHash` | real measured hash (**not** `0x194844cf…` — that is simulated) |
| `extensionId` | matches `config/extension.env` `EXTENSION_ID` |
| `initialOwner` | matches `INITIAL_OWNER` |

If `extensionId` is wrong, restart the container with the correct `EXTENSION_ID` launch-policy override (no image rebuild).

## 6. Register the TEE machine

`post-build.sh` already invokes `register-tee` with `-command rRap` (default). Capital `R` issues a fresh availability challenge so re-runs work after image changes or diamond cuts.

```bash
./scripts/post-build.sh
./scripts/extension-post-setup.sh   # setTeeAddress on WeatherInsurance
```

- `allow-tee-version` whitelists the codeHash for your extension.
- `register-tee -command rRap` pre-registers the TEE, requests attestation, runs the FTDC availability check, and promotes to production.
- `extension-post-setup.sh` writes the TEE signing address onto the insurance contract.

## 7. End-to-end test

```bash
./scripts/test.sh
```

Runs `tools/cmd/run-test`: set extension ID / pay token / gateway / TEE address, fund pool, private buy, settle against OpenWeatherMap, assert payout. The deployer needs **WPT** on Coston2.

## When the extension image changes

1. Rebuild and hand off the new image.
2. The VM is re-deployed → `codeHash` changes.
3. `./scripts/post-build.sh` whitelists the new codeHash.
4. `./scripts/test.sh`.

## When the `FlareTeeManager` diamond is re-deployed

All extension registrations on that chain are wiped:

1. `./scripts/pre-build.sh` — mints a fresh `EXTENSION_ID`.
2. Send the new `EXTENSION_ID` to the VM operator. They restart with `EXTENSION_ID=<new value>` as a launch-policy env override — no image rebuild.
3. Re-curl `/info` and confirm `extensionId` matches.
4. `./scripts/post-build.sh` then `./scripts/extension-post-setup.sh`.
5. `./scripts/test.sh`.

## See also

- [README](../README.md) — local simulated flow, frontend, agent, MCP
- [REPRODUCIBILITY.md](../REPRODUCIBILITY.md) — reproducible Docker builds
- [testing.md](testing.md) — unit, integration, and e2e tests
- [FCC overview](https://dev.flare.network/fcc/overview)
