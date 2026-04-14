# Context Fulltext

- source_path: docs/FINAL_ACCEPTANCE_REPORT.md
- source_sha256: 6ecc3f761773c440209ca932b6eec52cd0952c6d832a1d716b12526dec2da2ab
- chunk: 4/5

```text
       "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "12AS8ChFBMSbSrcac01g9qZP8ShrZQcS5",
      "original_name": "4353.2.2_Schlussrechnung.pdf",
      "year": "2026",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1-1qBGDdz8A9NCJ5zMScko-6g5SxboHwf",
      "original_name": "0000-00-00_Ausgabe_£_Sun_Tankstell_d9cacf4c-78e9-4de8-96ce-240f26679467_BetragUnbekannt.pdf",
      "year": "2026",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1MDP334pHdfoOvhChrb2aSsTZt5XhedXh",
      "original_name": "4357.7.4_Schlussrechnung_e5b185.pdf",
      "year": "2026",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1c-RIQZpkTGFjkgyzgB-KLEjh6CRovvWw",
      "original_name": "0000-00-00_Ausgabe_0000-00-00_Ausgabe_Bobs_Cost_lout_for_194514_BetragUnbekannt_d710592e-8e76-48f4-a969-805a028ffd54_BetragUnbekannt.pdf",
      "year": "2026",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1Chlrls0ADa1UxTvCSDd8eZw7AXNadW8x",
      "original_name": "GMI-2023-197684_GetMyInvoices_Lizenz_Standard_900875.pdf",
      "year": "2023",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1nTCcXoyjUparwOd2rW_m-5ZDbbmwmw2h",
      "original_name": "2023-03-21_Einnahme_2023-03-1037_Guthaben_f95a21_D-20457_50.00EUR.pdf",
      "year": "2023",
      "category": "Sonstiges",
      "severity": "HIGH",
      "failures": [
        "missing_metadata"
      ]
    },
    {
      "drive_file_id": "1p7kZxRZdACeVQXjA4GzPgFhvMfkgiSN_",
      "original_name": "4358.1.1_Abschlagsrechnung_|_Angebot:_4358.1_75f213.pdf",
      "year": "2026",
      "category": "Rechnungen",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1C8AWbGuJ8wiq3dYzvamFKE1KlYzk1PQh",
      "original_name": "0000-00-00_Ausgabe_1020240000243803369_{'item_name'_'Mini-Selfie_LED_Lich_b9f7e8ed-1487-47da-9d6b-654ab6b7367b_BetragUnbekannt.pdf",
      "year": "2026",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_amount_pattern"
      ]
    },
    {
      "drive_file_id": "1ac15t5y7ak1wpAfL-9QkXGY6qu37_z-M",
      "original_name": "2023-03-25_Einnahme_202303-87242_100_Stück_Bohrschrauben_6,3_X_50_mi_24ecc0_87242_19.00EUR.pdf",
      "year": "2023",
      "category": "Sonstiges",
      "severity": "HIGH",
      "failures": [
        "missing_metadata"
      ]
    },
    {
      "drive_file_id": "1D7dw_kQCqOBcJT7IbvdYE9RF3xbnzaTw",
      "original_name": "WhatsApp Image 2025-05-22 at 14.55.17.jpeg",
      "year": "2025",
      "category": "Sonstiges",
      "severity": "MEDIUM",
      "failures": [
        "weak_text_extraction",
        "missing_metadata",
        "missing_amount_pattern"
      ]
    }
  ],
  "auditSchemaMigration": {
    "migrated": false,
    "canonicalSheetTitle": "Audit_Tabellen",
    "previousHeader": [
      "run_id",
      "timestamp",
      "action",
      "target",
      "drive_file_id",
      "before_json",
      "after_json",
      "reason"
    ],
    "canonicalHeader": [
      "run_id",
      "timestamp",
      "action",
      "target",
      "drive_file_id",
      "before_json",
      "after_json",
      "reason"
    ]
  },
  "mismatchResolutionStats": {
    "belegeBefore": 1828,
    "belegeAfter": 1828,
    "yearlyTabsTouched": 16,
    "staleYearTabsDeleted": [],
    "actionsTotal": 2746,
    "actionsByType": {
      "DELETE_YEARLY_ORPHAN": 1293,
      "INSERT_YEARLY_MISSING": 746,
      "UPDATE_YEAR": 707
    },
    "actionsByYear": {
      "2000": 3,
      "2004": 2,
      "2016": 2,
      "2022": 10,
      "2023": 1558,
      "2024": 20,
      "2025": 93,
      "2026": 1058
    }
  },
  "hardFailReasons": [
    "STAGE_FAILED:idempotency_check#1",
    "IDEMPOTENCY_FAILED"
  ],
  "integrity": {
    "timestamp": "2026-02-26T00:48:32.305Z",
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
    "reportPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/CHECK_DRIVE_SHEETS_SYNC.md",
    "summaries": [
      {
        "year": "2000",
        "income": {
          "driveCount": 0,
          "sheetCount": 0,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 0
        },
        "expense": {
          "driveCount": 0,
          "sheetCount": 0,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 0
        }
      },
      {
        "year": "2004",
        "income": {
          "driveCount": 0,
          "sheetCount": 0,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 0
        },
        "expense": {
          "driveCount": 0,
          "sheetCount": 0,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 0
        }
      },
      {
        "year": "2016",
        "income": {
          "driveCount": 0,
          "sheetCount": 0,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 0
        },
        "expense": {
          "driveCount": 0,
          "sheetCount": 0,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 0
        }
      },
      {
        "year": "2022",
        "income": {
          "driveCount": 2,
          "sheetCount": 2,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        },
        "expense": {
          "driveCount": 4,
          "sheetCount": 4,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        }
      },
      {
        "year": "2023",
        "income": {
          "driveCount": 121,
          "sheetCount": 121,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        },
        "expense": {
          "driveCount": 680,
          "sheetCount": 680,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        }
      },
      {
        "year": "2024",
        "income": {
          "driveCount": 5,
          "sheetCount": 5,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        },
        "expense": {
          "driveCount": 8,
          "sheetCount": 8,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        }
      },
      {
        "year": "2025",
        "income": {
          "driveCount": 16,
          "sheetCount": 16,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        },
        "expense": {
          "driveCount": 139,
          "sheetCount": 139,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        }
      },
      {
        "year": "2026",
        "income": {
          "driveCount": 18,
          "sheetCount": 18,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        },
        "expense": {
          "driveCount": 834,
          "sheetCount": 834,
          "driveOnly": 0,
          "sheetOnly": 0,
          "duplicateDriveIdsInSheet": 0,
          "potentialPrivateRows": 0,
          "potentialDuplicateBusinessKeys": 1
        }
      }
    ],
    "fullMismatchFiles": {
      "2000": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2000_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2000_sheet_only.json",
        "duplicateFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2000_duplicate_drive_ids.json"
      },
      "2004": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2004_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2004_sheet_only.json",
        "duplicateFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2004_duplicate_drive_ids.json"
      },
      "2016": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2016_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2016_sheet_only.json",
        "duplicateFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2016_duplicate_drive_ids.json"
      },
      "2022": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2022_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2022_sheet_only.json",
        "duplicateFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2022_duplicate_drive_ids.json"
      },
      "2023": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2023_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2023_sheet_only.json",
        "duplicateFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2023_duplicate_drive_ids.json"
      },
      "2024": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2024_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2024_sheet_only.json",
        "duplicateFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2024_duplicate_drive_ids.json"
      },
      "2025": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2025_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2025_sheet_only.json",
        "duplicateFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2025_duplicate_drive_ids.json"
      },
      "2026": {
        "driveOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/docs/mismatch/2026_drive_only.json",
        "sheetOnlyFullPath": "/Users/jeremy/dev/AIOMETRICS-GTax/
```
