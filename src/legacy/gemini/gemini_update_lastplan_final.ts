import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

const finalCheck = `
## 20) FINALES STATUS-UPDATE & HANDLUNGSBEDARF (2026-02-24)

**Ist-Stand Analyse ("Finanzamt-Ready"?):**
- **NEIN, noch nicht perfekt.**
- **Datenqualität:** Es fehlen bei fast allen Belegen (4121 Stück) OCR-Texte (\`extracted_text\`/\`ocr_text\`).
- **Konsequenz:** Ohne Text keine "Zoe Solar"-Tiefenprüfung, keine "Mixed Receipt"-Erkennung (Sprit vs. Kippen) und keine automatische Lieferantenerkennung möglich.
- **Status "Pending":** 3742 Belege stehen noch auf "pending". Das ist unprofessionell.
- **"Lieferant Unbekannt":** Nur noch 3 Fälle (sehr gut!), aber die Masse ist ungeprüft.
- **Sauberkeit:** Einnahmen_2023 und Ausgaben_2023 sind **sauber** (keine privaten Keywords gefunden). Das ist ein Erfolg!

**Warum ist das Ziel verfehlt?**
Der technische OCR-Lauf (Batch C / Codex) scheint noch nicht durchgelaufen zu sein oder hat keine Ergebnisse gespeichert.

**HARTE ANWEISUNG FÜR CODEX (SOFORT):**
1. **OCR-LAUF ERZWINGEN:** Starte \`accounting_enrichment.ts\` jetzt sofort. Priorisiere 2023. Nutze den Nvidia Qwen Fallback, wenn Tesseract versagt.
2. **Daten anreichern:** Fülle die leeren \`extracted_text\` Spalten.
3. **Re-Run Audit:** Sobald Text da ist, müssen die Gemini-Audits (Zoe Solar, Mixed Receipts) erneut laufen.
4. **Dashboard:** Erst bauen, wenn Datenqualität > 90% ist.

**Für den User:**
- Die Struktur (Ordner, Sheets) ist **perfekt**.
- Die Trennung (Privat/Geschäftlich) ist **perfekt**.
- Die **Inhalte** (Texterkennung) fehlen noch. Das System ist "blind". Wir machen es jetzt sehend.
`;

plan += finalCheck;
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md updated with honest final verification.');
