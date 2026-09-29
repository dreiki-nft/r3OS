#!/usr/bin/env bash
set -euo pipefail

# r3tards finale-auction keeper
# Usage:
#   RPC_URL=https://... KEEPER_ACCOUNT=my-keystore ./scripts/auction-keeper.sh <auction address> <auction id>
# Optional:
#   KEEPER_PASSWORD_FILE=/path/to/password.txt
#
# KEEPER_ACCOUNT is a Foundry keystore/account name. Never pass a raw private key.

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <auction address> <auction id>" >&2
  exit 2
fi

: "${RPC_URL:?RPC_URL is required}"
: "${KEEPER_ACCOUNT:?KEEPER_ACCOUNT is required}"

AUCTION="$1"
ID="$2"
PASSWORD_ARGS=()
if [[ -n "${KEEPER_PASSWORD_FILE:-}" ]]; then
  PASSWORD_ARGS=(--password-file "$KEEPER_PASSWORD_FILE")
fi

KEEPER_ADDRESS="$(cast wallet address --account "$KEEPER_ACCOUNT" ${PASSWORD_ARGS[@]+"${PASSWORD_ARGS[@]}"})"
INFO_SIG='auctionInfo(uint256)(address,uint256,uint128,uint48,uint48,uint48,uint8,uint128,uint256,uint48,address,uint128,uint128,bool)'

while true; do
  STATE="$(cast call "$AUCTION" "$INFO_SIG" "$ID" --rpc-url "$RPC_URL" | sed -n '7p' | awk '{print $1}')"
  if [[ "$STATE" == "2" ]]; then
    echo "auction $ID is already settled"
    exit 0
  fi

  if cast call "$AUCTION" 'settle(uint256)' "$ID" --from "$KEEPER_ADDRESS" --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    TX_HASH="$(cast send "$AUCTION" 'settle(uint256)' "$ID" \
      --rpc-url "$RPC_URL" \
      --account "$KEEPER_ACCOUNT" \
      ${PASSWORD_ARGS[@]+"${PASSWORD_ARGS[@]}"} \
      --json | sed -n 's/.*"transactionHash":"\([^"]*\)".*/\1/p')"
    echo "settled auction $ID: ${TX_HASH:-transaction sent}"
    exit 0
  fi

  sleep 2
done
