#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"

INTERVAL_SEC="${MICRO_LANE_INTERVAL_SEC:-60}"
BUDGET_MS="${MICRO_LANE_BUDGET_MS:-170000}"

echo "[micro-lane-swarm] start interval=${INTERVAL_SEC}s budget_ms=${BUDGET_MS}"

required_files=(
  "dist-micro/orchestrator/micio_scheduler.js"
  "dist-micro/orchestrator/zio_guard_worker.js"
  "dist-micro/orchestrator/aiometrics_worker.js"
  "dist-micro/orchestrator/micro_sync_drive_changes.js"
  "dist-micro/orchestrator/micro_sheet_delete_archive_sync.js"
  "dist-micro/orchestrator/micro_enrich_buchhaltung_db.js"
  "dist-micro/orchestrator/micro_tax_category_assign.js"
  "dist-micro/orchestrator/micro_konto_assign.js"
  "dist-micro/orchestrator/micro_plausibility_duplicate.js"
  "dist-micro/orchestrator/micro_sheet_formula_guard.js"
  "dist-micro/orchestrator/micro_ocr_audit_1nm.js"
  "dist-micro/orchestrator/micro_clean_private_1nm.js"
  "dist-micro/orchestrator/micro_local_118_tesseract_filter.js"
  "dist-micro/orchestrator/check_2023_integrity.js"
  "dist-micro/orchestrator/audit_2023_strict.js"
)

missing=0
for f in "${required_files[@]}"; do
  if [ ! -f "${f}" ]; then
    missing=1
    break
  fi
done

if [ "${missing}" -eq 1 ]; then
  npm run -s build
fi

mkdir -p logs

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
