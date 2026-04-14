# Context Fulltext

- source_path: src/legacy/gemini/gemini_final_verification.ts
- source_sha256: 2804ced7f7b0f10ab6377815133936460da2d1ad61b3e0a2719e9b7b95e1c7bb
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

async function verify() {
  console.log('--- FINAL VERIFICATION (GEMINI) ---');

  // 1. Check Data Quality in Buchhaltung_DB
  const dbRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Buchhaltung_DB!A1:AZ' });
  const rows = dbRes.data.values || [];
  const headers = rows[0];
  
  const unknownSupplierCount = rows.filter(r => (r[headers.indexOf('lieferant')] || '').toLowerCase().includes('unbekannt')).length;
  const noTextCount = rows.filter(r => !(r[headers.indexOf('extracted_text')] || '') && !(r[headers.indexOf('ocr_text')] || '')).length;
  const pendingCount = rows.filter(r => (r[headers.indexOf('status')] || '') === 'pending').length;

  console.log(`[DATA QUALITY]`);
  console.log(`- Rows: ${rows.length - 1}`);
  console.log(`- Lieferant unbekannt: ${unknownSupplierCount} (Goal: 0)`);
  console.log(`- Missing Text/OCR: ${noTextCount} (Goal: 0)`);
  console.log(`- Status Pending: ${pendingCount} (Goal: 0)`);

  // 2. Check 2023 Sheets for Forbidden Items
  const incRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Einnahmen_2023!A1:Z' });
  const expRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Ausgaben_2023!A1:Z' });
  
  const checkForbidden = (rows: any[], sheetName: string) => {
      const forbidden = ['lidl', 'rewe', 'netflix', 'wolt', 'miete', 'finanzamt'];
      let count = 0;
      rows.forEach(r => {
          const str = r.join(' ').toLowerCase();
          if (forbidden.some(f => str.includes(f))) count++;
      });
      console.log(`- ${sheetName}: Found ${count} potential forbidden items (Goal: 0).`);
  };

  console.log(`\n[SHEET SANITY]`);
  checkForbidden(incRes.data.values || [], 'Einnahmen_2023');
  checkForbidden(expRes.data.values || [], 'Ausgaben_2023');

  // 3. Conclusion
  if (unknownSupplierCount > 0 || noTextCount > 100 || pendingCount > 0) { // Tolerating a few no-text for now if image-only
      console.log('\nRESULT: NOT PERFECT YET. Codex needs to finish OCR and Enrichment.');
  } else {
      console.log('\nRESULT: LOOKING GOOD. Ready for final review.');
  }
}

verify().catch(console.error);

```
