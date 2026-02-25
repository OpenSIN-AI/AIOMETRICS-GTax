import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

const report = `
## 18) Batch-B Status Report (Gemini, 2026-02-24)

**Durchgeführte Aktionen:**
1. **Archive Cleanup:** 
   - 34 private Dateien (Lidl, Rewe, Wolt, etc.) nach \`1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe\` verschoben.
   - 5 Archiv-Dateien (Behörden, AOK) nach \`1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U\` verschoben.
   - Ionos/1&1 Cleanup lief (1 Datei archiviert).
2. **Eigenbeleg Setup:**
   - Tabellenblatt "Eigenbeleg" (Template) und "Fehlende Belege" wurden verifiziert/erstellt.
3. **Zahlungsnachweise:**
   - Ordner \`1V0hfwXyvtzcWvb7INdf7z7jYdytyk9zU\` wurde geprüft. Ergebnis: **0 Dateien gefunden**. (Bitte prüfen, ob Upload erfolgreich war).
4. **Zoe Solar Audit:**
   - 5 Rechnungen identifiziert (RechnungNr.37, 38, 61, 72).
   - **WARNUNG:** Tiefenanalyse (Beträge/Auftragswert) nicht möglich, da OCR-Text fehlt.
5. **Mixed Receipts:**
   - Keine "gemischten" Tankstellenbelege identifiziert (aufgrund fehlenden OCR-Textes).

**Kritischer Handover an Codex (Batch C):**
1. **PRIORITÄT 1: OCR Nachholen.** Bitte \`accounting_enrichment.ts\` zwingend für alle Dateien in \`Buchhaltung_DB\` laufen lassen, die noch keinen \`extracted_text\` haben. Ohne dies ist die fachliche Prüfung (Zoe Audit, Split-Buchungen) unmöglich.
2. **Hard Re-Sync:** \`npm start\` ausführen, um die Datei-Verschiebungen (Privat/Archiv) in die Sheets zu synchronisieren.
3. **Dashboard:** Finanz-Cockpit und EÜR aufbauen.
4. **Datenqualität:** "Lieferant unbekannt" darf nicht bleiben -> Nach OCR-Lauf erneut prüfen.
`;

plan += report;
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md finalized with Batch B report.');
