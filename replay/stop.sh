#!/bin/sh
# Stop the tunnel, if any, and the replay. Sessions are flushed to sessions.json on the way out.
cd "$(dirname "$0")" || exit 1
for name in tunnel replay; do
  if [ -f "$name.pid" ] && kill -0 "$(cat "$name.pid")" 2>/dev/null; then
    kill "$(cat "$name.pid")"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$(cat "$name.pid")" 2>/dev/null || break
      sleep 1
    done
    echo "$name stopped"
  fi
  rm -f "$name.pid"
done
