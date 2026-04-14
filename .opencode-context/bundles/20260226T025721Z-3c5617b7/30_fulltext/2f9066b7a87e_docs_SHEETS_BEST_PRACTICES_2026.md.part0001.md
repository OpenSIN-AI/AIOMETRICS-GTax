# Context Fulltext

- source_path: docs/SHEETS_BEST_PRACTICES_2026.md
- source_sha256: e531396b5a4ea48a322762a9d377ab0262038d48173c07c17d63114a05a2c764
- chunk: 1/1

```text
# Sheets Best Practices 2026 (Micro-Swarm Kontext)

## Kernprinzipien
- Eine zentrale Jahresauswahl (`Finanz-Cockpit!B2`) als Input für alle dynamischen Kennzahlen.
- Rechenlogik über Formeln (`FILTER`, `QUERY`, `ARRAYFORMULA`, `IFERROR`) statt manueller Zahlenpflege.
- Kleine, überprüfbare Formelblöcke statt monolithischer Mega-Formeln.
- Automatisierte, idempotente Pflege über Micro-Worker (`micro_sheet_formula_guard.ts`).
- Keine „Copy/Paste“-Werte in KPI-Feldern: nur Formeln + Guard-Worker.

## Offizielle Referenzen
- Google Sheets Funktionen (Index):  
  https://support.google.com/docs/table/25273
- `ARRAYFORMULA`:  
  https://support.google.com/docs/answer/3093275
- `QUERY`:  
  https://support.google.com/docs/answer/3093343
- `FILTER`:  
  https://support.google.com/docs/answer/3093197
- `XLOOKUP`:  
  https://support.google.com/docs/answer/12405947
- Benannte Funktionen (Named Functions):  
  https://support.google.com/docs/answer/12504534
- Bedingte Formatierung:  
  https://support.google.com/docs/answer/78413
- Apps Script Trigger (für eventnahe Automationen):  
  https://developers.google.com/apps-script/guides/triggers/installable
- Drive Changes API (delta sync):  
  https://developers.google.com/workspace/drive/api/guides/manage-changes
- Sheets API `batchUpdate` (performante Sammelupdates):  
  https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate

## Umsetzung im Projekt
- Drive/Sheet Delta-Sync: [REDACTED]
- Formula Guard: `micro_sheet_formula_guard.ts` setzt/prüft dynamische EÜR/Cockpit-Formeln.
- Datenaufbereitung und Validierung in getrennten Workern:
  - `micro_enrich_buchhaltung_db.ts`
  - `micro_tax_category_assign.ts`
  - `micro_konto_assign.ts`
  - `micro_plausibility_duplicate.ts`

## Konkrete Formel-Patterns (empfohlen)
- Jahressteuerung:
  - `Finanz-Cockpit!B2` als einzige Jahresquelle.
  - `EÜR!B2` referenziert `Finanz-Cockpit!B2`.
- Summen aus DB:
  - `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2));0)`
- Stabile Fehlerbehandlung:
  - Immer `IFERROR(...)` an äußeren Aggregationen.
- Dropdowns/Datenvalidierung:
  - Steuerkategorie, Belegart und Status nur über definierte Listenblätter.
- Plausibilitätsampel:
  - Bedingte Formatierung (grün/gelb/rot) auf Basis von Differenzfeldern (Soll-Ist, USt-Zahllast, Jahr-Mismatch).

## Betriebsmodell
- Taktung über `micro_swarm_tick.ts` mit Zeitbudget statt Endlos-Monolith.
- Jeder Worker hat Batch-Limits + Timeout.
- Reporting je Worker in `docs/MICRO_*.md`.

## Trigger-Best-Practice
- Für wiederkehrende Jobs installierbare Apps-Script-Trigger nutzen (nicht einfache Trigger für schwere Workloads).
- Einfache Trigger sind limitiert (typisch 30s Laufzeit), daher nur für sehr leichte Aktionen.
- Für Drive-Sync bevorzugt `changes.getStartPageToken` + `changes.list` statt Vollscan.

```
