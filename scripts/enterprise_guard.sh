#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[enterprise] build"
npm run -s build

echo "[enterprise] test"
npm run -s test

echo "[enterprise] lint"
npm run -s lint

echo "[enterprise] dependency audit"
npm audit --audit-level=high

if command -v trivy >/dev/null 2>&1; then
  echo "[enterprise] trivy scan"
  trivy fs --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
else
  echo "[enterprise] trivy not installed locally, skip (CI still enforces this gate)"
fi

echo "[enterprise] sbom"
npm sbom --sbom-format spdx --json > sbom.spdx.json
echo "[enterprise] wrote sbom.spdx.json"
