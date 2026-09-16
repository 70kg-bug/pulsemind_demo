#!/bin/sh
# Expose the replay through a Cloudflare quick tunnel: https, no account. Prints the URL.
#   ./tunnel.sh [port]
# The URL changes every time this runs. Quick tunnels allow 200 requests in flight and no SSE;
# the replay needs neither.
cd "$(dirname "$0")" || exit 1
PORT="${1:-8750}"
BIN=./cloudflared
[ -x "$BIN" ] || BIN="$(command -v cloudflared)"
if [ -z "$BIN" ]; then
  echo "cloudflared not found. Fetch the single binary into this directory:"
  echo "  curl -fsSL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared"
  exit 1
fi
if [ -f tunnel.pid ] && kill -0 "$(cat tunnel.pid)" 2>/dev/null; then
  echo "tunnel already running, pid $(cat tunnel.pid)"
else
  : > tunnel.log
  setsid nohup "$BIN" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >> tunnel.log 2>&1 < /dev/null &
  echo $! > tunnel.pid
fi
URL=""
for _ in $(seq 1 40); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | tail -1)
  [ -n "$URL" ] && break
  sleep 1
done
echo "${URL:-no URL yet, see tunnel.log}"
