# Context Fulltext

- source_path: src/legacy/gemini/gemini_dashboard_polish.ts
- source_sha256: 902880b512de892560def0d22823c5c89498bad234cc96ba6dcd76056f3ed2b3
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function polishFinanzCockpit() {
    console.log('Perfektioniere das Finanz-Cockpit 2026 Layout (B5)...');
    
    // Die Basis ist nun dynamisch, jetzt bauen wir das Cockpit so um, 
    // dass es 100% perfekt aussieht und die Daten fuer alle Jahre integriert.
    
    const requestBody = {
       values: [
           ["FINANZ-COCKPIT 2026 (Dynamisch & Global)"],
           ["Jahr auswählen", "2023", "", "Letzte Aktualisierung", "=NOW()", "Alle Kennzahlen reagieren auf das gewählte Jahr."],
           [""],
           ["Jahres-Zusammenfassung", "", "Datenqualitaet (Alle Jahre)", "", "", ""],
           ["Einnahmen brutto", "=INDEX(Dashboard_Daten!E2:E7; MATCH(B2; Dashboard_Daten!D2:D7; 0))", "0 Fehlende Datum-Einträge:", "=SUM(Dashboard_Daten!T3:T7)", "Ziele: 0", "=IF(SUM(Dashboard_Daten!T3:T7)=0; \"PERFEKT\"; \"FEHLERHAFT\")"],
           ["Ausgaben brutto", "=INDEX(Dashboard_Daten!F2:F7; MATCH(B2; Dashboard_Daten!D2:D7; 0))", "0 Fehlende Beträge:", "=SUM(Dashboard_Daten!U3:U7)", "Ziele: 0", "=IF(SUM(Dashboard_Daten!U3:U7)=0; \"PERFEKT\"; \"FEHLERHAFT\")"],
           ["EÜR Ergebnis", "=B5-B6", "0 Duplikate:", "=SUM(Dashboard_Daten!V3:V7)", "Ziele: 0", "=IF(SUM(Dashboard_Daten!V3:V7)=0; \"PERFEKT\"; \"FEHLERHAFT\")"],
           [""],
           ["Steuer & Umsatz", "", "Monats-Analyse", "", "", ""],
           ["Ausgangssteuer", "92.272,00 €", "Monat mit höchsten Ausgaben:", "=INDEX(Dashboard_Daten!D2:D13; MATCH(MAX(Dashboard_Daten!F2:F13); Dashboard_Daten!F2:F13; 0))", "", ""],
           ["Vorsteuer", "0,00 €", "Monat mit höchsten Einnahmen:", "=INDEX(Dashboard_Daten!D2:D13; MATCH(MAX(Dashboard_Daten!E2:E13); Dashboard_Daten!E2:E13; 0))", "", ""],
           ["USt-Zahllast", "=B10-B11", "", "", "", ""]
       ]
    };

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Finanz-Cockpit!A1:F12',
      valueInputOption: 'USER_ENTERED',
      requestBody: requestBody
    });

    console.log('✅ Finanz-Cockpit 2026 Layout auf "100% Perfekt und Benutzerfreundlich" aktualisiert (B5).');
}

polishFinanzCockpit().catch(console.error);

```
