# Context Fulltext

- source_path: docs/POST_CLOSURE_ASSURANCE_RUNBOOK.md
- source_sha256: 8bed04d2a1628c5d02ee760225fa9dfd048c939a3f00167a43b054b9739b4a9a
- chunk: 1/1

```text
# Post-Closure Assurance Runbook

## Purpose
This runbook keeps the `done=true` closure state stable and detects drift immediately.

## Scope
- Years: `2000, 2004, 2016, 2022, 2023, 2024, 2025, 2026`
- Productive tabs only
- Drive-to-Sheets identity and governance conformance

## Command
```bash
npm run post-closure-assurance
```

## What the runner does
1. Executes final acceptance (`build -> sync -> audit -> integrity -> mismatch_resolve -> quality -> governance -> idempotency`).
2. Validates final report contract keys.
3. Freezes/updates 7-day window state based on the last green acceptance run (`WINDOW_STATE.json`).
4. Enforces definition freeze across core reconcile/acceptance files (hash fingerprint).
5. Writes daily KPI artifacts.
6. Updates assurance history.
7. Writes weekly trend report from last 7 days.
8. Generates manual QA sample files:
- daily stratified sample (`25` rows by default)
- weekly deep sample (`100` rows by default)
9. Auto-creates manual review templates:
- `DAILY_REVIEW_<date>.json`
- `WEEKLY_REVIEW_<week>.json`
10. Computes `EXEC_SIGNOFF.json` decision (`approved|blocked`) from:
- 7-day window state
- technical gate status
- manual review completeness
- critical mismatch counts
11. Writes rolling final certification report (`FINAL_7D_CERTIFICATION_*`).
12. Emits incident artifacts on failed runs and blocker artifacts after 2 consecutive failed runs.
13. Writes alert file with status `OK` or `ALERT`.
14. Enforces monotonic clock semantics (`period_end >= period_start`) and emits `clockConsistencyOk`.

## Outputs
- `docs/assurance/ASSURANCE_ALERT.json`
- `docs/assurance/daily/DAILY_KPI_<YYYY-MM-DD>.json`
- `docs/assurance/daily/DAILY_KPI_<YYYY-MM-DD>.md`
- `docs/assurance/weekly/WEEKLY_TREND_<YYYY-Www>.json`
- `docs/assurance/weekly/WEEKLY_TREND_<YYYY-Www>.md`
- `docs/assurance/samples/DAILY_SAMPLE_<YYYY-MM-DD>.json`
- `docs/assurance/samples/WEEKLY_SAMPLE_<YYYY-Www>.json`
- `docs/assurance/daily/DAILY_REVIEW_<YYYY-MM-DD>.json`
- `docs/assurance/weekly/WEEKLY_REVIEW_<YYYY-Www>.json`
- `docs/assurance/WINDOW_STATE.json`
- `docs/assurance/EXEC_SIGNOFF.json`
- `docs/assurance/FINAL_7D_CERTIFICATION_<period>.md`
- `docs/assurance/FINAL_7D_CERTIFICATION_<period>.json`
- `docs/assurance/FINAL_7D_CERTIFICATION_LATEST.md`
- `docs/assurance/FINAL_7D_CERTIFICATION_LATEST.json`
- `docs/assurance/incidents/INCIDENT_<YYYY-MM-DD>_<runId>.json` (only on failure)
- `docs/assurance/incidents/BLOCKER_<YYYY-MM-DD>_<runId>.json` (only after >=2 consecutive failed runs)
- `docs/ASSURANCE_HISTORY.jsonl`

## Exit behavior
- Exit `0`: no operational alert condition.
- Exit `2`: operational alert condition and `ASSURANCE_EXIT_ON_ALERT != 0`.

## Stability window semantics
- Window start is fixed to the latest green acceptance run when the window is initialized.
- Runner timestamps are captured after acceptance and normalized so `period_end` never precedes `period_start`.
- `stabilityWindow.pass` is true only when the window status is `completed`.
- Completion requires all of the following:
- full time coverage of the configured window (default `7` days)
- zero failed runs in the window
- no definition/scope drift during the window
- `stabilityWindow.passWithoutCoverage` is informational only.
- If any failed run occurs in the window, status becomes `broken`.
- Alert escalation:
- `status=ALERT` if latest run is red OR window has failed runs OR definition/scope drift is detected.
- `status=ALERT` also if `clockConsistencyOk=false`.
- 2 consecutive red runs create `BLOCKER_*` artifacts.

## Environment knobs
- `ASSURANCE_SKIP_ACCEPTANCE=1` -> skip running final acceptance and only evaluate latest report.
- `ASSURANCE_DAILY_SAMPLE_SIZE=25`
- `ASSURANCE_WEEKLY_SAMPLE_SIZE=100`
- `ASSURANCE_EXIT_ON_ALERT=1`
- `ASSURANCE_CREATE_INCIDENT_BRANCH=1`
- `ASSURANCE_STABILITY_WINDOW_DAYS=7`
- `ASSURANCE_RESET_WINDOW=1` -> reinitialize the 7-day window from latest green run.
- `ASSURANCE_DEFAULT_REVIEWER_PRIMARY=UNASSIGNED_PRIMARY`
- `ASSURANCE_DEFAULT_REVIEWER_SECONDARY=UNASSIGNED_SECONDARY`
- `ACCEPTANCE_MAX_LOOPS=3`

```
