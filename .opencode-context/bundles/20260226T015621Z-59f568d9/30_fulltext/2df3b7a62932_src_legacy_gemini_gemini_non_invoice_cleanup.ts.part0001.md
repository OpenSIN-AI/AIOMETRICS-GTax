# Context Fulltext

- source_path: src/legacy/gemini/gemini_non_invoice_cleanup.ts
- source_sha256: 97f91a28be51821722df9eea2bd37281ce0ef414357957d7cc938f4af3151739
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
// Destination: Fehlende Rechnungen
const TARGET_FOLDER = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function moveFile(fileId: string, fileName: string) {
  try {
    const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
    const parents = file.data.parents || [];
    if (parents.includes(TARGET_FOLDER)) return;

    await drive.files.update({
      fileId,
      addParents: TARGET_FOLDER,
      removeParents: parents.join(','),
      supportsAllDrives: true,
      fields: 'id, parents',
    });
    console.log(`[MOVED TO MISSING] ${fileName}`);
  } catch (err: any) {
    console.error(`[ERROR] moving ${fileName}: ${err.message}`);
  }
}

async function runCleanup() {
  console.log('--- STARTING NON-INVOICE CLEANUP ---');
  
  // Need to check folders Ausgaben_2023 etc. 
  // Easier to check via Buchhaltung_DB first, or listing files in folders.
  // Let's use Buchhaltung_DB as index.
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  const rows = res.data.values || [];
  const headers = rows[0];
  
  const idCol = headers.indexOf('drive_file_id');
  const nameCol = headers.indexOf('dateiname_original');
  const textCol = headers.indexOf('extracted_text');
  const ocrCol = headers.indexOf('ocr_text');
  
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const fileId = row[idCol];
      const name = (row[nameCol] || '').toLowerCase();
      const text = ((row[textCol] || '') + ' ' + (row[ocrCol] || '')).toLowerCase();
      
      // Keywords indicating NOT an invoice
      const isOrder = 
          name.includes('bestellung') || 
          name.includes('auftrag') || 
          name.includes('bestätigung') || 
          name.includes('order') ||
          text.includes('bestellbestätigung') ||
          text.includes('auftragsbestätigung') ||
          text.includes('ihre bestellung');
          
      // Safeguard: Keyword "Rechnung"
      const isInvoice = 
          name.includes('rechnung') || 
          name.includes('invoice') || 
          text.includes('rechnung nr') || 
          text.includes('rechnungsnummer') ||
          text.includes('invoice no');
          
      if (isOrder && !isInvoice) {
          await moveFile(fileId, row[nameCol]);
          count++;
      }
  }
  
  console.log(`--- NON-INVOICE CLEANUP COMPLETE. Moved ${count} files. ---`);
}

runCleanup().catch(console.error);

```
