#!/usr/bin/env bash
# extension-setup.sh — Extension-specific setup that runs BEFORE Docker Compose.
#
# This hook runs between pre-build (contract deployment) and docker-up (starting
# the TEE). Use it for any setup whose output the extension needs at startup —
# for example:
#   - Deploying auxiliary contracts (ERC20 tokens, oracles, vaults)
#   - Writing config files the extension reads at init (pairs, feeds, pools)
#   - Minting test tokens, setting allowances, seeding initial state
#
# The following variables are available (sourced from .env + config/extension.env):
#
#   INSTRUCTION_SENDER   — your deployed InstructionSender contract address
#   EXTENSION_ID         — your extension's ID on the TeeExtensionRegistry
#   CHAIN_URL            — chain RPC endpoint
#   ADDRESSES_FILE       — path to deployed-addresses.json
#   DEPLOYMENT_PRIVATE_KEY — funded deployer key
#
# Example: deploy a helper contract and write its address to a config file
#
#   cd "$PROJECT_DIR/tools"
#   HELPER_ADDR=$(go run ./cmd/deploy-helper -a "$ADDRESSES_FILE" -c "$CHAIN_URL")
#   echo "HELPER_CONTRACT=$HELPER_ADDR" > "$PROJECT_DIR/config/helper.env"
#
# Why this matters:
#   The extension container reads config at startup. Anything it needs must be
#   written to disk BEFORE `docker compose up`. If you deploy contracts after
#   the container starts, you'll need to restart it — this hook prevents that.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=cast-chain.sh
source "$SCRIPT_DIR/cast-chain.sh"

GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[extension-setup]${NC} $*"; }

# --- Load environment ---
if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
fi
if [[ -f "$PROJECT_DIR/config/extension.env" ]]; then
    source "$PROJECT_DIR/config/extension.env"
fi

log "EXTENSION_ID:       ${EXTENSION_ID:-<not set>}"
log "INSTRUCTION_SENDER: ${INSTRUCTION_SENDER:-<not set>}"
log "CHAIN_URL:          ${CHAIN_URL:-<not set>}"

# --- weather-insurance: set the ERC-20 pay token (if configured) ---
# Premiums and payouts are denominated in PAY_TOKEN. Set it on the contract now
# so the deployed contract is ready for buyPolicy/fundPool. Pool funding is left
# to the owner (it needs an ERC-20 approve + balance) — see the run-test demo.
# The OpenWeatherMap API key is provisioned via OPENWEATHERMAP_API_KEY in the
# container env, not on-chain.

if [[ -n "${PAY_TOKEN:-}" ]]; then
    : "${INSTRUCTION_SENDER:?INSTRUCTION_SENDER not set — run pre-build.sh first}"
    : "${CHAIN_URL:?CHAIN_URL not set}"
    : "${DEPLOYMENT_PRIVATE_KEY:?DEPLOYMENT_PRIVATE_KEY not set}"
    log "Setting pay token $PAY_TOKEN on WeatherInsurance ($INSTRUCTION_SENDER)..."
    cast_env_tx cast send --rpc-url "$CHAIN_URL" --chain flare-coston2 \
        "$INSTRUCTION_SENDER" "setPayToken(address)" "$PAY_TOKEN" \
        --private-key "$DEPLOYMENT_PRIVATE_KEY" >/dev/null
    log "Pay token set."
else
    log "PAY_TOKEN not set — skipping setPayToken (set it later via cast or run-test)."
fi

# --- weather-insurance: register the x402 gateway ---
# getWeather/requestSettlement are onlyGateway — only this address may call them.
# Defaults to the deployer's own address (DEPLOYMENT_PRIVATE_KEY) so the existing
# CLI tools (tools/cmd/settle, tools/cmd/run-test) keep working unmodified; set
# GATEWAY_ADDRESS explicitly if the Next.js x402 gateway runs with a separate key.

