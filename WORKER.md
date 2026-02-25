# WORKER.md

## 1) Zielbild (Micro-Swarm, kein Monolith)
- Jeder Worker ist klein, spezialisiert, austauschbar.
- Ein Worker-Lauf soll kurz sein (typisch 5-90 Sekunden, harte Timeouts).
- Harte Obergrenze pro Worker-Lauf: `< 3 Minuten` (Default-Budgets `170000 ms`).
- Keine „alles in einem“ Pipeline als Standard.
- Kette statt Monolith: Sync -> Enrich -> Tax -> Konto -> Plausi -> (optional OCR/Move) -> Audit.

## 2) Verzeichnisstruktur
- Core Worker Code: `/Users/jeremy/dev/AIOMETRICS-GTax/src/orchestrator`
- Reports pro Worker: `/Users/jeremy/dev/AIOMETRICS-GTax/docs`
- Plan/Tasks: `/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md`
- Worker Source-of-Truth: `/Users/jeremy/dev/AIOMETRICS-GTax/WORKER.md`

## 3) Aktive Micro-Worker (Produktiv)

### A) Sync / Intake
1. `micro_sync_drive_changes.ts`
- Zweck: Delta-Sync Drive->Sheet (`belege`) über Drive Changes API.
- State: `logs/micro_sync_drive_changes_state.json`
- Max-Last pro Lauf: `MICRO_SYNC_MAX_CHANGES` (Default 40)
- Script: `npm run -s micro-sync-drive-changes`

1b. `micro_sheet_delete_archive_sync.ts`
- Zweck: Gegenrichtung `Sheet -> Drive` für gelöschte Zeilen.
- Vergleicht `sync_state` mit aktuellem `belege`; entfernte IDs werden nach `Archiviert` verschoben.
- Script: `npm run -s micro-sheet-delete-archive-sync`

2. `micro_local_118_tesseract_filter.ts`
- Zweck: lokale Dateien (`118_525_01062`) content-basiert vorsortieren.
- OCR-first: Tesseract (schnell), mit Timeout/Dateigröße-Limits.
- Duplikate (content-basiert) optional löschen.
- Cursor-Paging aktiv: `logs/local118_cursor.json` (keine Wiederholung gleicher Dateien).
- Standard-Defaults strikt micro:
  - `LOCAL_118_BATCH=5`
  - `LOCAL_118_OCR_TIMEOUT_MS=20000`
  - `LOCAL_118_RUN_BUDGET_MS=170000`
- Script: `npm run -s micro-local-118-filter`

### B) OCR / Cleanup
3. `micro_ocr_audit_1nm.ts`
- Zweck: nur `Ausgaben_2023` Ordner `1NM...` in Mikrobatches OCR + Privatprüfung.
- OCR-Reihenfolge: Gemini 2.5 Flash-Lite -> Qwen 3.5 fallback.
- Tesseract nur Notfall (`OCR_EMERGENCY_TESSERACT=1`).
- Standard-Defaults strikt micro:
  - `MICRO_1NM_OCR_BATCH=2`
  - `MICRO_1NM_MODEL_TIMEOUT_MS=25000`
  - `MICRO_1NM_RUN_BUDGET_MS=170000`
- Script: `npm run -s micro-ocr-audit-1nm`

4. `micro_clean_private_1nm.ts`
- Zweck: private Marker in `1NM` rausziehen (Fuel-Guard bleibt).
- Script: `npm run -s micro-clean-private-1nm`

### C) DB-Enrichment / Buchhaltung
5. `micro_enrich_buchhaltung_db.ts`
- Zweck: aus `belege` (Text+Metadaten) in `Buchhaltung_DB` upserten.
- Felder: belegart, lieferant, belegnr, datum, steuerkategorie, betrag, status usw.
- Script: `npm run -s micro-enrich-buchhaltung-db`

6. `micro_tax_category_assign.ts`
- Zweck: fehlende/unklare Steuerkategorie + Belegart content-basiert setzen.
- Script: `npm run -s micro-tax-category-assign`

