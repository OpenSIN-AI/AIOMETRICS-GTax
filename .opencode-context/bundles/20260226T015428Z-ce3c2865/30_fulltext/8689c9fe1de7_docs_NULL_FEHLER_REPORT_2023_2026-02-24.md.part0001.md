# Context Fulltext

- source_path: docs/NULL_FEHLER_REPORT_2023_2026-02-24.md
- source_sha256: 1a37d94942edd53bcb60848973a0f0d2e97ca60ceb48469fad63aa76cf74838d
- chunk: 1/1

```text
# Null-Fehler-Report 2023

- erstellt am: 2026-02-24
- Spreadsheet: https://docs.google.com/spreadsheets/d/1z-13LMaXRsDbtJFkujGJIwxVHyUgsBwM9W-LNlGg9-o
- Quelle Detailreport: `docs/CHECK_2023_DRIVE_SHEETS_SYNC.md`

## Ausgefuehrte Reihenfolge

1. `npm run yearly-reorganize`
2. `SYNC_ONLY=1 npm start`
3. `npm run hard-audit`
4. `SYNC_ONLY=1 npm start`
5. `REPAIR_YEAR=2023 npm run repair-2023`
6. `npm run check-2023`

## Ergebnis (final)

### Einnahmen_2023
- Drive-Dateien: 2
- Sheet-Zeilen: 2
- Nur in Drive: 0
- Nur im Sheet: 0
- Doppelte `drive_file_id`: 0
- Privatmarker im Sheet: 0
- Duplikatverdacht (Business-Key): 0

### Ausgaben_2023
- Drive-Dateien: 1169
- Sheet-Zeilen: 1169
- Nur in Drive: 0
- Nur im Sheet: 0
- Doppelte `drive_file_id`: 0
- Privatmarker im Sheet: 0
- Duplikatverdacht (Business-Key): 0

## Schluss

Der 2023-Abgleich zwischen den konkreten 2023-Drive-Ordnern und den 2023-Sheets ist im finalen Check fehlerfrei (`0` Abweichungen in allen geprueften Kategorien).

```
