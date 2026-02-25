import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

// Update the plan to explicitly separate Codex and Gemini tasks as requested
const newBatchText = `## 10.3 Arbeitsaufteilung in Batches

**Batch A (Agent A - Codex, technisch):**
1. **Bereinigung & Sync:** Stale/alte Jahrtabs (2000/2004/...) kontrolliert entfernen. Folder-Namensfehler \`EInnahmen_2023\` -> \`Einnahmen_2023\` normalisieren (ohne ID-Wechsel).
2. **Eigenbeleg System Setup:** Erstellen des Sheets "Fehlende Belege" und "Eigenbeleg" (Template mit Dropdown), sowie Tabellenblätter pro Drive-Ordner.
3. **Hard Re-Sync:** Hard Re-Sync + Check-All + Check-2023 neu fahren, damit Sheets und Drive 1:1 synchron sind.

**Batch B (Agent B - Gemini, fachlich und File-Routing):**
1. **Archive Purge (Privat & 0% Ausgaben):** Skript zur Verschiebung von Flink, Lidl, Rewe, Vattenfall, Miete, Drogerie, Wolt, Tierfutter, Lebensmittel, etc. in Drive-Ordner \`1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe\`. Auch Ausgaben mit 0% MwSt (wo Geld gezahlt wurde) verschieben.
2. **Archivierung Behörden:** Verschiebung von Finanzamt, AOK, SBK, ARAG, HDI nach Drive-Ordner \`1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U\`.
3. **Ionos/1&1 Cleanup:** Identifikation von Sammelübersichten/Vertragsdaten (keine Rechnungen) und Löschung/Archivierung.
4. **Zoe Solar Audit:** Report über Auftragssumme vs. Rechnungssummen erstellen. Herauszufinden ob Rechnungen fehlen.
5. **Mixed Gas Station Receipts:** Trennung von Privat (Zigaretten, etc.) und Geschäftlich (Sprit) auf Belegebene. Erstellen der separaten MwSt- und Brutto-Spalten für private vs. geschäftliche Anteile in den Sheets.
6. **Eigenbeleg / Missing Invoices:** Bestellbestätigungen finden, in \`1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy\` verschieben.
7. **Zahlungseingänge vs. Belege:** Screenshots in \`1V0hfwXyvtzcWvb7INdf7z7jYdytyk9zU\` mit Einnahmen abgleichen. Fehlende Belege nach \`1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy\` verschieben.
8. **Duplikate & Weiche Duplikatsprüfung:** Identische oder extrem ähnliche Werte (Datum + Betrag) finden, Dokumente mergen oder Duplikate nach \`1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz\` verschieben.

**Batch C (Agent A - Codex, Apply & Dashboard):**
1. QA-Korrekturen aus der globalen Queue übernehmen.
2. Fehlende Lieferanten bereinigen ("Lieferant unbekannt" darf nicht existieren).
3. Dashboard und EÜR-Daten final aufbauen (\`setup_finance_dashboard.ts\`) mit korrekter Ausweisung der Zahllasten, Einnahmen und Ausgaben.
4. \`repair-2023\` + \`check-2023\`.
5. Null-Fehler-Report neu erzeugen.`;

plan = plan.replace(/## 10\.3 Arbeitsaufteilung in Batches[\s\S]*?(?=## 11\))/, newBatchText + '\n\n');
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md updated.');