7. `micro_konto_assign.ts`
- Zweck: sollkonto/habenkonto/istkonto in Mikrobatches setzen (heuristisch SKR03-orientiert).
- ergänzt fehlende `istkonto`-Spalte in `Buchhaltung_DB`, falls nicht vorhanden.
- Script: `npm run -s micro-konto-assign`

8. `micro_plausibility_duplicate.ts`
- Zweck: Logik-/Plausi-/Duplikatprüfung auf `Buchhaltung_DB`.
- schreibt Findings in Tab `Plausibilitaet_Micro`.
- Script: `npm run -s micro-plausibility-duplicate`

### D) Sheet-Formeln / Interne Verknüpfungen
9. `micro_sheet_formula_guard.ts`
- Zweck: EÜR + Finanz-Cockpit Formeln dynamisieren/absichern.
- Force-Mode: `MICRO_FORMULA_FORCE=1`
- Script: `npm run -s micro-sheet-formula-guard`

### E) Orchestrierung
10. `micro_swarm_tick.ts`
- Zweck: mehrere Worker in festem Zeitbudget ausführen (kein Long-Run).
- Budget: `MICRO_SWARM_BUDGET_MS` (Default 170000 ms)
- Task-Timeouts pro Worker individuell.
- Script: `npm run -s micro-swarm-tick`

### F) Guard / Scheduler / Metrics
11. `zio_guard_worker.ts`
- Zweck: erkennt stale Monolith-Prozesse + Lock-Zustand, optional Kill.
- Script: `npm run -s zio-guard`

12. `micio_scheduler.ts`
- Zweck: profilbasierte Micro-Ketten (`core`, `ocr`, `qa`) ohne Monolith.
- Gesamtbudget: `MICIO_BUDGET_MS` (Default 170000 ms), Restschritte werden als `skipped_budget` protokolliert.
- Script: `npm run -s micio-scheduler`

13. `aiometrics_worker.ts`
- Zweck: Health-/Durchsatz-Metriken aus Micro-Reports konsolidieren.
- Script: `npm run -s aiometrics`

14. `start_micio_loop.sh`
- Zweck: kontinuierliche Ausführung in kurzen Micro-Ticks (Default alle 60s).
- Reihenfolge je Tick: `zio-guard` -> `micio-scheduler` -> `aiometrics`.
- Start: `./start_micio_loop.sh`

15. `start_micro_lane_swarm.sh`
- Zweck: drei MICIO-Profile parallel (core/ocr/qa) + Guard + Metrics.
- Ergebnis: mehrere unabhängige Micro-Lanes statt Monolith.
- Start: `./start_micro_lane_swarm.sh`

## 4) Worker-Ketten (Best Practice)

### Kette „Sofort-Sync + DB“
1. `micro-sync-drive-changes`
2. `micro-enrich-buchhaltung-db`
3. `micro-tax-category-assign`
4. `micro-konto-assign`
5. `micro-plausibility-duplicate`
6. `micro-sheet-formula-guard`

### Kette „2023 Cleanup“
1. `micro-ocr-audit-1nm`
2. `micro-clean-private-1nm`
3. `repair_2023.ts` stage-basiert (max moves klein)
4. `audit-year-strict`

## 5) Harte Regeln
- Keine finale Entscheidung nur nach Dateiname.
- Priorität: OCR/extracted_text + strukturierte Tokens (Datum, Betrag, Belegnr).
- Timebox je Worker-Lauf (Timeout/Batch-Limit).
- Nur ein `repair_2023` gleichzeitig (Lock beachten).
- Nach jeder Kette Audit laufen lassen.

## 6) Batch-/Timeout-Profile
- Ultra-Micro: Batch 1-2, Timeout 8-20s/Datei
- Micro: Batch 3-5
- Nur bei stabilen APIs höher

