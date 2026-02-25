# Gemini QA 2023 - Best Practices

Die Skripte fuer Gemini / NVidia NIM QA sind in `src/orchestrator/gemini_qa_2023.ts`.

Funktionsweise:
1. Erstellt QA Tabs (`QA_2023_Queue`, `QA_2023_Corrections`, `QA_2023_Manual`)
2. Identifiziert 2023 Eintraege in `Buchhaltung_DB` mit fehlenden Kernfeldern (`belegart`, `lieferant`, `belegnr`, `belegdatum`, `brutto_gesamt`, `steuerkategorie`)
3. Laedt diese in `QA_2023_Queue`
4. Iteriert durch die Queue, holt den OCR-Text aus dem Sheet `belege` 
5. Sendet einen optimierten System-Prompt an NVidia NIM (`meta/llama-3.1-70b-instruct`), um JSON mit Korrekturen zurueckzuerhalten.
6. Schreibt die Korrekturen nach `QA_2023_Corrections`.

Codex wird anschliessend ueber `accounting_enrichment.ts` und `repair_2023.ts` diese Korrekturen einarbeiten und in die echten Tabellen mergen.

## Ausfuehrung:
```bash
npx tsx src/orchestrator/gemini_qa_2023.ts
```
