# Context Fulltext

- source_path: start_ocr_swarm.sh
- source_sha256: 085f4465da820079a1db1196e9cf971960297e09779f08f2577e79abd5181ed5
- chunk: 1/1

```text
#!/bin/bash
set -uo pipefail

WORKERS="${OCR_SWARM_WORKERS:-2}"
ROUNDS="${OCR_SWARM_ROUNDS:-24}"
SLEEP_SECS="${OCR_SWARM_SLEEP_SECS:-1}"
export WORKER_BATCH_SIZE="${WORKER_BATCH_SIZE:-2}"
export NVIDIA_QWEN_TIMEOUT_MS="${NVIDIA_QWEN_TIMEOUT_MS:-180000}"
export NVIDIA_QWEN_MAX_TOKENS="${NVIDIA_QWEN_MAX_TOKENS: [REDACTED]
export NVIDIA_QWEN_MAX_IMAGE_BYTES="${NVIDIA_QWEN_MAX_IMAGE_BYTES:-3000000}"
export NVIDIA_QWEN_MAX_IMAGE_DIM="${NVIDIA_QWEN_MAX_IMAGE_DIM:-1800}"
TSX_BIN="${TSX_BIN:-./node_modules/.bin/tsx}"
NODE_BIN="${NODE_BIN:-}"
if [[ -z "${NODE_BIN}" && -x "/Users/jeremy/.nvm/versions/node/v22.15.0/bin/node" ]]; then
  NODE_BIN="/Users/jeremy/.nvm/versions/node/v22.15.0/bin/node"
fi
if [[ -z "${NODE_BIN}" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
TSX_JS="${TSX_JS:-./node_modules/tsx/dist/cli.mjs}"
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "ERROR: node binary not found."
  exit 1
fi
if [[ ! -f "${TSX_JS}" ]]; then
  echo "ERROR: tsx cli not found at ${TSX_JS}."
  exit 1
fi

run_tsx() {
  "${NODE_BIN}" "${TSX_JS}" "$@"
}

echo "Starting OCR swarm (micro-batches): workers=${WORKERS}, rounds=${ROUNDS}, worker_batch=${WORKER_BATCH_SIZE}"

for ((i=1; i<=ROUNDS; i++)); do
  echo "--- Round ${i}/${ROUNDS} ---"
  for ((w=1; w<=WORKERS; w++)); do
    run_tsx src/orchestrator/gemini_ocr_worker.ts &
  done
  wait || true
  run_tsx check_ocr_coverage.ts || true
  echo "Round ${i} complete. Sleep ${SLEEP_SECS}s"
  sleep "${SLEEP_SECS}"
done

echo "OCR swarm finished."

```
