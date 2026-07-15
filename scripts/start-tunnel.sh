#!/usr/bin/env bash
# start-tunnel.sh — Start a cloudflared quick tunnel and update EXT_PROXY_URL.
#
# Starts cloudflared in the background, parses the trycloudflare.com URL,
# writes it to .env (and .env.local.<chain> when present), and syncs frontend env.
#
# Usage:
#   ./scripts/start-tunnel.sh                 # start tunnel + update .env + sync-env
#   ./scripts/start-tunnel.sh --stop          # stop the background tunnel
#   ./scripts/start-tunnel.sh --port 6674     # custom local port (default: 6674)
#   ./scripts/start-tunnel.sh --no-sync       # skip ./scripts/sync-env.sh
#   ./scripts/start-tunnel.sh --post-build    # run post-build.sh after URL update
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[start-tunnel]${NC} $*"; }
warn() { echo -e "${YELLOW}[start-tunnel]${NC} $*"; }
die()  { echo -e "${RED}[start-tunnel] ERROR:${NC} $*" >&2; exit 1; }

PORT=6674
DO_SYNC=true
DO_POST_BUILD=false
DO_STOP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      [[ $# -ge 2 ]] || die "--port requires a value"
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#--port=}"
      shift
      ;;
    --no-sync) DO_SYNC=false; shift ;;
    --post-build) DO_POST_BUILD=true; shift ;;
    --stop) DO_STOP=true; shift ;;
    -h|--help)
      sed -n '2,13p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) die "Unknown argument: $1 (try --help)" ;;
  esac
done

PID_FILE="$PROJECT_DIR/.cloudflared-tunnel.pid"
LOG_FILE="$PROJECT_DIR/.cloudflared-tunnel.log"

stop_tunnel() {
  if [[ ! -f "$PID_FILE" ]]; then
    warn "No tunnel PID file at ${PID_FILE##*/} — nothing to stop"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    log "Stopping cloudflared (pid $pid)..."
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      warn "cloudflared did not exit gracefully; sending SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
    fi
    log "Stopped cloudflared"
  else
    warn "Stale PID file (pid $pid not running)"
  fi
  rm -f "$PID_FILE"
}

if [[ "$DO_STOP" == true ]]; then
  stop_tunnel
  exit 0
fi

command -v cloudflared >/dev/null 2>&1 || die "cloudflared not found — install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"

# Restart if a previous tunnel is still running.
if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if kill -0 "$old_pid" 2>/dev/null; then
    warn "Stopping existing cloudflared tunnel (pid $old_pid) before starting a new one"
    stop_tunnel
  else
    rm -f "$PID_FILE"
  fi
fi

LOCAL_URL="http://localhost:${PORT}"
: > "$LOG_FILE"

log "Starting cloudflared quick tunnel → $LOCAL_URL"
cloudflared tunnel --url "$LOCAL_URL" >>"$LOG_FILE" 2>&1 &
tunnel_pid=$!
echo "$tunnel_pid" >"$PID_FILE"

cleanup_on_fail() {
  kill "$tunnel_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}
trap cleanup_on_fail ERR

tunnel_url=""
for _ in $(seq 1 45); do
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    die "cloudflared exited before publishing a URL — see $LOG_FILE"
  fi
  tunnel_url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | head -1 || true)"
  [[ -n "$tunnel_url" ]] && break
  sleep 1
done
trap - ERR

[[ -n "$tunnel_url" ]] || die "Timed out waiting for trycloudflare.com URL — see $LOG_FILE"

log "Tunnel URL: $tunnel_url"
log "PID: $tunnel_pid (log: ${LOG_FILE##*/})"

# --- Portable key setter (same approach as sync-env.sh) ---
set_kv() {
  local file="$1" key="$2" value="$3"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$file" ]] && grep -q "^${key}=" "$file"; then
    sed "s|^${key}=.*|${key}=${value}|" "$file" >"$tmp"
  else
    [[ -f "$file" ]] && cp "$file" "$tmp" || : >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  mv "$tmp" "$file"
}

ENV_FILE="$PROJECT_DIR/.env"
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — run ./scripts/use-chain.sh local coston2 first"

old_url="$(grep -E '^EXT_PROXY_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
set_kv "$ENV_FILE" "EXT_PROXY_URL" "$tunnel_url"
log "Updated $ENV_FILE → EXT_PROXY_URL=$tunnel_url"

chain="$(grep -E '^CHAIN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
if [[ -n "$chain" ]]; then
  local_env="$PROJECT_DIR/.env.local.$chain"
  if [[ -f "$local_env" ]]; then
    set_kv "$local_env" "EXT_PROXY_URL" "$tunnel_url"
    log "Updated $local_env → EXT_PROXY_URL=$tunnel_url"
  fi
fi

if [[ "$DO_SYNC" == true ]]; then
  log "Syncing frontend env..."
  bash "$SCRIPT_DIR/sync-env.sh"
fi

echo ""
echo -e "${CYAN}=== Cloudflare tunnel running ===${NC}"
echo "  Public URL : $tunnel_url"
echo "  Local port : $PORT"
echo "  PID file   : ${PID_FILE##*/}"
echo "  Log file   : ${LOG_FILE##*/}"
echo ""
echo "Keep this terminal open or leave the background process running."
echo "Stop with: ./scripts/start-tunnel.sh --stop"
echo ""

if [[ "$old_url" != "$tunnel_url" ]]; then
  warn "EXT_PROXY_URL changed — re-register the TEE on-chain:"
  warn "  bash ./scripts/post-build.sh"
  if [[ "$DO_POST_BUILD" == true ]]; then
    log "Running post-build.sh..."
    bash "$SCRIPT_DIR/post-build.sh"
  fi
else
  warn "Restart Next.js if it is already running:"
  warn "  cd frontend && npm run dev"
fi
