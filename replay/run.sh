#!/bin/sh
# Start the replay detached from this SSH session.   ./run.sh [port]   (HOST=0.0.0.0 to expose)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8750}"
HOST="${HOST:-127.0.0.1}"
if [ -f replay.pid ] && kill -0 "$(cat replay.pid)" 2>/dev/null; then
  echo "already running, pid $(cat replay.pid)"
  exit 0
fi
setsid nohup python3 -u server.py --host "$HOST" --port "$PORT" >> replay.log 2>&1 < /dev/null &
echo $! > replay.pid
sleep 2
if kill -0 "$(cat replay.pid)" 2>/dev/null; then
  echo "replay running on $HOST:$PORT, pid $(cat replay.pid), log replay.log"
else
  echo "replay failed to start:"
  tail -20 replay.log
  exit 1
fi
