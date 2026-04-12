#!/bin/bash
# Ensure both dev servers are running. Starts npm run dev if either port is down.

BACKEND_PORT=3003
FRONTEND_PORT=5173
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

backend_up() { lsof -ti:$BACKEND_PORT >/dev/null 2>&1; }
frontend_up() { lsof -ti:$FRONTEND_PORT >/dev/null 2>&1; }

if backend_up && frontend_up; then
  echo '{"additional_context": "Dev servers already running (ports 3003 + 5173)."}'
  exit 0
fi

# Kill any partial processes so concurrently starts clean
lsof -ti:$BACKEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:$FRONTEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Start both via the root npm script (tsx watch + vite)
cd "$PROJECT_DIR"
nohup npm run dev > /tmp/gate_dev.log 2>&1 &

# Wait up to 15s for both ports to come up
for i in $(seq 1 30); do
  sleep 0.5
  if backend_up && frontend_up; then
    echo '{"additional_context": "Dev servers started automatically (ports 3003 + 5173). Ready at http://localhost:5173"}'
    exit 0
  fi
done

echo '{"additional_context": "Dev servers may still be starting — check http://localhost:5173 in a moment."}'
exit 0
