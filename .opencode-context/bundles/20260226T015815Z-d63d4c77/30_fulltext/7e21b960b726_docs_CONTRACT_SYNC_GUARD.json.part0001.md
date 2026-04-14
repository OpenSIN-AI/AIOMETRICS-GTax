# Context Fulltext

- source_path: docs/CONTRACT_SYNC_GUARD.json
- source_sha256: 1b2242214928c161540f10e060adb18193e0815dadbd5a61cb277e43ea327074
- chunk: 1/1

```text
{
  "version": "2026.1",
  "timestamp": "2026-02-26T01:55:22.666Z",
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
          "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)kraftstoff|benzin|diesel\")));0)",
          "pass": true
        },
        {
          "tab": "EÜR",
          "cell": "B14",
          "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)telekommunikation|it|hosting|domain\")));0)",
          "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)telekommunikation|it|hosting|domain\")));0)",
          "pass": true
        },
        {
          "tab": "EÜR",
          "cell": "B15",
          "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)versicherung\")));0)",
          "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;\"(?i)versicherung\")));0)",
          "pass": true
        },
        {
          "tab": "EÜR",
          "cell": "B16",
          "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B12:B15);0)",
          "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B12:B15);0)",
          "pass": true
        },
        {
          "tab": "EÜR",
          "cell": "B17",
          "expectedFormula": "=SUM(B12:B16)",
          "actualFormula": "=SUM(B12:B16)",
          "pass": true
        },
        {
          "tab": "EÜR",
          "cell": "B18",
          "expectedFormula": "=B9-B17",
          "actualFormula": "=B9-B17",
          "pass": true
        },
        {
          "tab": "EÜR",
          "cell": "B19",
          "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))+SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2));0)",
          "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))+SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2));0)",
          "pass": true
        },
        {
          "tab": "Finanz-Cockpit",
          "cell": "B2",
          "expectedFormula": "=YEAR(TODAY())",
          "actualFormula": "=YEAR(TODAY())",
          "pass": true
        },
        {
          "tab": "Finanz-Cockpit",
          "cell": "B5",
          "expectedFormula": "=IFERROR(EÜR!B9;0)",
          "actualFormula": "=IFERROR('EÜR'!B9;0)",
          "pass": true
        },
        {
          "tab": "Finanz-Cockpit",
          "cell": "E5",
          "expectedFormula": "=IFERROR(EÜR!B17;0)",
          "actualFormula": "=IFERROR('EÜR'!B17;0)",
          "pass": true
        },
        {
          "tab": "Finanz-Cockpit",
          "cell": "H5",
          "expectedFormula": "=IFERROR(EÜR!B18;0)",
          "actualFormula": "=IFERROR('EÜR'!B18;0)",
          "pass": true
        },
        {
          "tab": "Finanz-Cockpit",
          "cell": "K5",
          "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)",
          "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Einnahme\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)",
          "pass": true
        },
        {
          "tab": "Finanz-Cockpit",
          "cell": "N5",
          "expectedFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)",
          "actualFormula": "=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E=\"Ausgabe\"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)",
          "pass": true
        },
        {
          "tab": "Finanz-Cockpit",
          "cell": "Q5",
          "expectedFormula": "=K5-N5",
          "actualFormula": "=K5-N5",
          "pass": true
        }
      ],
      "valueChecks": [
        {
          "label": "YearLink",
          "leftRef": "Finanz-Cockpit!B2",
          "rightRef": "EÜR!B2",
          "expected": "2026.00",
          "actual": "2026.00",
          "pass": true
        },
        {
          "label": "IncomeKPI",
          "leftRef": "Finanz-Cockpit!B5",
          "rightRef": "EÜR!B9",
          "expected": "0.00",
          "actual": "0.00",
          "pass": true
        },
        {
          "label": "ExpenseKPI",
          "leftRef": "Finanz-Cockpit!E5",
          "rightRef": "EÜR!B17",
          "expected": "0.00",
          "actual": "0.00",
          "pass": true
        },
        {
          "label": "ResultKPI",
          "leftRef": "Finanz-Cockpit!H5",
          "rightRef": "EÜR!B18",
          "expected": "0.00",
          "actual": "0.00",
          "pass": true
        },
        {
          "label": "CockpitSaldoArithmetic",
          "leftRef": "Finanz-Cockpit!Q5",
          "rightRef": "Finanz-Cockpit!K5-N5",
          "expected": "0.00",
          "actual": "0.00",
          "pass": true
        }
      ]
    }
  },
  "violations": [],
  "autofixActions": [],
  "status": "green"
}
```
