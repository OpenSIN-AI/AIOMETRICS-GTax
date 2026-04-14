# Context Fulltext

- source_path: docs/FINAL_ACCEPTANCE_REPORT.json
- source_sha256: dbf74fef1b9ff9960c2e573ce526514caa99d41628c1056f806e5534025141ee
- chunk: 2/4

```text
\"(?i)kraftstoff|benzin|diesel\")));0)",
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
  },
  "criticalQaIssues": 0,
  "qaIssues": [
    {
      "drive_file_id": "1toCRELAsvvRLmjTwWqZHoALN9yQ7aEoK",
      "original_name": "einphasiger-hybrid-wechselrichter-huawei-5-kva-sun2000-5ktl-l1.jpg",
      "year": "2000",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1X2t4_OqAOfi7PJk-olbJozyD8ihOxFqO",
      "original_name": "2022 Einnahmen-Überschus_Einnahmen-Ueberschussrechnung_fuer__27b56b.pdf",
      "year": "2022",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1dIrxIKmh7ulb0TKC-hPr431Jmh-N-zIm",
      "original_name": "0000-00-00_Ausgabe_1759344446766-belege2023-02c8bb9c-a178-40df-9b54-6a3cc81396e9_383066be-1a5d-4262-bb22-d02d8684a9ae_BetragUnbekannt.pdf",
      "year": "2023",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1vDG9ecAM_rzCHLER5Hyd-BwYx6WS0vOb",
      "original_name": "19420a9ad4746dbc_Ihre Rechnung 7180304902 vom 01.01.2025.pdf",
      "year": "2025",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "11yKeHBkFGme_cHKRjbGPDdorloqwHfCh",
      "original_name": "1945c3ca41b0905c_Kiez_Kiosk_&_Späti_Alt-Moabit_2025-01-12_20:36:42.735_678427dae826b0129fc63610.pdf",
      "year": "2025",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1k-eEfIZFZMXRV9gxrv5Ur26cue7Okwd3",
      "original_name": "0000-00-00_Ausgabe_Sun®yster_N_8087673_BetragUnbekannt.pdf",
      "year": "2026",
      "category": "Sonstiges",
      "severity": "HIGH",
      "failures": [
        "missing_metadata"
      ]
    },
    {
      "drive_file_id": "1Fy8iDcOH5w90NsZVA6WdrjW1OTZhh2Fy",
      "original_name": "19436cbf11fc2692_Vertragszusammenfassung.pdf",
      "year": "2026",
      "category": "Vertraege",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1e09ZeYJ5IXn8tamnwonWFxzJSeqNI4Yo",
      "original_name": "0000-00-00_Ausgabe_1759344447006-belege2023-0fc03a94-d72c-4174-9837-8e7eb9f3c9ba_b68aca19-2f58-4afa-987d-61852be3381b_BetragUnbekannt.pdf",
      "year": "2023",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1fn7hr3lNXXP_dulTu7akES2J1iWFkP84",
      "original_name": "194c04eca65c8437_Ihre Rechnung 7180305167 vom 01.02.2025.pdf",
      "year": "2025",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1Sl-MPbqUG6RNfGBj2pE6peOGF0huThXY",
      "original_name": "19467b165d5116b0_Burger_Bulls_Schöneberg_2025-01-15_02:00:00.880_678716a0d60e5210c11a84af.pdf",
      "year": "2025",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1wf9AKbaOzUt3WzpLiQoLYaPhsTzLQbxx",
      "original_name": "0000-00-00_Einnahme_2023-37_Rechnung_für_ausgeführte_Arbeiten_688495_01638727721_1.00EUR.pdf",
      "year": "2023",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "invalid_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1ihbpI1kb9vZrD8GshMVqPhy3Es-DFdlb",
      "original_name": "0000-00-00_Ausgabe_1759344447645-belege2023-2c8786d6-4ead-41c1-8194-3e4264ac3346_d1ab2f78-bd70-4525-9c75-76cfe69e5ea3_BetragUnbekannt.pdf",
      "year": "2023",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1EYNaFTV7L-2gL7FECu4SNdPNjl6TZCxh",
      "original_name": "19495aa9b3ce24f1_Diazo_-_Schöneberg_2025-01-24_00:15:01.520_6792db850391997f301a787e.pdf",
      "year": "2025",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1AC9gTcSl73Kl82L2ftCDdPcCbzOU0Myb",
      "original_name": "0000-00-00_Einnahme_2023-38_Rechnung_für_Solarmodule_montieren_6f3445_01638727721_1.00EUR.pdf",
      "year": "2023",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "invalid_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1-lM5l0aYQ8-PeXEepzVDrII9dnjPruBl",
      "original_name": "0000-00-00_Ausgabe_1759344447943-belege2023-2e8fd778-12e6-4504-89bb-e6405502f281_07cbc32d-d05e-4e4c-a685-ee9c298196cb_BetragUnbekannt.pdf",
      "year": "2023",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_ext
```
