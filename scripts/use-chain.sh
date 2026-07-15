#!/usr/bin/env bash
# use-chain.sh — Swap the active .env for a given chain, optionally as a local /
# simulated-TEE variant.
#
# Usage:
#   ./scripts/use-chain.sh [local] <chain>
#   ./scripts/use-chain.sh --list
#   ./scripts/use-chain.sh --help
#
# Reads a template from the project root and copies it to .env:
#   <chain>          → .env.<chain>          (deployed)
#   local <chain>    → .env.local.<chain>    (simulated TEE, ngrok proxy)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() { echo "usage: $0 [local] <chain> | --list | --help" >&2; }

print_help() {
    cat <<EOF
use-chain.sh — activate a chain's .env (optionally local/simulated)

Usage:
  $0 [local] <chain>   Copy .env.<chain> or .env.local.<chain> → .env
  $0 --list            List available chains
  $0 --help, -h        Show this help

Arguments:
  local        Optional leading keyword. Uses .env.local.<chain>
               (simulated TEE + ngrok proxy) instead of .env.<chain>.
  <chain>      A chain with a matching template (see --list).

Examples:
  $0 coston2           Deployed Coston2
  $0 local coston2     Local/simulated Coston2 (Docker + ngrok)
EOF
}

list_options() {
    local f name found=0
    echo "Deployed chains (.env.<chain> in $PROJECT_DIR):"
    for f in "$PROJECT_DIR"/.env.*; do
        [[ -e "$f" ]] || continue
        name="${f##*/.env.}"
        [[ "$name" == "example" ]] && continue
        [[ "$name" == local.* ]] && continue
        echo "  - $name"
        found=1
    done
    [[ "$found" -eq 1 ]] || echo "  (none found — create one by copying .env.example)"
    echo ""
    echo "Local / simulated variants (.env.local.<chain>):"
    found=0
    for f in "$PROJECT_DIR"/.env.local.*; do
        [[ -e "$f" ]] || continue
        name="${f##*/.env.local.}"
        echo "  - local $name"
        found=1
    done
    [[ "$found" -eq 1 ]] || echo "  (none found)"
}

[[ $# -ge 1 ]] || { usage; exit 1; }

case "$1" in
    -h|--help) print_help; exit 0 ;;
    --list)    list_options; exit 0 ;;
    -*)        echo "unknown flag: $1" >&2; usage; exit 1 ;;
esac

LOCAL=false
if [[ "$1" == "local" ]]; then
    LOCAL=true
    shift
    [[ $# -ge 1 ]] || { echo "local mode needs a chain, e.g. '$0 local coston2'" >&2; usage; exit 1; }
fi

[[ $# -eq 1 ]] || { usage; exit 1; }
CHAIN="$1"

if [[ "$LOCAL" == true ]]; then
    SRC="$PROJECT_DIR/.env.local.$CHAIN"
else
    SRC="$PROJECT_DIR/.env.$CHAIN"
fi
DST="$PROJECT_DIR/.env"

[[ -f "$SRC" ]] || { echo "no such file: $SRC" >&2; echo "run '$0 --list' to see available templates" >&2; exit 1; }

cp "$SRC" "$DST"
echo "[use-chain] copied ${SRC##*/} → .env"
echo "[use-chain] mode=$([[ "$LOCAL" == true ]] && echo 'local (simulated TEE)' || echo 'deployed')"
echo "[use-chain] EXT_PROXY_URL=$(grep -E '^EXT_PROXY_URL=' "$DST" | head -1 | cut -d= -f2-)"
echo "[use-chain] CHAIN_URL=$(grep -E '^CHAIN_URL=' "$DST" | head -1 | cut -d= -f2-)"
echo "[use-chain] SIMULATED_TEE=$(grep -E '^SIMULATED_TEE=' "$DST" | head -1 | cut -d= -f2-)"
