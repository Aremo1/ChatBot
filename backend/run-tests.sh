#!/bin/bash
# Full backend test run: boots an isolated server on a temp SQLite
# database, runs the end-to-end suite, then tears everything down.
#
#   bash run-tests.sh
set -uo pipefail

PORT="${TEST_PORT:-4100}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-adminpass123}"
export LOCAL_DB_PATH="${LOCAL_DB_PATH:-./test_server.db}"
export PORT

cd "$(dirname "$0")"

rm -f "$LOCAL_DB_PATH" "$LOCAL_DB_PATH"-wal "$LOCAL_DB_PATH"-shm 2>/dev/null

echo "Starting test server on port $PORT ..."
node src/index.js > /tmp/chatbot-test-server.log 2>&1 &
SERVER_PID=$!

cleanup() {
  # Prefer killing whichever process holds the port (Windows/bash PID
  # mapping is not always identical), then the recorded child.
  local pid
  pid=$(netstat -ano 2>/dev/null | grep -i ":$PORT .*LISTENING" | head -1 | awk '{print $NF}')
  if [ -n "${pid:-}" ] && command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$pid" //F >/dev/null 2>&1
  fi
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT

# Wait for readiness
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
  echo "Server failed to start. Log:"
  cat /tmp/chatbot-test-server.log
  exit 1
fi

node test-api.js "http://localhost:$PORT"
STATUS=$?

if [ $STATUS -eq 0 ]; then
  echo "All backend tests passed."
else
  echo "Backend tests failed (exit $STATUS). Server log:"
  tail -n 40 /tmp/chatbot-test-server.log
fi
exit $STATUS
