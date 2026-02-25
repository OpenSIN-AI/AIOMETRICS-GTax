#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SEC="${MICIO_INTERVAL_SEC:-60}"
PROFILE="${MICIO_PROFILE:-core}"

echo "[micio-loop] start profile=${PROFILE} interval=${INTERVAL_SEC}s"

required_files=(
  "dist-micro/orchestrator/micio_scheduler.js"
  "dist-micro/orchestrator/zio_guard_worker.js"
  "dist-micro/orchestrator/aiometrics_worker.js"
)

case "${PROFILE}" in
  core)
    required_files+=(
      "dist-micro/orchestrator/micro_sync_drive_changes.js"
      "dist-micro/orchestrator/micro_enrich_buchhaltung_db.js"
      "dist-micro/orchestrator/micro_tax_category_assign.js"
      "dist-micro/orchestrator/micro_konto_assign.js"
      "dist-micro/orchestrator/micro_sheet_formula_guard.js"
    )
    ;;
  ocr)
    required_files+=(
      "dist-micro/orchestrator/micro_ocr_audit_1nm.js"
      "dist-micro/orchestrator/micro_local_118_tesseract_filter.js"
    )
    ;;
  qa)
    required_files+=(
      "dist-micro/orchestrator/check_2023_integrity.js"
      "dist-micro/orchestrator/audit_2023_strict.js"
    )
    ;;
  *)
    echo "[micio-loop] invalid MICIO_PROFILE=${PROFILE} (allowed: core|ocr|qa)"
    exit 2
    ;;
esac

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

while true; do
  echo "[micio-loop] tick $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  node dist-micro/orchestrator/zio_guard_worker.js || true
  MICIO_PROFILE="${PROFILE}" node dist-micro/orchestrator/micio_scheduler.js || true
  node dist-micro/orchestrator/aiometrics_worker.js || true
  sleep "${INTERVAL_SEC}"
done
