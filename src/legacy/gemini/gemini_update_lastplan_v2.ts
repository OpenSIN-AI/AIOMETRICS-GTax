import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

const additionalReqs = `
## 17) Priorität & Korrekturen (Update 2026-02-24)

**Harte Anforderungen (User Feedback):**
1. **Zahlungsnachweise:** Ordner \`1V0hfwXyvtzcWvb7INdf7z7jYdytyk9zU\` enthält Screenshots. Abgleich mit Einnahmen. Falls kein Beleg existiert -> Screenshot nach \`1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy\` (Fehlende Belege) verschieben.
2. **Strikte Trennung:** 
   - Keine privaten Belege in Geschäftsordnern (Supermarkt, Drogerie, Streaming, Miete, Strom privat).
   - Keine 7% MwSt Belege (außer explizit geschäftlich).
   - Keine 0% Ausgaben (wo Geld floss) in Geschäftsbüchern -> Privat.
3. **Zoe Solar:** Lückenlose Prüfung aller Rechnungen vs. Auftragswert.
4. **Mixed Receipts:** Tankstellenbelege (Sprit vs. Kippen) sauber trennen (Split-Buchung im Sheet vorbereiten).
5. **Datenqualität:** "Lieferant unbekannt" ist nicht akzeptabel. OCR muss nachgeholt werden, falls Text fehlt.

**Aktueller Blocker:**
- Tiefenanalyse-Skripte finden keine Treffer, da \`extracted_text\` in DB oft leer ist.
- **Lösung:** Analyse-Skripte müssen Datei-Inhalt direkt von Drive laden (Vision API/Text Extraction), wenn Sheet-Text fehlt.
`;

plan += additionalReqs;
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md updated with strict requirements.');
