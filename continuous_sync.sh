#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/continuous_sync.log"
PID_FILE="$ROOT_DIR/.continuous_sync.pid"

mkdir -p "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "continuous_sync already running with PID $old_pid"
    exit 0
  fi
fi

echo "$$" > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

BATCH_SIZE="${BATCH_SIZE:-50}"
SLEEP_SECONDS="${SLEEP_SECONDS:-300}"
OCR_MIN_TEXT_LENGTH="${OCR_MIN_TEXT_LENGTH:-20}"
APPLY_MOVE_RULES="${APPLY_MOVE_RULES:-false}"
RENAME_FILES="${RENAME_FILES:-false}"

while true; do
  {
    echo ""
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') ====="
    echo "[1/1] npm run sync-chain"
  } >> "$LOG_FILE"

  if ! (
    cd "$ROOT_DIR" &&
    PIPELINE_SYNC_ONLY=1 \
    BATCH_SIZE="$BATCH_SIZE" \
    OCR_MIN_TEXT_LENGTH="$OCR_MIN_TEXT_LENGTH" \
    APPLY_MOVE_RULES="$APPLY_MOVE_RULES" \
    RENAME_FILES="$RENAME_FILES" \
    npm run sync-chain >> "$LOG_FILE" 2>&1
  ); then
    echo "Pipeline step failed, continuing..." >> "$LOG_FILE"
  fi

  echo "Sleeping ${SLEEP_SECONDS}s..." >> "$LOG_FILE"
  sleep "$SLEEP_SECONDS"
done
