# cast-chain.sh — Foundry CLI helpers when .env sets CHAIN=coston|coston2.
#
# Foundry reads CHAIN from the environment and rejects "coston2". Passing
# `--chain flare-coston2` after cast call positional args is also unsafe (cast
# may treat "flare-coston2" as a function argument). Prefer:
#   cast_rpc_args  — eth_call / cast call (rpc-url only, CHAIN unset)
#   cast_tx_args   — cast send (rpc-url + --chain flare-*)
#   foundry_chain_args — forge verify-contract, etc.
#
# shellcheck shell=bash

foundry_chain_args() {
    case "${DEPLOY_CHAIN:-${CHAIN:-}}" in
        coston2) echo --chain flare-coston2 ;;
        coston)  echo --chain flare ;;
        *)       echo ;;
    esac
}

# eth_call: rpc-url is enough; do not pass --chain after positional args.
cast_rpc_args() {
    echo --rpc-url "${CHAIN_URL:?CHAIN_URL not set}"
}

# Transactions: explicit Foundry chain name + rpc-url.
cast_tx_args() {
    echo --rpc-url "${CHAIN_URL:?CHAIN_URL not set}"
    foundry_chain_args
}

# Back-compat alias (forge, older scripts).
cast_chain_args() { foundry_chain_args; }

# Run cast outside the project tree so Foundry does not load .env (CHAIN=coston2 breaks cast).
_cast_env_run() {
    [[ "${1:-}" == "cast" ]] && shift
    local _cast_tmp _ec
    _cast_tmp="$(mktemp -d)"
    (
        cd "$_cast_tmp"
        env -i HOME="${HOME:-}" PATH="${PATH:-/usr/bin:/bin}" cast "$@"
    )
    _ec=$?
    rm -rf "$_cast_tmp"
    return "$_ec"
}

cast_env() { _cast_env_run "$@"; }
cast_env_tx() { _cast_env_run "$@"; }
