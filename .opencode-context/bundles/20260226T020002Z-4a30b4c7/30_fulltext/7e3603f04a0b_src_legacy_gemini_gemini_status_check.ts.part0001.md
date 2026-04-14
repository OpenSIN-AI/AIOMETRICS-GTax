# Context Fulltext

- source_path: src/legacy/gemini/gemini_status_check.ts
- source_sha256: 24bd4a65754f3c78beb1ca2963fb016404a8a7981fd55e00ceaf2fb5c84cb7d8
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function checkStatus() {
  console.log('--- CURRENT STATUS CHECK ---');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  
  const rows = res.data.values || [];
  const headers = rows[0];
  
  const idCol = headers.indexOf('drive_file_id');
  const extTextCol = headers.indexOf('extracted_text');
  const ocrTextCol = headers.indexOf('ocr_text');
  const lieferantCol = headers.indexOf('lieferant');
  const statusCol = headers.indexOf('status');
  const catCol = headers.indexOf('steuerkategorie');

  let missingText = 0;
  let unknownSupplier = 0;
  let pendingStatus = 0;
  let missingCat = 0;

  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[idCol]) continue;

      const hasText = (row[extTextCol] || '').length > 20 || (row[ocrTextCol] || '').length > 20;
      if (!hasText) missingText++;

      if ((row[lieferantCol] || '').toLowerCase().includes('unbekannt') || !row[lieferantCol]) unknownSupplier++;
      
      if ((row[statusCol] || '') === 'pending') pendingStatus++;
      
      if (!row[catCol]) missingCat++;
  }

  console.log(`Total Rows: ${rows.length - 1}`);
  console.log(`Missing Text (OCR needed): ${missingText}`);
  console.log(`Unknown Supplier: ${unknownSupplier}`);
  console.log(`Pending Status: ${pendingStatus}`);
  console.log(`Missing Category: ${missingCat}`);
}

checkStatus().catch(console.error);

```
