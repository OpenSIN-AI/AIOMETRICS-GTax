# Context Fulltext

- source_path: docs/FINAL_ACCEPTANCE_REPORT.json
- source_sha256: 885bafcab2010ba45eb496757f156e391b5e4eaf308e1600cb881cd527f875d4
- chunk: 1/4

```text
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
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2016",
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2022",
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2023",
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2024",
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2025",
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    },
    {
      "year": "2026",
      "driveOnly": 0,
      "sheetOnly": 0,
      "duplicateDriveIds": 0,
      "pass": true
    }
  ],
  "governanceFindings": [],
  "contractSync": {
    "version": "2026.1",
    "timestamp": "2026-02-26T00:51:32.977Z",
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
    "gates": {
      "gateA": {
        "pass": true,
        "driveCount": 1828,
        "sheetCount": 1828,
        "driveOnly": 0,
        "sheetOnly": 0,
        "duplicateDriveIds": 0
      },
      "gateB": {
        "pass": true,
        "missingYears": [],
        "perYear": [
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
            "driveOnly": 0,
            "sheetOnly": 0,
            "duplicateDriveIds": 0,
            "pass": true
          },
          {
            "year": "2022",
            "driveOnly": 0,
            "sheetOnly": 0,
            "duplicateDriveIds": 0,
            "pass": true
          },
          {
            "year": "2023",
            "driveOnly": 0,
            "sheetOnly": 0,
            "duplicateDriveIds": 0,
            "pass": true
          },
          {
            "year": "2024",
            "driveOnly": 0,
            "sheetOnly": 0,
            "duplicateDriveIds": 0,
            "pass": true
          },
          {
            "year": "2025",
            "driveOnly": 0,
            "sheetOnly": 0,
            "duplicateDriveIds": 0,
            "pass": true
          },
          {
            "year": "2026",
            "driveOnly": 0,
            "sheetOnly": 0,
            "duplicateDriveIds": 0,
            "pass": true
          }
        ],
        "totalDriveOnly": 0,
        "totalSheetOnly": 0,
        "totalDuplicateDriveIds": 0
      },
      "gateC": {
        "pass": true,
        "formulaDriftCount": 0,
        "valueDriftCount": 0,
        "formulaChecks": [
          {
            "tab": "EÜR",
            "cell": "B2",
            "expectedFormula": "=IFERROR('Finanz-Cockpit'!B2;YEAR(TODAY()))",
            "actualFormula": "=IFERROR('Finanz-Cockpit'!B2;YEAR(TODAY()))",
            "pass": true
          },
          {
            "tab": "EÜR",
            "cell": "B5",
            "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!M2:M>0));0)",
            "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!M2:M>0));0)",
            "pass": true
          },
          {
            "tab": "EÜR",
            "cell": "B6",
            "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!N2:N>0));0)",
            "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!N2:N>0));0)",
            "pass": true
          },
          {
            "tab": "EÜR",
            "cell": "B7",
            "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!O2:O>0));0)",
            "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!O2:O>0));0)",
            "pass": true
          },
          {
            "tab": "EÜR",
            "cell": "B8",
            "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B5:B7);0)",
            "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B5:B7);0)",
            "pass": true
          },
          {
            "tab": "EÜR",
            "cell": "B9",
            "expectedFormula": "=SUM(B5:B8)",
            "actualFormula": "=SUM(B5:B8)",
            "pass": true
          },
          {
            "tab": "EÜR",
            "cell": "B12",
            "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)material|pv\")));0)",
            "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)material|pv\")));0)",
            "pass": true
          },
          {
            "tab": "EÜR",
            "cell": "B13",
            "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)kraftstoff|benzin|diesel\")));0)",
            "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR
```