if [[ -n "${INSTRUCTION_SENDER:-}" ]]; then
    : "${CHAIN_URL:?CHAIN_URL not set}"
    : "${DEPLOYMENT_PRIVATE_KEY:?DEPLOYMENT_PRIVATE_KEY not set}"

    GATEWAY_ADDRESS="${GATEWAY_ADDRESS:-}"
    if [[ -z "$GATEWAY_ADDRESS" ]]; then
        GATEWAY_ADDRESS="$(cast_env cast wallet address --private-key "$DEPLOYMENT_PRIVATE_KEY")"
    fi

    log "Setting gateway $GATEWAY_ADDRESS on WeatherInsurance ($INSTRUCTION_SENDER)..."
    cast_env_tx cast send --rpc-url "$CHAIN_URL" --chain flare-coston2 \
        "$INSTRUCTION_SENDER" "setGateway(address)" "$GATEWAY_ADDRESS" \
        --private-key "$DEPLOYMENT_PRIVATE_KEY" >/dev/null
    log "Gateway set."
fi

# --- weather-insurance: set the on-chain FXRP fee for getWeather/requestSettlement ---
# getWeather/requestSettlement pull FEE_TOKEN via transferFrom atomically with the
# instruction (WeatherInsurance._collectFee) — enforced by the contract itself,
# not by an off-chain relay. FETCH_FEE/SETTLE_FEE of 0 (or unset) leaves the fee
# disabled, so existing flows keep working until you opt in.

if [[ -n "${FEE_TOKEN:-}" ]]; then
    : "${INSTRUCTION_SENDER:?INSTRUCTION_SENDER not set — run pre-build.sh first}"
    : "${CHAIN_URL:?CHAIN_URL not set}"
    : "${DEPLOYMENT_PRIVATE_KEY:?DEPLOYMENT_PRIVATE_KEY not set}"

    log "Setting fee token $FEE_TOKEN on WeatherInsurance ($INSTRUCTION_SENDER)..."
    cast_env_tx cast send --rpc-url "$CHAIN_URL" --chain flare-coston2 \
        "$INSTRUCTION_SENDER" "setFeeToken(address)" "$FEE_TOKEN" \
        --private-key "$DEPLOYMENT_PRIVATE_KEY" >/dev/null

    if [[ -n "${FEE_RECIPIENT:-}" ]]; then
        log "Setting fee recipient $FEE_RECIPIENT..."
        cast_env_tx cast send --rpc-url "$CHAIN_URL" --chain flare-coston2 \
            "$INSTRUCTION_SENDER" "setFeeRecipient(address)" "$FEE_RECIPIENT" \
            --private-key "$DEPLOYMENT_PRIVATE_KEY" >/dev/null
    else
        log "FEE_RECIPIENT not set — leaving it unset. getWeather/requestSettlement will revert if FETCH_FEE/SETTLE_FEE > 0 until it's set."
    fi

    if [[ -n "${FETCH_FEE:-}" && "${FETCH_FEE}" != "0" ]]; then
        log "Setting fetch fee $FETCH_FEE..."
        cast_env_tx cast send --rpc-url "$CHAIN_URL" --chain flare-coston2 \
            "$INSTRUCTION_SENDER" "setFetchFee(uint256)" "$FETCH_FEE" \
            --private-key "$DEPLOYMENT_PRIVATE_KEY" >/dev/null
    fi

    if [[ -n "${SETTLE_FEE:-}" && "${SETTLE_FEE}" != "0" ]]; then
        log "Setting settle fee $SETTLE_FEE..."
        cast_env_tx cast send --rpc-url "$CHAIN_URL" --chain flare-coston2 \
            "$INSTRUCTION_SENDER" "setSettleFee(uint256)" "$SETTLE_FEE" \
            --private-key "$DEPLOYMENT_PRIVATE_KEY" >/dev/null
    fi

    log "Fee configuration set."
else
    log "FEE_TOKEN not set — skipping fee setup (getWeather/requestSettlement stay fee-free)."
fi