## 7) Aktive Scripts (package.json)
- `build` (micro-only compile via `tsconfig.micro.json`)
- `build-all` (legacy full compile)
- `micro-sync-drive-changes`
- `micro-enrich-buchhaltung-db`
- `micro-tax-category-assign`
- `micro-konto-assign`
- `micro-plausibility-duplicate`
- `micro-sheet-formula-guard`
- `micro-sheet-delete-archive-sync`
- `micro-ocr-audit-1nm`
- `micro-clean-private-1nm`
- `micro-local-118-filter`
- `micro-swarm-tick`
- `zio-guard`
- `micio-scheduler`
- `aiometrics`
- `micro-lane-swarm`

## 8) Legacy / nicht mehr Standard-Swarm
- `main.ts`, `pipeline_sync.ts`, `soft_audit.ts`, `yearly_reorganize.ts` (monolithischer als nötig)
- `gemini_*` und `gemini_turbo_ocr*` (historische Pfade; nicht Source-of-Truth für neuen Swarm)
- `scan_ocr.ts`, `scan_zoe.ts` (diagnostisch, kein produktiver Decision-Worker)
- einzelne `delete_*` Skripte nur Notfall/forensisch
- Monolith-Entrypoints sind als `legacy-*` NPM Scripts gekennzeichnet (`legacy-start`, `legacy-sync-chain`, `legacy-accounting-enrichment`).

## 9) Sinnhaftigkeits-Audit (kurz)
- `strict_content`: `micro_sync_drive_changes`, `micro_enrich_buchhaltung_db`, `micro_tax_category_assign`, `micro_konto_assign`, `micro_plausibility_duplicate`, `micro_ocr_audit_1nm`
- `semi_content`: `micro_clean_private_1nm`, `micro_reclassify_*`, `micro_move_zoe_invoices` (wegen Fallback-Heuristiken)

## 10) Tabellen-Logik / Formeln (Best Practices)
- Dynamik über eine Jahreszelle (`Finanz-Cockpit!B2` -> `EÜR!B2`)
- Summen über `FILTER`/`IFERROR` statt statischer Zahlen
- kleine, nachvollziehbare Formeln statt verschachtelter Monsterformeln
- Guard-Worker (`micro_sheet_formula_guard.ts`) setzt/prüft Kernformeln regelmäßig

## 11) ZIO / MICIO / AIOMETRICS
- Jetzt produktiv vorhanden:
  - `zio_guard_worker.ts` -> Report: `docs/ZIO_GUARD_STATUS.md`
  - `micio_scheduler.ts` -> Report: `docs/MICIO_SCHEDULER.md`
  - `aiometrics_worker.ts` -> Report: `docs/AIOMETRICS_STATUS.md`

## 12) Nächste technische Schritte
- Optional: Legacy-Skripte in `/src/orchestrator/legacy/` verschieben.
- Optional: `micro_sync_drive_changes` + `micro_swarm_tick` per stündlichem/dichterem Trigger laufen lassen.
- Optional: dedizierten `micro_duplicate_move_worker.ts` ergänzen (Findings -> Duplikat-Ordner).

## 13) Parallel-Runbook (3-10 Micro-Prozesse)
- Lane 1 (Sync/DB): `MICIO_PROFILE=core MICIO_BUDGET_MS=170000 node dist-micro/orchestrator/micio_scheduler.js`
- Lane 2 (OCR): `MICIO_PROFILE=ocr MICIO_BUDGET_MS=170000 node dist-micro/orchestrator/micio_scheduler.js`
- Lane 3 (QA): `MICIO_PROFILE=qa MICIO_BUDGET_MS=170000 node dist-micro/orchestrator/micio_scheduler.js`
- Guard parallel: `npm run -s zio-guard`
- Metrics parallel: `npm run -s aiometrics`
- Optional permanenter Parallelbetrieb: `./start_micro_lane_swarm.sh`

Hinweis:
- In restriktiven Umgebungen `node dist-micro/...` bevorzugen, da parallele `tsx`-IPC Pipes (`EPERM`) verursachen können.

Konfliktregel:
- `repair_2023.ts` nur in einer Lane gleichzeitig.
- Bei hoher API-Last zuerst Batches runtersetzen, nicht Timeouts hochdrehen.
