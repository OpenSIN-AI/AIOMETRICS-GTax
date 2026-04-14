# Context Fulltext

- source_path: src/legacy/gemini/gemini_mixed_receipts_marker.ts
- source_sha256: d2a61e32aab9910eb5ed10d19e92152ce6372f309c684ad1d295a8bdfbc3e804
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

async function runMarker() {
  console.log('--- MARKING MIXED RECEIPTS ---');
  
  // 1. Fetch Buchhaltung_DB
  const dbRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  const dbRows = dbRes.data.values || [];
  const dbHeaders = dbRows[0];
  const idCol = dbHeaders.indexOf('drive_file_id');
  const lieferantCol = dbHeaders.indexOf('lieferant');
  const nameCol = dbHeaders.indexOf('dateiname_original');
  const hinweisCol = dbHeaders.indexOf('hinweis');
  
  // 2. Fetch belege (for text)
  const belegeRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:AZ',
  });
  const belegeRows = belegeRes.data.values || [];
  const belegeHeaders = belegeRows[0];
  const bIdCol = belegeHeaders.indexOf('drive_file_id');
  const bExtTextCol = belegeHeaders.indexOf('extracted_text');
  const bOcrTextCol = belegeHeaders.indexOf('ocr_text');

  const textMap = new Map<string, string>();
  for (let i = 1; i < belegeRows.length; i++) {
      const row = belegeRows[i];
      if (row[bIdCol]) textMap.set(row[bIdCol], (row[bExtTextCol] || '') + ' ' + (row[bOcrTextCol] || '').toLowerCase());
  }

  const updates: any[] = [];
  const gasStations = ['shell', 'aral', 'esso', 'total', 'jet', 'hem', 'agip', 'tamoil', 'star', 'omv'];
  const privateKeywords = ['zigarette', 'tobacco', 'kippen', 'bier', 'beer', 'snack', 'red bull', 'coffee', 'kaffee', 'bockwurst'];

  for (let i = 1; i < dbRows.length; i++) {
      const row = dbRows[i];
      const fileId = row[idCol];
      const lieferant = (row[lieferantCol] || '').toLowerCase();
      const name = (row[nameCol] || '').toLowerCase();
      const text = textMap.get(fileId) || '';
      
      if (gasStations.some(g => lieferant.includes(g) || name.includes(g))) {
          if (privateKeywords.some(p => text.includes(p))) {
              if (!row[hinweisCol]?.includes('MIXED')) {
                  updates.push({
                      range: `Buchhaltung_DB!AA${i + 1}`, // AA is 'hinweis' based on header check? No, let's verify index
                      values: [[(row[hinweisCol] || '') + ' [CHECK: MIXED RECEIPT]']]
                  });
              }
          }
      }
  }

  // Need correct column letter for 'hinweis'.
  // Header check: index 26 is 'hinweis'. A=0, Z=25, AA=26. Yes.
  
  if (updates.length > 0) {
      console.log(`Found ${updates.length} mixed receipts to mark.`);
      await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
              valueInputOption: 'RAW',
              data: updates
          }
      });
      console.log('Marked mixed receipts.');
  } else {
      console.log('No new mixed receipts found (or no text matches).');
  }
}

runMarker().catch(console.error);

```
