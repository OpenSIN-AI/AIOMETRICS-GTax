# Context Fulltext

- source_path: docs/CONTRACT_SYNC_GUARD.md
- source_sha256: 94c1c5dde2c7c6157dbb7f7c2932172b9bf891d083352a14f3e3faa5e4f6d9aa
- chunk: 1/1

```text
# Contract Sync Guard

- Timestamp: 2026-02-26T00:06:27.342Z
- Scope years: 2022, 2023, 2024, 2025, 2026
- Status: red
- Gate A pass: true
- Gate B pass: false
- Gate C pass: true

## Gate A

- driveCount: 1828
- sheetCount: 1828
- driveOnly: 0
- sheetOnly: 0
- duplicateDriveIds: 0

## Gate B

- totalDriveOnly: 746
- totalSheetOnly: 1286
- totalDuplicateDriveIds: 0
- missingYears: -

| year | pass | driveOnly | sheetOnly | duplicateDriveIds |
|---|---|---:|---:|---:|
| 2022 | false | 5 | 0 | 0 |
| 2023 | false | 693 | 183 | 0 |
| 2024 | false | 7 | 10 | 0 |
| 2025 | false | 21 | 60 | 0 |
| 2026 | false | 20 | 1033 | 0 |

## Gate C

- formulaDriftCount: 0
- valueDriftCount: 0

| kind | label | pass | expected | actual |
|---|---|---|---|---|

## Violations

- [B] YEARLY_TAB_DRIFT: Yearly tabs are not in strict sync with Drive
  detail: driveOnly=746, sheetOnly=1286, duplicateDriveIds=0, missingYears=-

```
