# Context Fulltext

- source_path: src/legacy/gemini/gemini_ionos_cleanup_v2.ts
- source_sha256: 8c3984c453f8752ad2950759152fba369c1c2403b9b332ca8a72171795feaf57
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const FOLDER_ARCHIV = '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function moveFile(fileId: string, targetFolderId: string, fileName: string) {
  try {
    const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
    const parents = file.data.parents || [];
    if (parents.includes(targetFolderId)) return;

    await drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: parents.join(','),
      supportsAllDrives: true,
      fields: 'id, parents',
    });
    console.log(`[ARCHIVED] ${fileName}`);
  } catch (err: any) {
    console.error(`[ERROR] ${fileName}: ${err.message}`);
  }
}

async function runIonosCleanup() {
  console.log('--- STARTING IONOS CLEANUP V2 (JOINED DATA) ---');
  
  // 1. Fetch Buchhaltung_DB
  const dbRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  const dbRows = dbRes.data.values || [];
  const dbHeaders = dbRows[0];
  const dbIdCol = dbHeaders.indexOf('drive_file_id');
  const nameCol = dbHeaders.indexOf('dateiname_original');
  const lieferantCol = dbHeaders.indexOf('lieferant');

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

  // Create map of text
  const textMap = new Map<string, string>();
  for (let i = 1; i < belegeRows.length; i++) {
      const row = belegeRows[i];
      const id = row[bIdCol];
      if (id) {
          textMap.set(id, ((row[bExtTextCol] || '') + ' ' + (row[bOcrTextCol] || '')).toLowerCase());
      }
  }

  let count = 0;

  for (let i = 1; i < dbRows.length; i++) {
    const row = dbRows[i];
    const fileId = row[dbIdCol];
    if (!fileId) continue;

    const name = (row[nameCol] || '').toLowerCase();
    const lieferant = (row[lieferantCol] || '').toLowerCase();
    const text = textMap.get(fileId) || '';

    if (lieferant.includes('ionos') || lieferant.includes('1&1') || name.includes('ionos') || name.includes('1&1')) {
        
        const isJunk = 
            name.includes('übersicht') || 
            name.includes('ubersicht') ||
            name.includes('sammel') ||
            name.includes('vertrag') ||
            text.includes('vertragsübersicht') ||
            text.includes('sammelrechnung');

        // Allow "Rechnung" but NOT "Sammelrechnung"
        const isInvoice = name.includes('rechnung') || text.includes('rechnung nr') || text.includes('rechnungsnummer');
        const isSammel = text.includes('sammelrechnung') || name.includes('sammel');

        if ((isJunk || isSammel) && !(isInvoice && !isSammel)) {
            await moveFile(fileId, FOLDER_ARCHIV, row[nameCol]);
            count++;
        }
    }
  }
  
  console.log(`--- IONOS CLEANUP FINISHED. Archived ${count} files. ---`);
}

runIonosCleanup().catch(console.error);

```
