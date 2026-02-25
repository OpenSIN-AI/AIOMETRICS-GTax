#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"

INTERVAL_SEC="${MICRO_LANE_INTERVAL_SEC:-60}"
BUDGET_MS="${MICRO_LANE_BUDGET_MS:-170000}"

echo "[micro-lane-swarm] start interval=${INTERVAL_SEC}s budget_ms=${BUDGET_MS}"

if [ ! -f dist-micro/orchestrator/micio_scheduler.js ] || [ ! -f dist-micro/orchestrator/zio_guard_worker.js ] || [ ! -f dist-micro/orchestrator/aiometrics_worker.js ]; then
  npm run -s build
fi

while true; do
  echo "[micro-lane-swarm] tick $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  node dist-micro/orchestrator/zio_guard_worker.js || true

  MICIO_PROFILE=core MICIO_BUDGET_MS="${BUDGET_MS}" node dist-micro/orchestrator/micio_scheduler.js > logs/micio_core_node.log 2>&1 &
  PID_CORE=$!
  MICIO_PROFILE=ocr MICIO_BUDGET_MS="${BUDGET_MS}" node dist-micro/orchestrator/micio_scheduler.js > logs/micio_ocr_node.log 2>&1 &
  PID_OCR=$!
  MICIO_PROFILE=qa MICIO_BUDGET_MS="${BUDGET_MS}" node dist-micro/orchestrator/micio_scheduler.js > logs/micio_qa_node.log 2>&1 &
  PID_QA=$!

  wait "${PID_CORE}" || true
  wait "${PID_OCR}" || true
  wait "${PID_QA}" || true

  node dist-micro/orchestrator/aiometrics_worker.js || true
  sleep "${INTERVAL_SEC}"
done
