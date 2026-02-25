import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const FOLDER_ARCHIV = '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function moveFile(fileId: string, targetFolderId: string, fileName: string) {
  try {
    const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
    const parents = file.data.parents || [];
    if (parents.includes(targetFolderId)) return; // Already archived

    await drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: parents.join(','),
      supportsAllDrives: true,
      fields: 'id, parents',
    });
    console.log(`[ARCHIVED] ${fileName} (${fileId})`);
  } catch (err: any) {
    console.error(`[ERROR] ${fileName}: ${err.message}`);
  }
}

async function runIonosCleanup() {
  console.log('--- STARTING IONOS/1&1 CLEANUP (GLOBAL) ---');
  
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });

  const rows = meta.data.values;
  if (!rows || rows.length === 0) return;
  const headers = rows[0];
  const colIndex = (colName: string) => headers.indexOf(colName);
  
  const idCol = colIndex('drive_file_id');
  const nameCol = colIndex('dateiname_original');
  const lieferantCol = colIndex('lieferant');
  const textCol = colIndex('extracted_text');
  const ocrCol = colIndex('ocr_text');

  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fileId = row[idCol];
    if (!fileId) continue;

    const name = (row[nameCol] || '').toLowerCase();
    const lieferant = (row[lieferantCol] || '').toLowerCase();
    const text = ((row[textCol] || '') + ' ' + (row[ocrCol] || '')).toLowerCase();

    // Target: Ionos or 1&1
    if (lieferant.includes('ionos') || lieferant.includes('1&1') || name.includes('ionos') || name.includes('1&1')) {
        
        // Indicators for non-invoices
        const isJunk = 
            name.includes('übersicht') || 
            name.includes('ubersicht') ||
            name.includes('sammel') ||
            name.includes('vertrag') ||
            name.includes('bestellung') || // Order conf usually not invoice
            text.includes('vertragsübersicht') ||
            text.includes('sammelrechnung') ||
            text.includes('bestellbestätigung') ||
            text.includes('ihre bestellung');

        // Strong indicator for invoice (keep these!)
        const isInvoice = 
            name.includes('rechnung') || 
            text.includes('rechnungsnummer') || 
            text.includes('rechnung nr');

        if (isJunk && !isInvoice) {
            await moveFile(fileId, FOLDER_ARCHIV, row[nameCol]);
            count++;
        } else if (isJunk && isInvoice) {
            // Edge case: "Sammelrechnung" might be a valid summary invoice? 
            // User said: "viele belege von ionos oder 1&1 sind bloß sammelrechnungen ... lösche diese"
            // So even if it says "Rechnung", if it's "Sammelrechnung", archive it?
            // Let's stick to user prompt: "bloß sammelrechnungen ... lösche diese"
            if (text.includes('sammelrechnung') || name.includes('sammel')) {
                await moveFile(fileId, FOLDER_ARCHIV, row[nameCol]);
                count++;
            }
        }
    }
  }
  
  console.log(`--- IONOS CLEANUP FINISHED. Archived ${count} files. ---`);
}

runIonosCleanup().catch(console.error);
