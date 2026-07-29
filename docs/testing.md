# Testing

This project has three layers of tests:

| Layer | What it tests | How to run |
|-------|--------------|------------|
| **Unit tests** | Revert decoding, state file I/O, env parsing, validation, report formatting | `cd tools && go test ./...` |
| **Integration tests** | On-chain constructor validation, revert reasons, idempotent registration, pre-flight checks | `cd tools && go test -tags integration ./integration/ -v` |
| **End-to-end tests** | Full policy lifecycle (fund → buy → settle → assert payout) | `./scripts/test.sh` |

## Unit tests

Unit tests require no external services. They cover:

- **Revert reason decoding** (`tools/pkg/fccutils/revert_test.go`) — `decodeRevertHex` / `DecodeRevertReason` for ABI-encoded `Error(string)` reverts from `InstructionSender.sol`, plus nil/wrapped/custom-error edge cases
- **Support revert decoding** (`tools/pkg/support/support_test.go`) — extracts revert reasons from go-ethereum JSON-RPC errors
- **State file I/O** (`tools/pkg/fccutils/registration_test.go`) — `loadState` / `saveState` for TEE registration resume
- **Validation checks** (`tools/pkg/validate/checks_test.go`) — extension env format, deployer key detection, service/registration/TEE checks
- **Report formatting** (`tools/pkg/validate/report_test.go`) — summary, JSON, colored terminal output
- **Validation primitives** (`tools/pkg/validate/validate_test.go`) — `AddressNotZero`, `AddressHasCode`, `KeyHasFunds`, `IsUsingDevKey`

```bash
cd tools && go test ./... -v
```

## Integration tests

Integration tests run against a live Ethereum node (Hardhat, Anvil, or Coston2). They are excluded from `go test ./...` via the `integration` build tag.

**What they test:**

- Constructor validation (zero / EOA / valid addresses) with readable revert messages
- `setExtensionId` errors before registration and when already set
- `CheckTx` revert reasons for on-chain failures
- Idempotent `SetupExtension` (second run returns the same extension ID)
- Pre-flight `AddressHasCode` / `KeyHasFunds`

**Local node:**

```bash
cd tools && go test -tags integration ./integration/ -v -count=1
```

Defaults: `CHAIN_URL=http://127.0.0.1:8545`, addresses file at `config/coston2/deployed-addresses.json`.

**Coston2:**

```bash
cd tools && CHAIN_URL=https://coston2-api.flare.network/ext/C/rpc \
  DEPLOYMENT_PRIVATE_KEY=<your-funded-key> \
  go test -tags integration ./integration/ -v -count=1
```

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAIN_URL` | `http://127.0.0.1:8545` | RPC endpoint |
| `ADDRESSES_FILE` | `../../config/coston2/deployed-addresses.json` | Deployed registry addresses |
| `DEPLOYMENT_PRIVATE_KEY` | Hardhat dev key | Funded key for deployments |

Integration tests deploy fresh contracts on each run (gas cost on Coston2).

## End-to-end tests

Requires a running extension stack and registered TEE (see [README](../README.md) or [deployment-steps.md](deployment-steps.md)).

```bash
./scripts/test.sh
```

Or the full setup including test:

```bash
./scripts/full-setup.sh --test
```

### What `run-test` does

[`tools/cmd/run-test/main.go`](../tools/cmd/run-test/main.go) implements the insurance demo:

1. `setExtensionId` (idempotent)
2. `setPayToken` + fund payout pool (10 WPT)
3. `setGateway` (deployer acts as gateway for `getWeather` / `requestSettlement`)
4. `setTeeAddress` from proxy `/info`
5. Geocode city → **private buy** by default (`buyPolicyPrivate` + `relayPrivateBuy`)
6. Approve settle fee if configured → `requestSettlement` → poll TEE → `settle`
7. Assert policy settled and WPT payout matches rainfall ≥ threshold

Defaults: Berlin,DE; date `2026-05-26`; threshold `1` (0.01 mm × 100); private mode on.

**Public buy instead:**

```bash
cd tools && go run ./cmd/run-test/ -private=false \
  --instructionSender "$INSTRUCTION_SENDER" \
  -p "$EXT_PROXY_URL"
```

Useful flags: `-date`, `-city`, `-thresholdMmE2`, `-payToken`, `-p` (proxy URL).

### Solidity unit tests

```bash
forge test
```

Covers `relayPrivateBuy` signature checks and `buyPolicyPrivate` instruction routing.

## Op surface under test

| OPType | OPCommand | Role in e2e |
|--------|-----------|-------------|
| `WEATHER` | `BUY` | Private policy terms (ECIES) → `relayPrivateBuy` |
| `WEATHER` | `SETTLE` | OpenWeatherMap `day_summary` → on-chain `settle` |
| `WEATHER` | `FETCH` | Live weather (frontend / x402; not the default CLI demo) |

Types and decoders: [`pkg/types/`](../pkg/types/). Instruction helpers: [`tools/pkg/utils/instructions.go`](../tools/pkg/utils/instructions.go).

## See also

- [deployment-steps.md](deployment-steps.md) — deploy then test on Confidential Space
- [frontend-private-buy.md](frontend-private-buy.md) — UI private buy path
- [frontend-weather-fetch.md](frontend-weather-fetch.md) — x402 FETCH path
- [types-server.md](types-server.md) — decode API for FETCH / SETTLE / BUY payloads
