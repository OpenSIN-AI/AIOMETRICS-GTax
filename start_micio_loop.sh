#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SEC="${MICIO_INTERVAL_SEC:-60}"
PROFILE="${MICIO_PROFILE:-core}"

echo "[micio-loop] start profile=${PROFILE} interval=${INTERVAL_SEC}s"

if [ ! -f dist-micro/orchestrator/micio_scheduler.js ] || [ ! -f dist-micro/orchestrator/zio_guard_worker.js ] || [ ! -f dist-micro/orchestrator/aiometrics_worker.js ]; then
  npm run -s build
fi

while true; do
  echo "[micio-loop] tick $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  node dist-micro/orchestrator/zio_guard_worker.js || true
  MICIO_PROFILE="${PROFILE}" node dist-micro/orchestrator/micio_scheduler.js || true
  node dist-micro/orchestrator/aiometrics_worker.js || true
  sleep "${INTERVAL_SEC}"
done
