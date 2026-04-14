# Context Fulltext

- source_path: repair_all_years.sh
- source_sha256: 5e2169068aeff5ca1cb77b18354bb86c954faae8fd125b65e2b631e9d6165591
- chunk: 1/1

```text
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

YEARS="${YEARS:-2022 2023 2024 2025 2026}"

for y in $YEARS; do
  echo ""
  echo "=== Repair year $y ==="
  (cd "$ROOT_DIR" && REPAIR_YEAR="$y" npm run repair-2023)
done

echo ""
echo "All yearly repairs done: $YEARS"

```
