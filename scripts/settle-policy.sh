#!/usr/bin/env bash
# settle-policy.sh — Keeper: settle one rainfall policy.
#
# Run this on/after the policy's coverage date (after midnight UTC on the following day;
# event day). It asks the TEE to fetch that date's rainfall from OpenWeatherMap,
# then relays the TEE-signed result to WeatherInsurance.settle(), which verifies
# the signature and pays out if the threshold was met.
#
# Usage:
#   ./scripts/settle-policy.sh <policyId>
#
# Inputs (env vars, auto-loaded from .env + config/extension.env):
#   INSTRUCTION_SENDER  — deployed WeatherInsurance address
#   EXT_PROXY_URL       — extension proxy URL (auto-detected if unset)
#   CHAIN_URL           — chain RPC URL
#   ADDRESSES_FILE      — path to deployed-addresses.json (auto-detected if unset)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[settle]${NC} $*"; }
die()  { echo -e "${RED}[settle] ERROR:${NC} $*" >&2; exit 1; }

[[ $# -eq 1 ]] || die "usage: $0 <policyId>"
POLICY_ID="$1"

# --- Load env ---
if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
fi
if [[ -f "$PROJECT_DIR/config/extension.env" ]]; then
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/config/extension.env"
fi

CHAIN_URL="${CHAIN_URL:-http://127.0.0.1:8545}"
INSTRUCTION_SENDER="${INSTRUCTION_SENDER:-}"
[[ -n "$INSTRUCTION_SENDER" ]] || die "INSTRUCTION_SENDER not set. Run pre-build.sh first."

# Auto-detect proxy port: Docker (6674) if ext-proxy container is running, else local (6664).
if [[ -z "${EXT_PROXY_URL:-}" ]]; then
    if docker compose ps ext-proxy --status running 2>/dev/null | grep -q ext-proxy; then
        EXT_PROXY_URL="http://localhost:6674"
    else
        EXT_PROXY_URL="http://localhost:6664"
    fi
fi

ADDRESSES_FILE="${ADDRESSES_FILE:-}"
if [[ -n "$ADDRESSES_FILE" && "$ADDRESSES_FILE" != /* ]]; then
    ADDRESSES_FILE="$PROJECT_DIR/$ADDRESSES_FILE"
fi

log "Policy:             $POLICY_ID"
log "WeatherInsurance:   $INSTRUCTION_SENDER"
log "Extension proxy:    $EXT_PROXY_URL"
log "Chain URL:          $CHAIN_URL"

ARGS=(-c "$CHAIN_URL" -p "$EXT_PROXY_URL" -contract "$INSTRUCTION_SENDER" -policyId "$POLICY_ID")
[[ -n "$ADDRESSES_FILE" ]] && ARGS+=(-a "$ADDRESSES_FILE")

echo -e "\n${CYAN}=== Requesting settlement and relaying TEE result ===${NC}"
cd "$PROJECT_DIR/tools"
go run ./cmd/settle "${ARGS[@]}" || die "settlement failed"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Policy $POLICY_ID settled${NC}"
echo -e "${GREEN}========================================${NC}"
