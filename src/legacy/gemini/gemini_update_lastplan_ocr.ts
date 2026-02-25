import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

const ocrUpdate = `
## 22) OCR Status Update (Gemini, 2026-02-24)

**Situation:**
- Der "Turbo OCR" mit Nvidia Qwen 3.5 läuft, aber die Google Drive API / Nvidia API Kombination ist langsam (Timeouts).
- Ich habe 4120 Belege ohne Text identifiziert.
- Der Loop verarbeitet sie jetzt stückweise.

**Handlungsempfehlung an Codex:**
- Bitte \`accounting_enrichment.ts\` als stabilen Daemon laufen lassen, der im Hintergrund Schritt für Schritt alles abarbeitet. 
- Das Skript muss gegen Timeouts gehärtet sein (Batch-Größe reduzieren, Retries erhöhen).
- Der Fallback auf Qwen 3.5 ist essentiell für Images.

**Nächste Schritte:**
1. OCR abschließen (kann dauern).
2. Erst NACH OCR die Zoe Solar und Mixed Receipts Audits erneut fahren.
3. Dashboard Update erst wenn Datenqualität steigt.
`;

plan += ocrUpdate;
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md updated with OCR status.');
