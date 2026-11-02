#!/usr/bin/env bash
# Hosts the Turboball beta from this laptop and prints a public link for friends.
#
#   ./host-beta.sh            build, start the game server on :8081, open a public tunnel
#   PORT=9000 ./host-beta.sh  use another port
#
# The free tunnel (Pinggy) drops about once an hour. This script reconnects on its own and
# prints the NEW link each time, so watch the terminal and re-share it when it changes.
# Press Ctrl+C to stop everything.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8081}"

echo "Building..."
npm run build --workspace shared >/dev/null
npm run build --workspace client >/dev/null

PORT="$PORT" STATIC_DIR="$PWD/client/dist" npm run start --workspace server &
SERVER_PID=$!
cleanup() {
  trap - EXIT INT TERM
  kill "$SERVER_PID" 2>/dev/null || true
  pkill -P $$ 2>/dev/null || true
}
trap cleanup EXIT INT TERM

until curl -fs -o /dev/null "http://localhost:$PORT/health"; do
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "Server failed to start (is port $PORT already in use?)"; exit 1; }
  sleep 1
done
echo "Game server is running on http://localhost:$PORT"

while true; do
  ssh -p 443 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -R0:localhost:"$PORT" a.pinggy.io 2>&1 \
    | grep --line-buffered -oE 'https://[a-z0-9-]+\.free\.pinggy\.net' \
    | awk '!seen[$0]++ { print "\n  SHARE THIS LINK: " $0 "\n"; fflush() }' || true
  echo "Tunnel dropped. Reconnecting in 3 seconds (the link will change)..."
  sleep 3
done
