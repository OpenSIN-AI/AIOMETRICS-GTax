# Context Fulltext

- source_path: docs/NULL_FEHLER_REPORT_2023_2026-02-24_1503.md
- source_sha256: 10e145a30056da3925f0fa5735cf95fc1db2c794994eba6208f48147348088ba
- chunk: 1/1

```text
# NULL-FEHLER-REPORT 2023 (Stand 2026-02-24 15:03 UTC)

## Scope

- Spreadsheet: `1z-13LMaXRsDbtJFkujGJIwxVHyUgsBwM9W-LNlGg9-o`
- Jahresblätter Fokus: `Einnahmen_2023`, `Ausgaben_2023`
- Globaler Sync-Check: 2022-2026

## Verwendete Checks

1. `npx tsx src/orchestrator/check_2023_integrity.ts`
2. `npx tsx src/orchestrator/check_2023_policy.ts`
3. `npx tsx src/orchestrator/check_all_years_integrity.ts`
4. `npx tsx src/orchestrator/report_zoe_invoice_gaps_2023.ts`

## Ergebnis 2023 Integrität

- Einnahmen_2023: Drive 97 / Sheet 97 / DriveOnly 0 / SheetOnly 0 / DupID 0 / Privat 0 / DupKey 0
- Ausgaben_2023: Drive 920 / Sheet 920 / DriveOnly 0 / SheetOnly 0 / DupID 0 / Privat 0 / DupKey 0

Quelle: `docs/CHECK_2023_DRIVE_SHEETS_SYNC.md`

## Ergebnis 2023 Policy

- incomeViolations: 0
- expenseViolations: 0
- totalViolations: 0
- reasonCounts: {}

Quelle: `docs/CHECK_2023_POLICY.md`

## Ergebnis Alle Jahre

- Jahre: 2022, 2023, 2024, 2025, 2026
- totals: Drive 2219 / Sheet 2219 / DriveOnly 0 / SheetOnly 0 / duplicateDriveIdsInSheet 0 / zeroError=true

Quelle: `docs/CHECK_ALL_YEARS_DRIVE_SHEETS_SYNC.md`

## Zusatzprüfung ZOE Solar Rechnungsplan

- invoiceCount: 17
- groups: 10
- groupsWithGap: 1

Quelle: `docs/ZOE_SOLAR_RECHNUNGSPLAN_2023.md`

## Durchgeführte Bereinigungen im Lauf

- 2023-Korrekturlauf mit verschärfter Klassifizierung (Datum-/Lieferant-Fallback, Cross-Year-Korrektur).
- Falsch-jahrierte Belege automatisch in Zieljahresordner verschoben und Jahresblätter neu aufgebaut.
- Alte, verwirrende Jahr-Tabs entfernt: `Einnahmen/Ausgaben_2000, 2004, 2005, 2006, 2016`.

## Fazit

Für den definierten technischen Zielzustand ist der Stand aktuell **null-fehler**:

- 2023 ist Drive↔Sheets vollständig synchron.
- 2023 hat 0 Policy-Verstöße.
- Global (2022-2026) besteht 0 Drift.

Offene fachliche Restarbeit bleibt nur bei der inhaltlichen ZOE-Auftragslückenprüfung (1 Gruppe mit Gap laut Heuristik).

```
