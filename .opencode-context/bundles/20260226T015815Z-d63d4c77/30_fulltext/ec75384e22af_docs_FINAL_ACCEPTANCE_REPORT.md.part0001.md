# Context Fulltext

- source_path: docs/FINAL_ACCEPTANCE_REPORT.md
- source_sha256: 34d86705a36623b995a4a47a3d2ae5034d6229b9348a0d7881c8912f797dced4
- chunk: 1/5

```text
# Final Acceptance Report

- Timestamp: 2026-02-26T01:58:02.256Z
- Run ID: 51d1cdbb-f7d2-4c4e-b507-2e073ea45649
- Scope years: 2000, 2004, 2016, 2022, 2023, 2024, 2025, 2026
- Done (all gates green): YES

## KPI Summary

- records_before: 1828
- records_after: 1828
- driveOnly_total: 0
- sheetOnly_total: 0
- duplicate_drive_file_id_total: 0
- forbidden_marker_hits: 0
- qa_accuracy_critical: 100.00% (80/80)
- critical_qa_issues: 0
- idempotency_pass: true
- dashboard_formula_drift_count: 0
- dashboard_value_drift_count: 0
- bidirectional_drift_incidents: 0
- contract_gate_A: true
- contract_gate_B: true
- contract_gate_C: true

## Hard Fail Reasons


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

- build: OK (267651ms)
- start_sync#1: OK (241121ms)
- soft_audit#1: OK (148794ms)
- integrity_check#1: OK (133092ms)
- mismatch_resolve#1: OK (119594ms)
- quality_check#1: OK (98512ms)
- contract_sync_guard#1: OK (39013ms)
- governance_check#1: OK (3582ms)
- idempotency_check#1: OK (155915ms)

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
  "timestamp": "2026-02-26T01:58:02.256Z",
  "runId": "51d1cdbb-f7d2-4c4e-b507-2e073ea45649",
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
      "startedAt": "2026-02-26T01:37:54.978Z",
      "finishedAt": "2026-02-26T01:42:22.629Z",
      "durationMs": 267651
    },
    {
      "stage": "start_sync#1",
      "ok": true,
      "startedAt": "2026-02-26T01:42:22.629Z",
      "finishedAt": "2026-02-26T01:46:23.747Z",
      "durationMs": 241121
    },
    {
      "stage": "soft_audit#1",
      "ok": true,
      "startedAt": "2026-02-26T01:46:23.751Z",
      "finishedAt": "2026-02-26T01:48:52.545Z",
      "durationMs": 148794
    },
    {
      "stage": "integrity_check#1",
      "ok": true,
      "startedAt": "2026-02-26T01:48:52.545Z",
      "finishedAt": "2026-02-26T01:51:05.637Z",
      "durationMs": 133092
    },
    {
      "stage": "mismatch_resolve#1",
      "ok": true,
      "startedAt": "2026-02-26T01:51:05.637Z",
      "finishedAt": "2026-02-26T01:53:05.231Z",
      "durationMs": 119594
    },
    {
      "stage": "quality_check#1",
      "ok": true,
      "startedAt": "2026-02-26T01:53:05.231Z",
      "finishedAt": "2026-02-26T01:54:43.743Z",
      "durationMs": 98512
    },
    {
      "stage": "contract_sync_guard#1",
      "ok": true,
      "startedAt": "2026-02-26T01:54:43.743Z",
      "finishedAt": "2026-02-26T01:55:22.756Z",
      "durationMs": 39013
    },
    {
      "stage": "governance_check#1",
      "ok": true,
      "startedAt": "2026-02-26T01:55:22.756Z",
      "finishedAt": "2026-02-26T01:55:26.338Z",
      "durationMs": 3582
    },
    {
      "stage": "idempotency_check#1",
      "ok": true,
      "startedAt": "2026-02-26T01:55:26.338Z",
      "finishedAt": "2026-02-26T01:58:02.252Z",
      "durationMs": 155915
    }
  ],
  "baseline": {
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
    "idempotencyPass": true,
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
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2016",
      "drive
```
