# Context Fulltext

- source_path: src/legacy/gemini/gemini_setup_eigenbeleg.ts
- source_sha256: 2720b39130a10f56e79d051ff804891a28b975f6f993297035c3a3e83d58b2d9
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

async function setupSheets() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const titles = meta.data.sheets?.map(s => s.properties?.title) || [];

  const requests: any[] = [];

  if (!titles.includes('Fehlende Belege')) {
      requests.push({ addSheet: { properties: { title: 'Fehlende Belege' } } });
  }
  if (!titles.includes('Eigenbeleg')) {
      requests.push({ addSheet: { properties: { title: 'Eigenbeleg' } } });
  }

  if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { requests }
      });
      console.log('Created sheets: Fehlende Belege, Eigenbeleg');
  } else {
      console.log('Sheets already exist.');
  }

  // Setup Headers for Fehlende Belege
  await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Fehlende Belege!A1:E1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Dateiname', 'Drive ID', 'Datum', 'Betrag', 'Status']] }
  });

  // Setup Template for Eigenbeleg
  const template = [
      ['EIGENBELEG (Ersatz für fehlende Rechnung)', ''],
      ['', ''],
      ['Datum:', ''],
      ['Betrag (Brutto):', ''],
      ['MwSt Satz:', '19%'],
      ['MwSt Betrag:', ''],
      ['Netto:', ''],
      ['Grund für Eigenbeleg:', 'Originalrechnung verloren / nicht erhalten'],
      ['Zahlungsweg:', 'Bank / PayPal / Bar'],
      ['Lieferant/Empfänger:', ''],
      ['Beschreibung der Leistung:', ''],
      ['', ''],
      ['Ort, Datum', 'Unterschrift'],
      ['Berlin, ' + new Date().toISOString().split('T')[0], '__________________']
  ];

  await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Eigenbeleg!A1:B14',
      valueInputOption: 'RAW',
      requestBody: { values: template }
  });
  console.log('Eigenbeleg template updated.');
}

setupSheets().catch(console.error);

```
