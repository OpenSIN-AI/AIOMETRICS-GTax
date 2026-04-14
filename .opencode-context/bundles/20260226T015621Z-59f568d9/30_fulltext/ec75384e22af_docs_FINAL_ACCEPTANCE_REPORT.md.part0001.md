# Context Fulltext

- source_path: docs/FINAL_ACCEPTANCE_REPORT.md
- source_sha256: 6ecc3f761773c440209ca932b6eec52cd0952c6d832a1d716b12526dec2da2ab
- chunk: 1/5

```text
# Final Acceptance Report

- Timestamp: 2026-02-26T00:59:05.840Z
- Run ID: e9ca1ecb-585c-4015-9c5b-d6e3d87b2082
- Scope years: 2000, 2004, 2016, 2022, 2023, 2024, 2025, 2026
- Done (all gates green): NO

## KPI Summary

- records_before: 1828
- records_after: 1828
- driveOnly_total: 0
- sheetOnly_total: 0
- duplicate_drive_file_id_total: 0
- forbidden_marker_hits: 0
- qa_accuracy_critical: 100.00% (80/80)
- critical_qa_issues: 0
- idempotency_pass: false
- dashboard_formula_drift_count: 0
- dashboard_value_drift_count: 0
- bidirectional_drift_incidents: 0
- contract_gate_A: true
- contract_gate_B: true
- contract_gate_C: true

## Hard Fail Reasons

- STAGE_FAILED:idempotency_check#1
- IDEMPOTENCY_FAILED

## Yearly Gate Status

- 2000: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0
- 2004: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0
- 2016: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0
- 2022: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0
- 2023: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0
- 2024: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0
- 2025: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0
- 2026: pass=true driveOnly=0 sheetOnly=0 duplicateDriveIds=0

## Governance Findings (Top 50)


## Stage Results

- build: OK (194311ms)
- start_sync#1: OK (207396ms)
- soft_audit#1: OK (148412ms)
- integrity_check#1: OK (41303ms)
- mismatch_resolve#1: OK (96238ms)
- quality_check#1: OK (113757ms)
- contract_sync_guard#1: OK (109004ms)
- governance_check#1: OK (3974ms)
- idempotency_check#1: FAIL (448719ms)

## QA Issues (Top 50)

- MEDIUM | 1toCRELAsvvRLmjTwWqZHoALN9yQ7aEoK | 2000 | Sonstiges | weak_text_extraction, missing_amount_pattern
- MEDIUM | 1X2t4_OqAOfi7PJk-olbJozyD8ihOxFqO | 2022 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1dIrxIKmh7ulb0TKC-hPr431Jmh-N-zIm | 2023 | Sonstiges | weak_text_extraction, missing_amount_pattern
- MEDIUM | 1vDG9ecAM_rzCHLER5Hyd-BwYx6WS0vOb | 2025 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 11yKeHBkFGme_cHKRjbGPDdorloqwHfCh | 2025 | Sonstiges | weak_text_extraction, missing_metadata, missing_amount_pattern
- HIGH | 1k-eEfIZFZMXRV9gxrv5Ur26cue7Okwd3 | 2026 | Sonstiges | missing_metadata
- MEDIUM | 1Fy8iDcOH5w90NsZVA6WdrjW1OTZhh2Fy | 2026 | Vertraege | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1e09ZeYJ5IXn8tamnwonWFxzJSeqNI4Yo | 2023 | Sonstiges | weak_text_extraction, missing_amount_pattern
- MEDIUM | 1fn7hr3lNXXP_dulTu7akES2J1iWFkP84 | 2025 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1Sl-MPbqUG6RNfGBj2pE6peOGF0huThXY | 2025 | Sonstiges | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1wf9AKbaOzUt3WzpLiQoLYaPhsTzLQbxx | 2023 | Rechnungen | invalid_amount_pattern
- MEDIUM | 1ihbpI1kb9vZrD8GshMVqPhy3Es-DFdlb | 2023 | Sonstiges | weak_text_extraction, missing_amount_pattern
- MEDIUM | 1EYNaFTV7L-2gL7FECu4SNdPNjl6TZCxh | 2025 | Sonstiges | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1AC9gTcSl73Kl82L2ftCDdPcCbzOU0Myb | 2023 | Rechnungen | invalid_amount_pattern
- MEDIUM | 1-lM5l0aYQ8-PeXEepzVDrII9dnjPruBl | 2023 | Sonstiges | weak_text_extraction, missing_amount_pattern
- MEDIUM | 1NtL1j8nn_lxcPhpsF3nClXDR4-ENVDfC | 2025 | Sonstiges | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1Sm73OznokeIqZfUYktcBTBUaesjNxjm0 | 2026 | Sonstiges | missing_amount_pattern
- MEDIUM | 1R4pM1ui6GHth5gjYBehKhfWW6-fGfk3E | 2025 | Sonstiges | missing_amount_pattern
- HIGH | 1YhfEsUeMbjuzmfAhaem9EDKK3WPkkJGM | 2023 | Sonstiges | missing_metadata
- MEDIUM | 19cNIuJ02kWp1L7uDgKmBSHPUMeAFfSAu | 2026 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- HIGH | 1BdMtBd_Gu3l_xU491z1s8tQv09YVeWtM | 2023 | Sonstiges | missing_metadata
- MEDIUM | 1JDfCgF_G2vfp9_gW2cuW-wmyQ-81ItUy | 2025 | Sonstiges | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1j7ztz3ZKYn16z4o8IUwuVouqzUP4JaCE | 2026 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- HIGH | 1n1HxIaJRvU-sWWdqF3mjnAFHpqFJPBu9 | 2023 | Sonstiges | missing_metadata
- MEDIUM | 1IeQrMNQS0TYAYllZvSlHOWz2_fyukJ1f | 2025 | Sonstiges | missing_amount_pattern
- MEDIUM | 1hF20dThc3a8KlvjenQL4rDEn1Iaoz_yE | 2026 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- HIGH | 18ws1ndidR-paQVgYvB8dKvdOVnjASQ4q | 2023 | Sonstiges | missing_metadata
- MEDIUM | 1zo-76SoIxnF7c5L5KltRpXekwF9JW2wB | 2025 | Sonstiges | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 139jRvMViJBaiALgsTUwk-EfAwtkprqrn | 2026 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1es2NIM1NGlUiFu8LSsDibfAo08sq3NJ- | 2026 | Sonstiges | missing_amount_pattern
- MEDIUM | 1zShOzsvLRLMWQMHxZ5JwGcIgZiuvlegC | 2023 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 10JO_PFPsKq9lqOxrhuyEbxaLdHTL0Rd8 | 2024 | Sonstiges | missing_metadata, missing_amount_pattern
- MEDIUM | 12AS8ChFBMSbSrcac01g9qZP8ShrZQcS5 | 2026 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1-1qBGDdz8A9NCJ5zMScko-6g5SxboHwf | 2026 | Sonstiges | missing_amount_pattern
- MEDIUM | 1MDP334pHdfoOvhChrb2aSsTZt5XhedXh | 2026 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1c-RIQZpkTGFjkgyzgB-KLEjh6CRovvWw | 2026 | Sonstiges | weak_text_extraction, missing_amount_pattern
- MEDIUM | 1Chlrls0ADa1UxTvCSDd8eZw7AXNadW8x | 2023 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- HIGH | 1nTCcXoyjUparwOd2rW_m-5ZDbbmwmw2h | 2023 | Sonstiges | missing_metadata
- MEDIUM | 1p7kZxRZdACeVQXjA4GzPgFhvMfkgiSN_ | 2026 | Rechnungen | weak_text_extraction, missing_metadata, missing_amount_pattern
- MEDIUM | 1C8AWbGuJ8wiq3dYzvamFKE1KlYzk1PQh | 2026 | Sonstiges | weak_text_extraction, missing_amount_pattern
- HIGH | 1ac15t5y7ak1wpAfL-9QkXGY6qu37_z-M | 2023 | Sonstiges | missing_metadata
- MEDIUM | 1D7dw_kQCqOBcJT7IbvdYE9RF3xbnzaTw | 2025 | Sonstiges | weak_text_extraction, missing_metadata, missing_amount_pattern

## JSON Appendix

```json
{
  "timestamp": "2026-02-26T00:59:05.840Z",
  "runId": "e9ca1ecb-585c-4015-9c5b-d6e3d87b2082",
  "scopeYears": [
    "2000",
    "2004",
    "2016",
    "2022",
    "2023",
    "2024",
    "2025",
    "2026"
  ],
  "years": [
    "2000",
    "2004",
    "2016",
    "2022",
    "2023",
    "2024",
    "2025",
    "2026"
  ],
  "stages": [
    {
      "stage": "build",
      "ok": true,
      "startedAt": "2026-02-26T00:36:22.691Z",
      "finishedAt": "2026-02-26T00:39:37.002Z",
      "durationMs": 194311
    },
    {
      "stage": "start_sync#1",
      "ok": true,
      "startedAt": "2026-02-26T00:39:37.002Z",
      "finishedAt": "2026-02-26T00:43:04.398Z",
      "durationMs": 207396
    },
    {
      "stage": "soft_audit#1",
      "ok": true,
      "startedAt": "2026-02-26T00:43:04.398Z",
      "finishedAt": "2026-02-26T00:45:32.808Z",
      "durationMs": 148412
    },
    {
      "stage": "integrity_check#1",
      "ok": true,
      "startedAt": "2026-02-26T00:45:32.812Z",
      "finishedAt": "2026-02-26T00:46:14.115Z",
      "durationMs": 41303
    },
    {
      "stage": "mismatch_resolve#1",
      "ok": true,
      "startedAt": "2026-02-26T00:46:14.115Z",
      "finishedAt": "2026-02-26T00:47:50.353Z",
      "durationMs": 96238
    },
    {
      "stage": "quality_check#1",
      "ok": true,
      "startedAt": "2026-02-26T00:47:50.353Z",
      "finishedAt": "2026-02-26T00:49:44.110Z",
      "durationMs": 113757
    },
    {
      "stage": "contract_sync_guard#1",
      "ok": true,
      "startedAt": "2026-02-26T00:49:44.110Z",
      "finishedAt": "2026-02-26T00:51:33.114Z",
      "durationMs": 109004
    },
    {
      "stage": "governance_check#1",
      "ok": true,
      "startedAt": "2026-02-26T00:51:33.114Z",
      "finishedAt": "2026-02-26T00:51:37.088Z",
      "durationMs": 3974
    },
    {
      "stage": "idempotency_check#1",
      "ok": false,
      "startedAt": "2026-02-26T00:51:37.088Z",
      "finishedAt": "2026-02-26T00:59:05.807Z",
      "durationMs": 448719,
      "error": "getAuditMutationsByRunId.read: timeout after 30000ms"
    }
  ],
  "baseline": {
    "records": 1828,
    "categories": {
      "Sonstiges": 1643,
      "Rechnungen": 184,
      "Vertraege": 1
    },
    "tabs": [
      "Archiv",
      "Audit_Tabellen",
      "Audit_Tabellen_Legacy_20260225024542",
      "Ausgaben_2000",
      "Ausgaben_2004",
      "Ausgaben_2016",
      "Ausgaben_2022",
      "Ausgaben_2023",
      "Ausgaben_2024",
      "Ausgaben_2025",
      "Ausgaben_2026",
      "Buchhaltung_DB",
      "Dashboard_Daten",
      "Eigenbeleg",
      "Eigenbelege",
      "Einnahmen_2000",
      "Einnahmen_2004",
      "Einnahmen_2016",
      "Einnahmen_2022",
      "Einnahmen_2023",
      "Einnahmen_2024",
      "Einnahmen_2025",
      "Einnahmen_2026",
      "EÜR",
      "Fehlende Belege",
      "Finanz-Cockpit",
      "Harte Duplikatpruefung",
      "Ordner_2022",
      "Ordner_2023",
      "Ordner_2024",
      "Ordner_2025",
      "Ordner_2026",
      "Ordner_Archiviert",
      "Ordner_Duplikate",
      "Ordner_Fehlende Rechnungen",
      "Ordner_Fehler",
      "Ordner_Neue Belege ",
      "Ordner_Privat Belege",
      "Ordner_Sonstige_Belege",
      "Plausibilitaet",
      "Plausibilitaet_Micro",
      "QA_2023_Corrections",
      "QA_2023_Manual",
      "QA_2023_Queue",
      "QA_CRITICAL_OPEN",
      "QA_Corrections_Global",
      "QA_Manual_Review",
      "QA_Queue_Global",
      "Steuerreport",
      "Weiche Duplikatpruefung",
      "belege",
      "category_folders",
      "processing_log",
      "sync_state"
    ],
    "forbiddenMarkerHits": 0
  },
  "after": {
    "records": 1828,
    "categories": {
      "Rechnungen": 184,
      "Sonstiges": 1643,
      "Vertraege": 1
    },
    "tabs": [
      "Archiv",
      "Audit_Tabellen",
      "Audit_Tabellen_Legacy_20260225024542",
      "Ausgaben_2000",
      "Ausgaben_2004",
      "Ausgaben_2016",
      "Ausgaben_2022",
      "Ausgaben_2023",
      "Ausgaben_2024",
      "Ausgaben_2025",
      "Ausgaben_2026",
      "Buchhaltung_DB",
      "Dashboard_Daten",
      "Eigenbeleg",
      "Eigenbelege",
      "Einnahmen_2000",
      "Einnahmen_2004",
      "Einnahmen_2016",
      "Einnahmen_2022",
      "Einnahmen_2023",
      "Einnahmen_2024",
      "Einnahmen_2025",
      "Einnahmen_2026",
      "EÜR",
      "Fehlende Belege",
      "Finanz-Cockpit",
      "Harte Duplikatpruefung",
      "Ordner_2022",
      "Ordner_2023",
      "Ordner_2024",
      "Ordner_2025",
      "Ordner_2026",
      "Ordner_Archiviert",
      "Ordner_Duplikate",
      "Ordner_Fehlende Rechnungen",
      "Ordner_Fehler",
      "Ordner_Neue Belege ",
      "Ordner_Privat Belege",
      "Ordner_Sonstige_Belege",
      "Plausibilitaet",
      "Plausibilitaet_Micro",
      "QA_2023_Corrections",
      "QA_2023_Manual",
      "QA_2023_Queue",
      "QA_CRITICAL_OPEN",
      "QA_Corrections_Global",
      "QA_Manual_Review",
      "QA_Queue_Global",
      "Steuerreport",
      "Weiche Duplikatpruefung",
      "belege",
      "category_folders",
      "processing_log",
      "sync_state"
    ],
    "forbiddenMarkerHits": 0
  },
  "kpis": {
    "totalDriveOnly": 0,
    "totalSheetOnly": 0,
    "totalDuplicateIds": 0,
    "forbiddenMarkerHits": 0,
    "qaSampleSize": 80,
    "qaSampleCriticalPassed": 80,
    "qaAccuracy": 1,
    "criticalQaIssues": 0,
    "idempotencyPass": false,
    "dashboardFormulaDriftCount": 0,
    "dashboardValueDriftCount": 0,
    "bidirectionalDriftIncidents": 0
  },
  "yearlyGateStatus": [
    {
      "year": "2000",
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2004",
      "dr
```
