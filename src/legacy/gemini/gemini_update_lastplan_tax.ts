import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

const taxUpdate = `
## 21) Steuerkategorien & Non-Invoice Cleanup (User Order 2026-02-24)

**Neue Anforderungen:**
1. **Steuerkategorien:** Müssen zwingend gesetzt werden.
   - **Ausgaben:** "Material/Waren", "Kraftstoff/Benzin", "Sonstige Ausgaben".
   - **Einnahmen:** "Photovoltaik (0%)" (bei 0% MwSt), "Einnahmen (19%)" (bei 19% MwSt).
2. **Non-Invoice Cleanup:** Es befinden sich noch "Bestellungen/Auftragsbestätigungen" in den Ausgaben-Ordnern. Diese müssen identifiziert und nach \`Fehlende Rechnungen\` verschoben werden.

**Aktionen (Gemini):**
- Skript \`gemini_tax_categorizer.ts\` erstellen und ausführen, um \`steuerkategorie\` in \`Buchhaltung_DB\` zu füllen.
- Skript \`gemini_non_invoice_cleanup.ts\` ausführen, um Order-Bestätigungen aus \`Ausgaben_2023\` zu entfernen.

**Anweisung an Codex (Batch C/D):**
- Beim Re-Sync darauf achten, dass die von Gemini gesetzten Kategorien nicht überschrieben werden (bzw. 1:1 übernommen werden).
`;

plan += taxUpdate;
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md updated with Tax & Cleanup tasks.');
