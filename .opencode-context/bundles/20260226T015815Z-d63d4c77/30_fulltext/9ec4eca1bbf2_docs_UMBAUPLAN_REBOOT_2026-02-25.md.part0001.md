# Context Fulltext

- source_path: docs/UMBAUPLAN_REBOOT_2026-02-25.md
- source_sha256: 6aaf48a5a027c0aad9bdc537f976fbd12c8ef14b454abae40aae148fc2343a04
- chunk: 1/1

```text
# Umbauplan Reboot (CEO-Entscheidungen)

## Ziel
Repo von „historisch gewachsen + monolithische Restteile“ auf eine belastbare Micro-Worker-Architektur umstellen:
- kurze Läufe
- klar getrennte Verantwortlichkeiten
- robuste Audits
- nachvollziehbare Sheets-Logik

## Entscheidung A: Aktive Runtime hart begrenzen
- Nur folgende Pfade sind produktiv:
  - `src/orchestrator/micro_*.ts`
  - `src/orchestrator/micio_scheduler.ts`
  - `src/orchestrator/zio_guard_worker.ts`
  - `src/orchestrator/aiometrics_worker.ts`
- Alles andere ist `legacy` oder `manual`.

## Entscheidung B: Monolithen nicht weiter ausbauen
- `repair_2023.ts` bleibt vorerst nur als Übergangstool.
- Keine neuen Features mehr in Monolith-Dateien.
- Neue Logik nur als Micro-Worker + kleine Shared-Hilfen.

## Entscheidung C: Sheet-Architektur neu und stabil
- Eine Datenquelle: `Buchhaltung_DB`.
- Dashboard/EÜR/Formeln als klarer, versionierter Block.
- Keine verstreuten konkurrierenden Formel-Writer.
- Formeländerungen nur über einen zentralen Guard-Worker.

## Entscheidung D: Governance durch Guard-Skripte
- Repo-Inventory automatisch erzeugbar.
- Architektur-Guard blockiert Re-Regressionen (Monolith-Rückfälle).

## Umsetzungsphasen

### Phase 1 (sofort)
1. Legacy-Trennung fertigstellen (heute begonnen).
2. NPM-Scripts bereinigen: aktive vs. legacy eindeutig.
3. Inventory + Architecture Guard einführen.

### Phase 2 (kurzfristig)
1. `repair_2023.ts` funktional zerlegen:
   - dedupe
   - policy-routing
   - flow/year-routing
   - rebuild
2. Gemeinsame Utilities in `src/orchestrator/shared/*`.

### Phase 3 (fachlich)
1. Sheets-UX neu strukturieren:
   - Eingabe
   - Prüfstatus
   - Exportansicht
2. EÜR/USt-Berechnung mit klaren Prüfregeln + Audit-Tab.

### Phase 4 (betrieblich)
1. Dauerbetrieb über kleine Ticks (kein Monolith-Run).
2. Monitoring mit klaren KPI:
   - OCR-Backlog
   - strict audit violations
   - sync delta
   - duplicate findings

## Abnahmekriterien
1. Keine produktive Abhängigkeit auf `src/legacy/*`.
2. Jeder aktive Worker hat:
   - Batch-Limit
   - Timeout
   - Budget
   - Report-Ausgabe
3. `AUDIT_YEAR=2023` bleibt `criticalViolations=0`.
4. Dashboard/EÜR liefern konsistente Werte aus `Buchhaltung_DB`.

```
