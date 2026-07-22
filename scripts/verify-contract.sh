#!/usr/bin/env bash
# verify-contract.sh — Verify the deployed WeatherInsurance contract source on the
# chain's Blockscout explorer.
#
# Called automatically by pre-build.sh right after deployment, and can be re-run
# standalone:
#
#   ./scripts/verify-contract.sh <address>
#
# Inputs (env vars, auto-loaded from .env + config/extension.env):
#   CHAIN            — local | coston | coston2 | songbird | flare (picks the explorer)
#   ADDRESSES_FILE   — deployed-addresses.json (to read the FlareTeeManager constructor arg)
#   VERIFIER_URL     — override the Blockscout API base (…/api/). Optional.
#   VERIFIER_API_KEY — explorer API key, if the instance requires one. Optional.
#
# Verification is best-effort: it never deploys or changes chain state, and a
# failure here does not fail the deploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=cast-chain.sh
source "$SCRIPT_DIR/cast-chain.sh"

YELLOW='\033[0;33m'; GREEN='\033[0;32m'; NC='\033[0m'
log()  { echo -e "${GREEN}[verify]${NC} $*"; }
warn() { echo -e "${YELLOW}[verify]${NC} $*" >&2; }

CONTRACT="contracts/InstructionSender.sol:WeatherInsurance"

[[ $# -ge 1 ]] || { warn "usage: $0 <address>"; exit 2; }
ADDRESS="$1"

# --- Load env (if not already provided by the caller) ---
if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
fi

CHAIN="${CHAIN:-}"

# If CHAIN isn't set explicitly, infer it from CHAIN_URL.
if [[ -z "$CHAIN" || "$CHAIN" == "local" ]]; then
    case "${CHAIN_URL:-}" in
        *coston2*)  CHAIN="coston2" ;;
        *coston*)   CHAIN="coston" ;;
        *songbird*) CHAIN="songbird" ;;
        *flare-api*|*flare.network/ext*) CHAIN="${CHAIN:-flare}" ;;
        *127.0.0.1*|*localhost*) CHAIN="local" ;;
        *) CHAIN="${CHAIN:-local}" ;;
    esac
fi

# --- Resolve the Blockscout explorer API base for this chain ---
resolve_verifier_url() {
    if [[ -n "${VERIFIER_URL:-}" ]]; then
        echo "$VERIFIER_URL"; return
    fi
    case "$CHAIN" in
        coston)   echo "https://coston-explorer.flare.network/api/" ;;
        coston2)  echo "https://coston2-explorer.flare.network/api/" ;;
        songbird) echo "https://songbird-explorer.flare.network/api/" ;;
        flare)    echo "https://flare-explorer.flare.network/api/" ;;
        *)        echo "" ;;  # local / unknown → no explorer
    esac
}

VURL="$(resolve_verifier_url)"

if [[ "$CHAIN" == "local" || -z "$VURL" ]]; then
    log "chain '$CHAIN' has no public explorer — skipping verification."
    exit 0
fi

if ! command -v forge >/dev/null 2>&1; then
    warn "forge not found — skipping verification."
    exit 0
fi
if ! command -v cast >/dev/null 2>&1; then
    warn "cast not found — skipping verification."
    exit 0
fi

# --- Constructor args: WeatherInsurance(ITeeExtensionRegistry, ITeeMachineRegistry),
#     both the FlareTeeManager diamond (see DeployInstructionSender). ---
ADDRESSES_FILE="${ADDRESSES_FILE:-}"
if [[ -n "$ADDRESSES_FILE" && "$ADDRESSES_FILE" != /* ]]; then
    ADDRESSES_FILE="$PROJECT_DIR/$ADDRESSES_FILE"
fi
if [[ -z "$ADDRESSES_FILE" || ! -f "$ADDRESSES_FILE" ]]; then
    warn "ADDRESSES_FILE not found — cannot derive constructor args; skipping verification."
    exit 0
fi

FTM="$(jq -r '.[] | select(.name=="FlareTeeManager") | .address' "$ADDRESSES_FILE" 2>/dev/null || true)"
if [[ -z "$FTM" || "$FTM" == "null" ]]; then
    warn "FlareTeeManager not found in $ADDRESSES_FILE — skipping verification."
    exit 0
fi

CTOR_ARGS="$(cast_env cast abi-encode 'constructor(address,address)' "$FTM" "$FTM")"

log "Chain:            $CHAIN"
log "Explorer API:     $VURL"
log "Address:          $ADDRESS"
log "Constructor args: FlareTeeManager=$FTM (x2)"

# forge reads foundry.toml from PROJECT_DIR (via-ir, solc version) so the
# recompiled bytecode matches what was deployed.
cd "$PROJECT_DIR"

VERIFY_ARGS=(
    "$ADDRESS" "$CONTRACT"
    --verifier blockscout
    --verifier-url "$VURL"
    --constructor-args "$CTOR_ARGS"
    --watch
)
[[ -n "${VERIFIER_API_KEY:-}" ]] && VERIFY_ARGS+=(--verifier-api-key "$VERIFIER_API_KEY")
[[ -n "${CHAIN_URL:-}" ]] && VERIFY_ARGS+=(--rpc-url "$CHAIN_URL")
# shellcheck disable=SC2207
VERIFY_ARGS+=($(foundry_chain_args))
# forge also reads CHAIN from env — hide it from forge's subprocess only
# (a plain `unset CHAIN` would also remove it for our own reference below,
# which trips `set -u`).
if env -u CHAIN forge verify-contract "${VERIFY_ARGS[@]}"; then
    log "Contract verified on $CHAIN explorer."
else
    warn "Verification did not complete (non-fatal). You can retry later:"
    warn "  ./scripts/verify-contract.sh $ADDRESS"
    exit 1
fi
