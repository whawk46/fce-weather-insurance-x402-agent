# Types server

Lightweight HTTP sidecar that decodes raw hex-encoded instruction data into human-readable JSON. It runs alongside the extension and exposes `/decode` so frontends, dashboards, and debugging tools can display payloads without knowing Go types.

This extension registers **WEATHER** / **FETCH**, **SETTLE**, and **BUY** decoders — see [`pkg/types/register.go`](../pkg/types/register.go).

## Why it exists

Instruction `data` fields in the TEE pipeline are raw bytes (hex-encoded). The types server keeps a registry of decoders keyed by `(OPType, OPCommand, Kind)` so any client can `POST /decode` and get structured JSON.

## Architecture

```
pkg/decoder/
├── decoder.go      Decoder interface + DataKind
├── registry.go     Thread-safe Registry
├── json.go         JSONDecoder[T]
└── abi.go          ABIDecoder[T]

pkg/types/
├── types.go        GetWeatherRequest, WeatherReport, SettleRequest, …
└── register.go     RegisterDecoders()

internal/typesserver/
└── server.go       POST /decode, GET /registry, GET /health

cmd/types-server/
└── main.go         Standalone entry point

pkg/server/
└── typesserver.go  StartTypesServer() for embedded use
```

## How it runs

**Embedded (default)** — started inside the Docker container with the extension (`cmd/docker/main.go`):

```go
go extserver.StartTypesServer(config.TypesServerPort)
```

Compose already maps port **8100** (`TYPES_SERVER_BIND`, default `127.0.0.1:8100`).

**Standalone:**

```bash
TYPES_SERVER_PORT=8100 go run ./cmd/types-server
```

Port via `TYPES_SERVER_PORT` (default `8100`).

## Registered decoders

| OPType | OPCommand | Kind | Encoding | Type |
|--------|-----------|------|----------|------|
| `WEATHER` | `FETCH` | message | ABI | `GetWeatherRequest` (`city`, `payer`) |
| `WEATHER` | `FETCH` | result | JSON | `WeatherReport` |
| `WEATHER` | `SETTLE` | message | ABI | `SettleRequest` |
| `WEATHER` | `SETTLE` | result | ABI tuple | `SettlementResult` |
| `WEATHER` | `BUY` | message | opaque | encrypted ciphertext metadata |
| `WEATHER` | `BUY` | result | ABI tuple | `PrivateBuyResult` |
| `WEATHER` | `BUY_PLAINTEXT` | message | ABI | `PrivateBuyParams` (tooling only) |

## API

### `POST /decode`

```json
{
  "opType": "WEATHER",
  "opCommand": "FETCH",
  "kind": "result",
  "data": "0x7b2263697479223a224265726c696e22…"
}
```

| Field | Description |
|-------|-------------|
| `opType` | e.g. `"WEATHER"` |
| `opCommand` | e.g. `"FETCH"`, `"SETTLE"`, `"BUY"` |
| `kind` | `"message"` (request) or `"result"` (response) |
| `data` | Hex-encoded bytes with `0x` prefix |

**200:** `{ "decoded": { … } }`

| Status | When |
|--------|------|
| 400 | Bad body, invalid `kind`, or invalid hex |
| 404 | No decoder for `(opType, opCommand, kind)` |
| 422 | Decoder found but data could not be decoded |

### `GET /registry`

Lists registered keys, for example:

```json
[
  { "opType": "WEATHER", "opCommand": "FETCH", "kind": "message" },
  { "opType": "WEATHER", "opCommand": "FETCH", "kind": "result" },
  { "opType": "WEATHER", "opCommand": "SETTLE", "kind": "message" },
  { "opType": "WEATHER", "opCommand": "SETTLE", "kind": "result" },
  { "opType": "WEATHER", "opCommand": "BUY", "kind": "message" },
  { "opType": "WEATHER", "opCommand": "BUY", "kind": "result" },
  { "opType": "WEATHER", "opCommand": "BUY_PLAINTEXT", "kind": "message" }
]
```

### `GET /health`

```json
{ "status": "ok", "version": "0.1.0" }
```

## Smoke test

With the Docker stack running (or a standalone types-server):

```bash
curl -s http://localhost:8100/health | jq .
curl -s http://localhost:8100/registry | jq .

# Decode a FETCH result (JSON WeatherReport as 0x-hex)
HEX=$(echo -n '{"city":"Berlin","country":"DE","description":"clear sky","tempC":18.5,"feelsLikeC":17.2,"humidityPct":55,"pressureHpa":1013,"windMS":3.1,"observedAt":1717000000}' | xxd -p | tr -d '\n')
curl -s -X POST http://localhost:8100/decode \
  -H 'Content-Type: application/json' \
  -d "{\"opType\":\"WEATHER\",\"opCommand\":\"FETCH\",\"kind\":\"result\",\"data\":\"0x${HEX}\"}" | jq .
```

Or use the scripted runner:

```bash
./scripts/test-types-server.sh
```

### Generating hex test data

```bash
echo -n '{"city":"Berlin","country":"DE"}' | xxd -p | tr -d '\n' | sed 's/^/0x/'
```

### Error cases

```bash
# Unknown op → 404
curl -s -X POST http://localhost:8100/decode \
  -d '{"opType":"UNKNOWN","opCommand":"FETCH","kind":"message","data":"0x7b7d"}' | jq .

# Invalid kind → 400
curl -s -X POST http://localhost:8100/decode \
  -d '{"opType":"WEATHER","opCommand":"FETCH","kind":"invalid","data":"0x7b7d"}' | jq .
```

## Adding a new operation

1. Define request/response structs in [`pkg/types/types.go`](../pkg/types/types.go).
2. Register in [`pkg/types/register.go`](../pkg/types/register.go) with `JSONDecoder` or `ABIDecoder` (or a custom `Decoder`).
3. Rebuild and check:

```bash
TYPES_SERVER_PORT=8100 go run ./cmd/types-server &
curl -s http://localhost:8100/registry | jq .
kill %1
```

## Choosing a decoder

- **`JSONDecoder[T]`** — JSON bytes in `ActionResult.Data` (e.g. FETCH `WeatherReport`).
- **`ABIDecoder[T]`** — Solidity `abi.encode` / struct layouts (e.g. FETCH / SETTLE messages).
- **Custom `Decoder`** — opaque BUY ciphertext, flat settlement / private-buy result tuples.

Registry `Lookup` tries exact `(OPType, OPCommand, Kind)`, then falls back to empty `OPCommand`.

## See also

- [README](../README.md) — stack startup (types-server on 8100)
- [frontend-weather-fetch.md](frontend-weather-fetch.md) — UI uses decoded FETCH results via the x402 gateway
- [testing.md](testing.md) — `./scripts/test-types-server.sh`
