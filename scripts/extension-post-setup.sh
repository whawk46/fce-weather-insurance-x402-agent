#!/usr/bin/env bash
# extension-post-setup.sh — Extension-specific setup that runs AFTER post-build.
#
# This hook runs once the TEE node is live and registered on-chain in
# TeeMachineRegistry. Use it for setup that needs the TEE's on-chain identity
# to already exist — things that couldn't be done in extension-setup.sh because
# the TEE hadn't been registered yet.
#
# Typical uses:
#   - Reading the TEE signing address from TeeMachineRegistry.getActiveTeeMachines
#     and writing it to a contract so withdrawal / authorization signatures can
#     be verified on-chain via ecrecover.
#   - Granting the registered TEE node any extension-specific on-chain roles.
#   - Seeding on-chain state that depends on knowing which TEE is active.
#
# The following variables are available (sourced from .env + config/extension.env):
#
#   INSTRUCTION_SENDER     — your deployed InstructionSender contract address
#   EXTENSION_ID           — your extension's ID on the TeeExtensionRegistry
#   CHAIN_URL              — chain RPC endpoint
#   ADDRESSES_FILE         — path to deployed-addresses.json
#   DEPLOYMENT_PRIVATE_KEY — funded deployer/admin key
#
# Example: read the TEE address and register it with your contract
#
#   TEE_MACHINE_REGISTRY="$(jq -r '.TeeMachineRegistry' "$ADDRESSES_FILE")"
#   tee_addr=$(cast call "$TEE_MACHINE_REGISTRY" \
#       "getActiveTeeMachines(uint256)(address[],string[])" "$EXTENSION_ID" \
#       --rpc-url "$CHAIN_URL" | head -1 | tr -d '[]' | cut -d, -f1 | xargs)
#   cast send "$INSTRUCTION_SENDER" "setTeeAddress(address)" "$tee_addr" \
#       --rpc-url "$CHAIN_URL" --private-key "$DEPLOYMENT_PRIVATE_KEY"
#
# Why this matters:
#   Some on-chain verification requires the TEE's signing address to be known
#   to the contract. Since that address is only derivable after the TEE
#   registers itself, the wiring has to happen here — not in extension-setup.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=cast-chain.sh
source "$SCRIPT_DIR/cast-chain.sh"

GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[extension-post-setup]${NC} $*"; }

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

# --- weather-insurance: register the active TEE signing address on the contract ---
# settle() verifies the TEE's signature on the rainfall result via ecrecover, so
# the contract needs to know the TEE's address. It's only derivable after the TEE
# registers itself on TeeMachineRegistry — hence this runs post-build.

: "${INSTRUCTION_SENDER:?INSTRUCTION_SENDER not set — run pre-build.sh first}"
: "${EXTENSION_ID:?EXTENSION_ID not set — run pre-build.sh first}"
: "${ADDRESSES_FILE:?ADDRESSES_FILE not set}"
: "${CHAIN_URL:?CHAIN_URL not set}"
: "${DEPLOYMENT_PRIVATE_KEY:?DEPLOYMENT_PRIVATE_KEY not set}"

# Coston/Coston2 use array+Diamond format: [{ "name": "FlareTeeManager", "address": "0x…" }, …]
TEE_MACHINE_REGISTRY="$(jq -r '.[] | select(.name=="FlareTeeManager") | .address' "$ADDRESSES_FILE" 2>/dev/null | head -1)"
if [[ -z "$TEE_MACHINE_REGISTRY" || "$TEE_MACHINE_REGISTRY" == "null" ]]; then
    TEE_MACHINE_REGISTRY="$(jq -r '.FlareTeeManager // .TeeMachineRegistry // empty' "$ADDRESSES_FILE" 2>/dev/null || true)"
fi
if [[ -z "$TEE_MACHINE_REGISTRY" || "$TEE_MACHINE_REGISTRY" == "null" ]]; then
    echo "ERROR: FlareTeeManager not found in $ADDRESSES_FILE" >&2
    exit 1
fi

log "Reading active TEE machine from $TEE_MACHINE_REGISTRY (extension $EXTENSION_ID)..."

tee_out=$(cast_env cast call --rpc-url "$CHAIN_URL" "$TEE_MACHINE_REGISTRY" \
    "getActiveTeeMachines(uint256)(address[],string[])" "$EXTENSION_ID")
# First line is the address array, e.g. [0x8833Cd5e…]
tee_addr=$(echo "$tee_out" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)

if [[ -z "$tee_addr" || "$tee_addr" == "0x0000000000000000000000000000000000000000" ]]; then
    echo "ERROR: no active TEE machine found for extension $EXTENSION_ID — is the TEE registered (post-build)?" >&2
    exit 1
fi

log "Active TEE address: $tee_addr"
log "Registering it on WeatherInsurance ($INSTRUCTION_SENDER)..."
cast_env_tx cast send --rpc-url "$CHAIN_URL" --chain flare-coston2 \
    "$INSTRUCTION_SENDER" "setTeeAddress(address)" "$tee_addr" \
    --private-key "$DEPLOYMENT_PRIVATE_KEY" >/dev/null

log "TEE address registered. settle() will now accept signatures from $tee_addr."
