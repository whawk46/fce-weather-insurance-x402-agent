#!/usr/bin/env bash
# sync-env.sh — Propagate repo .env + config/extension.env → frontend env files.
#
# Updates only known keys; leaves OPENAI_API_KEY, AI_MODEL, and other secrets alone.
#
# Usage:
#   ./scripts/sync-env.sh            # sync frontend/.env + frontend/.env.local
#   ./scripts/sync-env.sh --env-only # sync frontend/.env only (skip .env.local)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[sync-env]${NC} $*"; }
warn() { echo -e "${YELLOW}[sync-env]${NC} $*"; }
die()  { echo -e "${RED}[sync-env] ERROR:${NC} $*" >&2; exit 1; }

SYNC_LOCAL=true
for arg in "$@"; do
  case "$arg" in
    --env-only) SYNC_LOCAL=false ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) die "Unknown argument: $arg (try --help)" ;;
  esac
done

# --- Load sources (same order as start-services.sh) ---
[[ -f "$PROJECT_DIR/.env" ]] || die "Missing $PROJECT_DIR/.env — run ./scripts/use-chain.sh first"
set -a
# shellcheck disable=SC1091
source "$PROJECT_DIR/.env"
set +a

EXT_ENV="$PROJECT_DIR/config/extension.env"
[[ -f "$EXT_ENV" ]] || die "Missing $EXT_ENV — run ./scripts/pre-build.sh first"
set -a
# shellcheck disable=SC1091
source "$EXT_ENV"
set +a

: "${INSTRUCTION_SENDER:?INSTRUCTION_SENDER not set in extension.env}"

NEXT_PORT="${PORT:-3000}"
GATEWAY_URL="http://localhost:${NEXT_PORT}"

# --- Portable key setter (preserves unrelated lines) ---
set_kv() {
  local file="$1" key="$2" value="$3"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$file" ]] && grep -q "^${key}=" "$file"; then
    sed "s|^${key}=.*|${key}=${value}|" "$file" > "$tmp"
  else
    [[ -f "$file" ]] && cp "$file" "$tmp" || : > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}

sync_file() {
  local target="$1"
  if [[ ! -f "$target" ]]; then
    if [[ -f "$PROJECT_DIR/frontend/.env.local.example" ]]; then
      cp "$PROJECT_DIR/frontend/.env.local.example" "$target"
    else
      touch "$target"
    fi
  fi

  set_kv "$target" "NEXT_PUBLIC_WEATHER_INSURANCE" "$INSTRUCTION_SENDER"
  [[ -n "${PAY_TOKEN:-}" ]] && set_kv "$target" "NEXT_PUBLIC_PAY_TOKEN" "$PAY_TOKEN"
  [[ -n "${EXT_PROXY_URL:-}" ]] && set_kv "$target" "EXT_PROXY_URL" "$EXT_PROXY_URL"
  set_kv "$target" "EXT_PROXY_LOCAL_URL" "${EXT_PROXY_LOCAL_URL:-http://127.0.0.1:6674}"
  set_kv "$target" "NEXT_PUBLIC_X402_GATEWAY_URL" "$GATEWAY_URL"

  log "Updated $target"
  log "  NEXT_PUBLIC_WEATHER_INSURANCE=$INSTRUCTION_SENDER"
  [[ -n "${PAY_TOKEN:-}" ]] && log "  NEXT_PUBLIC_PAY_TOKEN=$PAY_TOKEN"
  [[ -n "${EXT_PROXY_URL:-}" ]] && log "  EXT_PROXY_URL=$EXT_PROXY_URL"
  log "  NEXT_PUBLIC_X402_GATEWAY_URL=$GATEWAY_URL"
}

# frontend/.env — shared defaults (MCP also reads this)
sync_file "$PROJECT_DIR/frontend/.env"

# frontend/.env.local — overrides + secrets (OPENAI_API_KEY untouched)
if [[ "$SYNC_LOCAL" == true ]]; then
  sync_file "$PROJECT_DIR/frontend/.env.local"
fi

warn "Restart Next.js after contract/tunnel changes:"
warn "  cd frontend && npm run dev   # serves dApp + x402 gateway on /x402/weather/*"
